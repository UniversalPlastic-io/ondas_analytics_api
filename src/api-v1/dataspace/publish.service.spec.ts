import { Logger } from '@nestjs/common';
import { Model } from 'mongoose';
import { PublishService, expiringReferences } from './publish.service';
import { SyncRun } from './schemas/sync-run.schema';
import { DspacerClient } from './source/dspacer.client';
import { MetricsService } from '../../metrics/metrics.service';
import { AnalysesRunResponse } from '../analyses/analyses.types';

/**
 * Publishing is distribution, not the product. The properties that matter here
 * are all about what it must never do to the analysis it is publishing: never
 * throw into the caller, never publish something whose links will expire, never
 * write to the production catalog unless it was turned on, and never publish the
 * same result twice in a row.
 */

const CONNECTOR_ENV = {
  DSPACER_BASE_URL: 'https://connector.example/app/up/middleware',
  DSPACER_LOGIN_URL:
    'https://connector.example/app/up/login-service/auth/login',
  DSPACER_USER: 'user',
  DSPACER_PASSWORD: 'secret',
};

function response(
  overrides: Partial<AnalysesRunResponse> = {},
): AnalysesRunResponse {
  return {
    requestId: 'req_abcd1234',
    input: {
      location: { lat: 43.5721, lon: -5.7212 },
      area: { type: 'radius_km', value: 25 },
    },
    executedAnalyses: ['basic_contamination'],
    meta: {
      aggregation: { mode: 'raw' },
      dateRangeApplied: { start: '2025-01-01', end: '2025-01-30' },
      datasetsUsed: {},
      cache: { mode: 'reuse', hit: false, cacheKey: 'analyses|{"a":1}' },
    },
    results: {},
    ...overrides,
  };
}

interface Harness {
  service: PublishService;
  upload: jest.Mock;
  policy: jest.Mock;
  contract: jest.Mock;
  create: jest.Mock;
  metrics: MetricsService;
  order: string[];
}

function harness(): Harness {
  const order: string[] = [];
  const upload = jest.fn(async (opts: { name: string }) => {
    order.push('upload');
    return {
      id: 'asset-1',
      name: opts.name,
      dataAddressBaseUrl: 'urn:uuid:shared',
    };
  });
  const policy = jest.fn(async () => {
    order.push('policy');
  });
  const contract = jest.fn(async () => {
    order.push('contract');
  });
  const create = jest.fn(async () => ({}));
  const metrics = new MetricsService();
  const client = {
    uploadData: upload,
    createNoRestrictionPolicy: policy,
    createContract: contract,
  } as unknown as DspacerClient;

  return {
    service: new PublishService(
      client,
      { create } as unknown as Model<SyncRun>,
      metrics,
    ),
    upload,
    policy,
    contract,
    create,
    metrics,
    order,
  };
}

async function counter(
  metrics: MetricsService,
  status: string,
): Promise<number> {
  const text = await metrics.metrics();
  const line = text
    .split('\n')
    .find((l) =>
      l.startsWith(`ondas_reports_published_total{status="${status}"}`),
    );
  return line ? Number(line.split(' ').pop()) : 0;
}

describe('PublishService', () => {
  const original = { ...process.env };

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    Object.assign(process.env, CONNECTOR_ENV, {
      DSPACER_PUBLISH_ENABLED: 'true',
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env = { ...original };
  });

  it('publishes nothing when the switch is off', async () => {
    // The default, and the reason for it: a development machine with the
    // connector credentials would otherwise publish every analysis its tests run.
    process.env.DSPACER_PUBLISH_ENABLED = 'false';
    const h = harness();
    const outcome = await h.service.publish(response(), {
      coast: 'catambrico',
    });
    expect(outcome.status).toBe('skipped');
    expect(h.upload).not.toHaveBeenCalled();
    // Not recorded either: a row per analysis on a deployment with publishing
    // off would bury the rows that mean something.
    expect(h.create).not.toHaveBeenCalled();
  });

  it('treats an unset switch as off', async () => {
    delete process.env.DSPACER_PUBLISH_ENABLED;
    const h = harness();
    expect(
      (await h.service.publish(response(), { coast: 'catambrico' })).status,
    ).toBe('skipped');
    expect(h.upload).not.toHaveBeenCalled();
  });

  it('skips, loudly, when the switch is on but the connector is not configured', async () => {
    delete process.env.DSPACER_BASE_URL;
    const h = harness();
    const outcome = await h.service.publish(response(), {
      coast: 'catambrico',
    });
    expect(outcome.status).toBe('skipped');
    expect(outcome.reason).toMatch(/not configured/);
    expect(h.upload).not.toHaveBeenCalled();
  });

  it('uploads, then makes a policy, then a contract', async () => {
    // The order is not stylistic. The contract needs the id the upload returns,
    // and without the contract the asset is stored on our connector and offered
    // to nobody.
    const h = harness();
    const outcome = await h.service.publish(response(), {
      coast: 'catambrico',
    });

    expect(outcome.status).toBe('published');
    expect(h.order).toEqual(['upload', 'policy', 'contract']);
    expect(h.contract.mock.calls[0][0]).toMatchObject({ assetId: 'asset-1' });
  });

  it('binds the contract to the policy it just created', async () => {
    const h = harness();
    await h.service.publish(response(), { coast: 'catambrico' });
    const policyId = h.policy.mock.calls[0][0];
    expect(typeof policyId).toBe('string');
    expect(h.contract.mock.calls[0][0].policyId).toBe(policyId);
    // Fresh per publication, so two never collide.
    expect(h.contract.mock.calls[0][0].contractId).not.toBe(policyId);
  });

  it('publishes the analysis document itself', async () => {
    // The JSON is the index: it is what carries the references to the files in
    // S3, so it has to go up whole rather than as a summary of itself.
    const h = harness();
    const doc = response();
    await h.service.publish(doc, { coast: 'catambrico' });
    expect(h.upload.mock.calls[0][0].payload).toEqual(doc);
    expect(h.upload.mock.calls[0][0].name).toBe(
      'report_43.5721_-5.7212_' + new Date().toISOString().slice(0, 10),
    );
  });

  it('reports the data address the connector assigned', async () => {
    // Every asset on this deployment currently resolves to the same address,
    // which is why transfers fail. A published report that inherits it is in the
    // catalog and unreadable, and this is the field that says so.
    const h = harness();
    const outcome = await h.service.publish(response(), {
      coast: 'catambrico',
    });
    expect(outcome.dataAddressBaseUrl).toBe('urn:uuid:shared');
  });

  it('files the publication in sync_runs', async () => {
    const h = harness();
    await h.service.publish(response(), { coast: 'catambrico' });
    const row = h.create.mock.calls[0][0];
    expect(row.kind).toBe('publish');
    expect(row.status).toBe('ok');
    expect(row.organizationId).toBeNull();
    expect(row.totals).toEqual({ published: 1 });
    expect(row.results[0]).toMatchObject({
      action: 'created',
      assetId: 'asset-1',
    });
  });

  it('refuses to publish an analysis whose links expire', async () => {
    // Worse than not publishing: the asset stays in the catalog and its
    // references quietly stop resolving.
    const h = harness();
    const outcome = await h.service.publish(
      response({
        plotPdfUrl:
          'https://bucket.s3.eu-central-1.amazonaws.com/plots/report.pdf' +
          '?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=deadbeef',
      }),
      { coast: 'catambrico' },
    );
    expect(outcome.status).toBe('skipped');
    expect(outcome.reason).toMatch(/S3_PUBLIC_BASE_URL/);
    expect(h.upload).not.toHaveBeenCalled();
    // This skip is recorded: an operator has something to fix.
    expect(h.create).toHaveBeenCalledTimes(1);
    expect(h.create.mock.calls[0][0].status).toBe('ok');
    expect(h.create.mock.calls[0][0].totals).toEqual({ published: 0 });
  });

  it('publishes an analysis that has durable links', async () => {
    const h = harness();
    const outcome = await h.service.publish(
      response({
        plotPdfUrl: 'https://cdn.example/plots/report.pdf',
        analysisArchive: {
          pdfUrl: 'https://cdn.example/a/report.pdf',
          jsonUrl: 'https://cdn.example/a/result.json',
          s3Prefix: 's3://bucket/a',
        },
      }),
      { coast: 'catambrico' },
    );
    expect(outcome.status).toBe('published');
  });

  it('will not publish the same analysis twice', async () => {
    const h = harness();
    await h.service.publish(response(), { coast: 'catambrico' });
    const second = await h.service.publish(response(), { coast: 'catambrico' });
    expect(second.status).toBe('skipped');
    expect(second.reason).toMatch(/already published/);
    expect(h.upload).toHaveBeenCalledTimes(1);
  });

  it('lets a failed publication be retried', async () => {
    // The claim on a key is released on failure. A key that stayed claimed after
    // a failed attempt would never be published at all.
    const h = harness();
    h.upload.mockRejectedValueOnce(new Error('connector down'));
    const first = await h.service.publish(response(), { coast: 'catambrico' });
    expect(first.status).toBe('failed');

    const second = await h.service.publish(response(), { coast: 'catambrico' });
    expect(second.status).toBe('published');
  });

  it('forgets the oldest keys rather than growing without bound', async () => {
    // One asset per uncached analysis, so the set of keys is unbounded unless
    // something evicts. Duplicates are accepted; unbounded memory is not.
    const h = harness();
    for (let i = 0; i < 1005; i += 1) {
      const doc = response();
      doc.meta.cache!.cacheKey = `analyses|{"i":${i}}`;
      await h.service.publish(doc, { coast: 'catambrico' });
    }
    expect(h.upload).toHaveBeenCalledTimes(1005);

    const evicted = response();
    evicted.meta.cache!.cacheKey = 'analyses|{"i":0}';
    expect(
      (await h.service.publish(evicted, { coast: 'catambrico' })).status,
    ).toBe('published');

    const remembered = response();
    remembered.meta.cache!.cacheKey = 'analyses|{"i":1004}';
    expect(
      (await h.service.publish(remembered, { coast: 'catambrico' })).status,
    ).toBe('skipped');
  });

  it('records a failure instead of throwing', async () => {
    const h = harness();
    h.contract.mockRejectedValue(new Error('contract refused'));
    const outcome = await h.service.publish(response(), {
      coast: 'catambrico',
    });
    expect(outcome.status).toBe('failed');
    expect(outcome.reason).toMatch(/contract refused/);
    const row = h.create.mock.calls[0][0];
    expect(row.status).toBe('failed');
    expect(row.results[0].action).toBe('failed');
  });

  it('survives losing the audit row', async () => {
    // The publication already happened. Failing to record it must not turn a
    // success into a failure.
    const h = harness();
    h.create.mockRejectedValue(new Error('mongo down'));
    const outcome = await h.service.publish(response(), {
      coast: 'catambrico',
    });
    expect(outcome.status).toBe('published');
  });

  it('skips an analysis with no cache key, which has no identity', async () => {
    const h = harness();
    const doc = response();
    delete doc.meta.cache;
    const outcome = await h.service.publish(doc, { coast: 'catambrico' });
    expect(outcome.status).toBe('skipped');
    expect(h.upload).not.toHaveBeenCalled();
  });

  it('counts every outcome, and only by status', async () => {
    // Labelling by point or by key would create a time series per report.
    const h = harness();
    await h.service.publish(response(), { coast: 'catambrico' });
    h.upload.mockRejectedValueOnce(new Error('nope'));
    const other = response();
    other.meta.cache!.cacheKey = 'analyses|{"b":2}';
    await h.service.publish(other, { coast: 'catambrico' });

    expect(await counter(h.metrics, 'published')).toBe(1);
    expect(await counter(h.metrics, 'failed')).toBe(1);
  });

  describe('publishInBackground', () => {
    it('returns without waiting and never rejects', async () => {
      const h = harness();
      h.upload.mockRejectedValue(new Error('connector down'));
      expect(
        h.service.publishInBackground(response(), { coast: 'catambrico' }),
      ).toBeUndefined();
      await h.service.whenSettled();
      expect(await counter(h.metrics, 'failed')).toBe(1);
    });

    it('publishes the document as it was when the caller got it', async () => {
      // Snapshotted synchronously, so a later mutation of the response does not
      // change what ends up in the catalog.
      const h = harness();
      const doc = response();
      h.service.publishInBackground(doc, { coast: 'catambrico' });
      doc.requestId = 'mutated_afterwards';
      await h.service.whenSettled();
      expect(h.upload.mock.calls[0][0].payload.requestId).toBe('req_abcd1234');
    });
  });
});

describe('expiringReferences', () => {
  it('finds a presigned URL wherever it appears', () => {
    const signed = 'https://b.s3.amazonaws.com/x?X-Amz-Signature=abc';
    expect(expiringReferences(response({ plotPdfUrl: signed }))).toEqual([
      signed,
    ]);
    expect(
      expiringReferences(
        response({ plotWebpPaths: { '2_over_time': signed } }),
      ),
    ).toEqual([signed]);
    expect(
      expiringReferences(
        response({
          analysisArchive: {
            pdfUrl: signed,
            jsonUrl: 'https://cdn.example/x.json',
            s3Prefix: 's3://b/x',
          },
        }),
      ),
    ).toEqual([signed]);
  });

  it('finds nothing in an analysis with no references at all', () => {
    // Nothing to expire, so nothing blocks publication.
    expect(expiringReferences(response())).toEqual([]);
  });

  it('does not mistake a public S3 URL for a signed one', () => {
    expect(
      expiringReferences(
        response({
          plotPdfUrl:
            'https://universalplastic-sedia.s3.eu-central-1.amazonaws.com/public/x/report.pdf',
        }),
      ),
    ).toEqual([]);
  });
});
