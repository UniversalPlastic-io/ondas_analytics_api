import { Logger } from '@nestjs/common';
import {
  buildCatalogRequest,
  buildContractRequest,
  explainTransferFailure,
  Participant,
  parseParticipants,
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

  /** One authenticated middleware call. Retries once on 401, in case the token expired in flight. */
  private async call(
    operation: string,
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    for (const attempt of [1, 2]) {
      const token = await this.accessToken();
      let res: Response;
      try {
        res = await this.withTimeout((signal) =>
          this.fetchImpl(`${this.options.baseUrl}${path}`, {
            method: body === undefined ? 'GET' : 'POST',
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
    return this.call(
      `catalog/${provider.name}`,
      '/catalog/request',
      buildCatalogRequest(provider, opts),
    );
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
    return this.call(
      `transfer/${ref.label}`,
      '/transfer/request',
      buildContractRequest(ref),
    );
  }
}
