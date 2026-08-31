import {
  DspacerAuthError,
  DspacerClient,
  DspacerRequestError,
} from './dspacer.client';

/**
 * The connector issues 300-second tokens and a full scan runs longer than that,
 * so most of what matters here is when the client decides to authenticate again.
 * Time and fetch are injected; nothing reaches the network.
 */

const LOGIN = 'https://connector.example/app/up/login-service/auth/login';
const BASE = 'https://connector.example/app/up/middleware';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface Harness {
  client: DspacerClient;
  calls: Array<{
    url: string;
    method: string;
    auth: string | null;
    body: unknown;
  }>;
  logins: () => number;
  tick: (ms: number) => void;
}

function harness(
  responder: (url: string, init: RequestInit) => Response | Promise<Response>,
  opts: { expiresIn?: number; refreshMarginMs?: number } = {},
): Harness {
  let clock = 1_000_000;
  const calls: Harness['calls'] = [];
  const fetchImpl = (async (url: unknown, init: RequestInit = {}) => {
    const u = String(url);
    calls.push({
      url: u,
      method: init.method ?? 'GET',
      auth: (init.headers as Record<string, string>)?.authorization ?? null,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    if (u === LOGIN) {
      return json({
        access_token: `token-${calls.filter((c) => c.url === LOGIN).length}`,
        refresh_token: 'refresh',
        expires_in: opts.expiresIn ?? 300,
        token_type: 'Bearer',
      });
    }
    return responder(u, init);
  }) as unknown as typeof fetch;

  return {
    client: new DspacerClient({
      baseUrl: BASE,
      loginUrl: LOGIN,
      usuario: 'user',
      password: 'secret',
      fetchImpl,
      now: () => clock,
      refreshMarginMs: opts.refreshMarginMs ?? 60_000,
    }),
    calls,
    logins: () => calls.filter((c) => c.url === LOGIN).length,
    tick: (ms) => {
      clock += ms;
    },
  };
}

describe('DspacerClient authentication', () => {
  it('logs in with the field names the login service requires', async () => {
    const h = harness(() => json({ status: 'healthy' }));
    await h.client.healthy();
    const login = h.calls.find((c) => c.url === LOGIN)!;
    expect(login.method).toBe('POST');
    expect(login.body).toEqual({ usuario: 'user', password: 'secret' });
  });

  it('sends the token as a bearer on middleware calls', async () => {
    const h = harness(() => json({ status: 'healthy' }));
    await h.client.healthy();
    expect(h.calls.find((c) => c.url.endsWith('/health'))!.auth).toBe(
      'Bearer token-1',
    );
  });

  it('reuses a token that is still comfortably valid', async () => {
    const h = harness(() => json({ status: 'healthy' }));
    await h.client.healthy();
    h.tick(60_000);
    await h.client.healthy();
    expect(h.logins()).toBe(1);
  });

  it('re-authenticates before the token expires, not after', async () => {
    // 300s life, 60s margin: the token stops being used at 240s. A scan that
    // acquired it at 0 and reaches 250s must not still be carrying it.
    const h = harness(() => json({ status: 'healthy' }));
    await h.client.healthy();
    h.tick(241_000);
    await h.client.healthy();
    expect(h.logins()).toBe(2);
    expect(h.calls.filter((c) => c.url.endsWith('/health')).pop()!.auth).toBe(
      'Bearer token-2',
    );
  });

  it('keeps a token issued 239s ago, one second inside the margin', async () => {
    const h = harness(() => json({ status: 'healthy' }));
    await h.client.healthy();
    h.tick(239_000);
    await h.client.healthy();
    expect(h.logins()).toBe(1);
  });

  it('logs in once when several calls start together', async () => {
    // A scan fans out. Without a shared in-flight login every concurrent call
    // would authenticate separately.
    const h = harness(() => json({ status: 'healthy' }));
    await Promise.all([
      h.client.healthy(),
      h.client.healthy(),
      h.client.healthy(),
      h.client.healthy(),
    ]);
    expect(h.logins()).toBe(1);
  });

  it('still uses a token whose whole life is shorter than the margin', async () => {
    // Refusing to work because the connector is stingier than configured would
    // be worse than refreshing often.
    const h = harness(() => json({ status: 'healthy' }), {
      expiresIn: 30,
      refreshMarginMs: 60_000,
    });
    await h.client.healthy();
    h.tick(14_000);
    await h.client.healthy();
    expect(h.logins()).toBe(1);
    h.tick(2_000);
    await h.client.healthy();
    expect(h.logins()).toBe(2);
  });

  it('reports a rejected login without echoing the credentials', async () => {
    const fetchImpl = (async () =>
      json({ detail: 'bad credentials' }, 401)) as unknown as typeof fetch;
    const client = new DspacerClient({
      baseUrl: BASE,
      loginUrl: LOGIN,
      usuario: 'user',
      password: 'hunter2',
      fetchImpl,
    });
    await expect(client.participants()).rejects.toThrow(DspacerAuthError);
    await expect(client.participants()).rejects.toThrow(
      /DSPACER_USER and DSPACER_PASSWORD/,
    );
    await expect(client.participants()).rejects.not.toThrow(/hunter2/);
  });

  it('retries once when a token is refused mid-flight, then gives up', async () => {
    let health = 0;
    const h = harness(() => {
      health += 1;
      return health === 1 ? json({}, 401) : json({ status: 'healthy' });
    });
    expect(await h.client.healthy()).toBe(true);
    expect(h.logins()).toBe(2);
  });

  it('surfaces a persistent 401 as a request failure rather than looping', async () => {
    const h = harness(() => json({ detail: 'nope' }, 401));
    await expect(h.client.participants()).rejects.toThrow(DspacerRequestError);
    expect(h.logins()).toBe(2);
  });
});

describe('DspacerClient operations', () => {
  it('reads the participant list', async () => {
    const h = harness(() =>
      json({
        participants: [
          {
            bpn: 'BPNL1',
            name: 'Innoceana',
            direction: 'http://p/dsp',
            type: 'Dataprovider',
          },
        ],
      }),
    );
    const parts = await h.client.participants();
    expect(parts).toEqual([
      {
        bpn: 'BPNL1',
        name: 'Innoceana',
        direction: 'http://p/dsp',
        type: 'Dataprovider',
      },
    ]);
  });

  it('posts a catalog request for one provider', async () => {
    const h = harness(() => json({ 'dcat:dataset': [] }));
    await h.client.catalog(
      {
        bpn: 'BPNL1',
        name: 'Innoceana',
        direction: 'http://p/dsp',
        type: 'Dataprovider',
      },
      { limit: 200 },
    );
    const call = h.calls.find((c) => c.url.endsWith('/catalog/request'))!;
    expect(call.method).toBe('POST');
    expect(call.body).toMatchObject({
      '@type': 'CatalogRequest',
      counterPartyId: 'BPNL1',
      counterPartyAddress: 'http://p/dsp',
      protocol: 'dataspace-protocol-http',
      querySpec: { offset: 0, limit: 200 },
    });
  });

  it('reports an unhealthy connector as false instead of throwing', async () => {
    const h = harness(() => json({}, 503));
    expect(await h.client.healthy()).toBe(false);
  });

  it('explains the missing-EDR transfer failure in the error it raises', async () => {
    const h = harness(() =>
      json(
        {
          detail: {
            message:
              'The response from checking the EDR transaction state was unsuccessful',
            downstream_status: 200,
            downstream_response: '[]',
          },
        },
        500,
      ),
    );
    await expect(
      h.client.transfer({
        id: 'a',
        label: 'Boya biomasa Cádiz',
        payload: {
          providerBpn: 'BPNL1',
          providerName: 'UP',
          counterPartyAddress: 'http://p/dsp',
          offer: { '@id': 'o' },
        },
      }),
    ).rejects.toThrow(/no endpoint data reference/);
  });

  it('explains the provider-404 transfer failure in the error it raises', async () => {
    const h = harness(() =>
      json(
        {
          detail: {
            message: 'The response from getting the data was unsuccessful',
            downstream_status: 404,
            downstream_response: '{"status":404}',
          },
        },
        500,
      ),
    );
    await expect(
      h.client.transfer({
        id: 'a',
        label: 'Recogidas playas Tenerife',
        payload: {
          providerBpn: 'BPNL1',
          providerName: 'Innoceana',
          counterPartyAddress: 'http://p/dsp',
          offer: { '@id': 'o' },
        },
      }),
    ).rejects.toThrow(/without a resolvable data address/);
  });

  it('rejects a non-JSON body rather than passing it on', async () => {
    const h = harness(
      () => new Response('<html>gateway</html>', { status: 200 }),
    );
    await expect(h.client.participants()).rejects.toThrow(/not JSON/);
  });

  it('names the operation when the connector is unreachable', async () => {
    const fetchImpl = (async (url: unknown) => {
      if (String(url) === LOGIN)
        return json({ access_token: 't', expires_in: 300 });
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const client = new DspacerClient({
      baseUrl: BASE,
      loginUrl: LOGIN,
      usuario: 'u',
      password: 'p',
      fetchImpl,
    });
    await expect(client.participants()).rejects.toThrow(
      /bpn\/all could not reach the connector/,
    );
  });
});
