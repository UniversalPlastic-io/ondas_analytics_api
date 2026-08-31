import { Logger } from '@nestjs/common';
import {
  buildCatalogRequest,
  buildContractRequest,
  explainTransferFailure,
  Participant,
  parseParticipants,
  parseUploadedAsset,
  UploadedAsset,
} from './dspacer-catalog';
import { SourceRef } from './dataspace-source';

/**
 * HTTP client for the D-Spacer connector.
 *
 * Two services, one per tenant: `login-service` issues the token, `middleware`
 * does everything else. The shapes here were taken from the deployed connector,
 * not from the specification — the published OpenAPI declares `schema: {}` on
 * all 38 operations, so it describes the requests but not the responses.
 */

export class DspacerAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DspacerAuthError';
  }
}

export class DspacerRequestError extends Error {
  constructor(
    readonly status: number,
    readonly operation: string,
    message: string,
  ) {
    super(message);
    this.name = 'DspacerRequestError';
  }
}

export interface DspacerClientOptions {
  /** Middleware base, including the entity segment: `https://{host}/app/{entity}/middleware`. */
  baseUrl: string;
  /** Full login endpoint: `https://{host}/app/{entity}/login-service/auth/login`. */
  loginUrl: string;
  usuario: string;
  password: string;
  timeoutMs?: number;
  /**
   * How long before expiry a token is considered spent.
   *
   * The connector issues 300-second tokens, and a scan runs longer than that, so
   * this is not a refinement: without a margin wide enough to cover the slowest
   * single request, a scan acquires a token that expires mid-flight.
   */
  refreshMarginMs?: number;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
  now?: () => number;
}

interface CachedToken {
  accessToken: string;
  /** Absolute ms timestamp after which the token must not be used. */
  usableUntil: number;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_REFRESH_MARGIN_MS = 60_000;

export class DspacerClient {
  private readonly logger = new Logger(DspacerClient.name);
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly refreshMarginMs: number;

  private token: CachedToken | null = null;
  /** In-flight login, so concurrent callers wait on one request instead of racing. */
  private pendingLogin: Promise<CachedToken> | null = null;

  constructor(private readonly options: DspacerClientOptions) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.now = options.now ?? (() => Date.now());
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.refreshMarginMs = options.refreshMarginMs ?? DEFAULT_REFRESH_MARGIN_MS;
  }

  /**
   * A usable access token, logging in again when the cached one is close enough
   * to expiry that a request could outlive it.
   *
   * The login response also returns a refresh token, which is deliberately
   * unused: the login-service specification was never published, so the refresh
   * endpoint and its payload are unknown. Re-authenticating is a verified path;
   * guessing a refresh route is not.
   */
  private async accessToken(): Promise<string> {
    const cached = this.token;
    if (cached && cached.usableUntil > this.now()) return cached.accessToken;
    if (this.pendingLogin) return (await this.pendingLogin).accessToken;

    this.pendingLogin = this.login().finally(() => {
      this.pendingLogin = null;
    });
    const fresh = await this.pendingLogin;
    this.token = fresh;
    return fresh.accessToken;
  }

  private async login(): Promise<CachedToken> {
    const started = this.now();
    let res: Response;
    try {
      res = await this.withTimeout((signal) =>
        this.fetchImpl(this.options.loginUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            usuario: this.options.usuario,
            password: this.options.password,
          }),
          signal,
        }),
      );
    } catch (e) {
      throw new DspacerAuthError(
        `could not reach the login service: ${(e as Error).message}`,
      );
    }

    if (!res.ok) {
      // The body may name the offending field; the credentials never appear in it.
      throw new DspacerAuthError(
        `login failed with ${res.status}. Check DSPACER_USER and DSPACER_PASSWORD.`,
      );
    }

    const body = (await res.json()) as {
      access_token?: unknown;
      expires_in?: unknown;
    };
    if (typeof body?.access_token !== 'string' || !body.access_token) {
      throw new DspacerAuthError('the login service returned no access_token');
    }

    const ttlMs =
      typeof body.expires_in === 'number' ? body.expires_in * 1000 : 0;
    // A token whose whole life is shorter than the margin is still worth using:
    // clamping to half its life beats refusing to work.
    const usableFor =
      ttlMs > this.refreshMarginMs
        ? ttlMs - this.refreshMarginMs
        : Math.floor(ttlMs / 2);
    if (ttlMs && ttlMs <= this.refreshMarginMs) {
      this.logger.warn(
        `the connector issued a ${ttlMs / 1000}s token, shorter than the ${this.refreshMarginMs / 1000}s refresh margin; ` +
          `using half its life instead`,
      );
    }
    return { accessToken: body.access_token, usableUntil: started + usableFor };
  }

  private async withTimeout(
    run: (signal: AbortSignal) => Promise<Response>,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await run(controller.signal);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * One authenticated middleware call. Retries once on 401, in case the token
   * expired in flight.
   *
   * The method is explicit because the write path needs a POST with no body:
   * `POST /policies/create/{id}/no_restriction` takes its only argument in the
   * path, so deriving the method from the presence of a body would send a GET.
   */
  private async call(
    operation: string,
    path: string,
    init: { method?: 'GET' | 'POST'; body?: unknown } = {},
  ): Promise<unknown> {
    const method = init.method ?? (init.body === undefined ? 'GET' : 'POST');
    const body = init.body;
    for (const attempt of [1, 2]) {
      const token = await this.accessToken();
      let res: Response;
      try {
        res = await this.withTimeout((signal) =>
          this.fetchImpl(`${this.options.baseUrl}${path}`, {
            method,
            headers: {
              authorization: `Bearer ${token}`,
              ...(body === undefined
                ? {}
                : { 'content-type': 'application/json' }),
            },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal,
          }),
        );
      } catch (e) {
        throw new DspacerRequestError(
          0,
          operation,
          `${operation} could not reach the connector: ${(e as Error).message}`,
        );
      }

      if (res.status === 401 && attempt === 1) {
        // The token was accepted when the margin was computed and refused now.
        // One re-login, then the failure is real.
        this.token = null;
        continue;
      }

      const text = await res.text();
      let parsed: unknown = undefined;
      try {
        parsed = text ? JSON.parse(text) : undefined;
      } catch {
        parsed = undefined;
      }

      if (!res.ok) {
        const explained = parsed
          ? explainTransferFailure(parsed)
          : text.slice(0, 200);
        throw new DspacerRequestError(
          res.status,
          operation,
          `${operation} failed (${res.status}): ${explained}`,
        );
      }
      if (parsed === undefined) {
        throw new DspacerRequestError(
          res.status,
          operation,
          `${operation} returned a body that is not JSON`,
        );
      }
      return parsed;
    }
    /* istanbul ignore next — the loop always returns or throws */
    throw new DspacerRequestError(
      401,
      operation,
      `${operation} stayed unauthorised after re-authenticating`,
    );
  }

  /** True when the connector answers its health check. */
  async healthy(): Promise<boolean> {
    try {
      const body = (await this.call('health', '/health')) as {
        status?: unknown;
      };
      return body?.status === 'healthy';
    } catch {
      return false;
    }
  }

  /** Every participant registered in the space, with the address of their connector. */
  async participants(): Promise<Participant[]> {
    return parseParticipants(await this.call('bpn/all', '/bpn/all'));
  }

  /** One provider's DCAT catalog. */
  async catalog(
    provider: Participant,
    opts: { offset?: number; limit?: number } = {},
  ): Promise<unknown> {
    return this.call(`catalog/${provider.name}`, '/catalog/request', {
      body: buildCatalogRequest(provider, opts),
    });
  }

  /**
   * Negotiates the contract and returns the asset's data.
   *
   * Not yet verified against the deployment: every transfer currently fails
   * because the published assets resolve to a data address that returns 404.
   * The request shape is the connector's documented one and the failure paths
   * are the two observed live; the success path is the part still unproven.
   */
  async transfer(ref: SourceRef): Promise<unknown> {
    return this.call(`transfer/${ref.label}`, '/transfer/request', {
      body: buildContractRequest(ref),
    });
  }

  /* ---------------------------------------------------------------- write path */

  /**
   * Uploads a JSON document and returns the asset the connector created for it.
   *
   * This is the first of the three calls that publish something: the policy and
   * the contract both need the identifier it returns.
   */
  async uploadData(opts: {
    name: string;
    description: string;
    payload: unknown;
  }): Promise<UploadedAsset> {
    const body = await this.call('data/upload', '/data/upload', {
      body: {
        request: opts.payload,
        asset_data: {
          asset_name: opts.name,
          asset_description: opts.description,
        },
      },
    });
    const asset = parseUploadedAsset(body);
    if (!asset) {
      // The upload may well have succeeded; what failed is finding the id in the
      // answer, and without it no contract can be created. Report the keys, not
      // the body: the body is the document we just uploaded.
      throw new DspacerRequestError(
        200,
        'data/upload',
        `the connector accepted the upload but its answer carried no asset id ` +
          `(keys: ${Object.keys((body ?? {}) as object).join(', ') || 'none'})`,
      );
    }
    return asset;
  }

  /**
   * Creates a policy that every participant satisfies.
   *
   * `policy_id` is ours to choose and travels in the path; the operation takes no
   * request body.
   */
  async createNoRestrictionPolicy(policyId: string): Promise<void> {
    await this.call(
      'policies/create/no_restriction',
      `/policies/create/${encodeURIComponent(policyId)}/no_restriction`,
      { method: 'POST' },
    );
  }

  /**
   * Binds a policy to an asset. This is the call that puts the asset in the
   * catalog other participants read: an asset with no contract definition is
   * stored on the connector and offered to nobody.
   */
  async createContract(opts: {
    contractId: string;
    policyId: string;
    assetId: string;
  }): Promise<void> {
    await this.call('contracts/create', '/contracts/create', {
      body: {
        contract_id: opts.contractId,
        policy_id: opts.policyId,
        asset_id: opts.assetId,
      },
    });
  }

  /**
   * The assets this connector holds, without negotiating anything.
   *
   * Ours to read directly because the connector is ours. `filterExpression` is
   * passed through to the connector rather than filtering here: the catalog grows
   * by one asset per published analysis, so a caller that fetched everything and
   * filtered locally would get slower every day.
   */
  async listOwnAssets(
    opts: {
      offset?: number;
      limit?: number;
      filterExpression?: unknown[];
    } = {},
  ): Promise<unknown> {
    return this.call('data/all', '/data/all', {
      body: {
        raw: {
          '@context': { '@vocab': 'https://w3id.org/edc/v0.0.1/ns/' },
          '@type': 'QuerySpec',
          offset: opts.offset ?? 0,
          limit: opts.limit ?? 50,
          sortOrder: 'DESC',
          sortField: 'id',
          filterExpression: opts.filterExpression ?? [],
        },
      },
    });
  }
}

/**
 * Injection token for the single client instance.
 *
 * The client caches an access token, so a second instance means a second login
 * per token lifetime and two clients each renewing on their own schedule. The
 * catalog source and the report publisher share this one.
 */
export const DSPACER_CLIENT = Symbol('DSPACER_CLIENT');
