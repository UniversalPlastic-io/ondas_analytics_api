import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import { AnalysesRunResponse } from '../analyses/analyses.types';
import { SyncRun } from './schemas/sync-run.schema';
import { DSPACER_CLIENT, DspacerClient } from './source/dspacer.client';
import {
  dspacerConfigured,
  dspacerPublishEnabled,
} from './dataspace.constants';
import { reportIdentity } from './report-identity';
import { MetricsService } from '../../metrics/metrics.service';

/**
 * Publishes a generated analysis into the space as an asset of our own.
 *
 * Until now the API only consumed the space. This makes it a provider too: every
 * analysis it produces becomes an asset in Universal Plastic's catalog, offered
 * to every participant, so a public result is citable by whoever else needs it.
 *
 * The files — plot images, the PDF — stay in S3. What is published is the
 * analysis JSON, which is what holds the references to them. The JSON is the
 * index; S3 is the store.
 *
 * Three connector calls, in this order, because the last two need the id the
 * first returns:
 *
 *   1. POST /data/upload                                 → the asset
 *   2. POST /policies/create/{id}/no_restriction         → a policy anyone meets
 *   3. POST /contracts/create                            → puts it in the catalog
 *
 * An asset without step 3 is stored on the connector and offered to nobody, so a
 * failure there is a failure of the whole publication, not a partial success.
 */

export type PublishStatus = 'published' | 'skipped' | 'failed';

export interface PublishOutcome {
  status: PublishStatus;
  /** Why, for the two statuses that are not a plain success. */
  reason?: string;
  assetId?: string;
  name?: string;
  digest?: string;
  /**
   * The address the connector assigned the uploaded document.
   *
   * Recorded because every asset on this deployment currently resolves to the
   * same one, which is why `POST /transfer/request` returns nothing usable. If a
   * published report inherits it, the report is in the catalog and cannot be
   * read — and this is the field that says so, rather than the problem surfacing
   * as a consumer complaint months later.
   */
  dataAddressBaseUrl?: string | null;
}

export interface PublishContext {
  /** The coast the request resolved to. Not in the response, so it is passed. */
  coast: string;
}

/**
 * How many cache keys the process remembers having published.
 *
 * Bounded because the catalog is not: one asset per uncached analysis, and an
 * unbounded set would hold every key the process ever saw. Evicting the oldest
 * means a long-idle key can publish twice, which §5 of the design already
 * accepts — duplicates are tolerated, silent memory growth is not.
 */
const MAX_REMEMBERED_KEYS = 1000;

/** Query parameters AWS adds when it presigns. Their presence means expiry. */
const PRESIGNED_MARKERS = ['x-amz-signature', 'x-amz-credential'];

/**
 * Every external reference the published document carries.
 *
 * Collected from the response rather than from configuration: what matters is
 * what the document actually points at.
 */
function referencesOf(response: AnalysesRunResponse): string[] {
  const out: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === 'string' && v) out.push(v);
  };
  push(response.plotPdfUrl);
  push(response.plotPdfPath);
  for (const v of Object.values(response.plotWebpPaths ?? {})) push(v);
  push(response.analysisArchive?.pdfUrl);
  push(response.analysisArchive?.jsonUrl);
  return out;
}

/**
 * The references that will stop resolving.
 *
 * `uploadPlotsToS3` presigns unless `S3_PUBLIC_BASE_URL` is set, and a presigned
 * URL expires. A published analysis whose links expire is worse than one never
 * published: it stays in the catalog and quietly stops resolving.
 *
 * The test is on the URL, not on the configuration that produced it. The
 * configuration is the cause and the signature is the symptom, and the symptom
 * is the thing that is actually true of the document being published. A response
 * with no references at all has nothing to expire and publishes fine.
 */
export function expiringReferences(response: AnalysesRunResponse): string[] {
  return referencesOf(response).filter((url) => {
    const lower = url.toLowerCase();
    return PRESIGNED_MARKERS.some((marker) => lower.includes(marker));
  });
}

@Injectable()
export class PublishService {
  private readonly logger = new Logger(PublishService.name);

  /** Cache keys already published by this process. Insertion-ordered. */
  private readonly published = new Set<string>();

  /** Publications still in flight. Lets a test await them; nothing else reads it. */
  private readonly pending = new Set<Promise<unknown>>();

  constructor(
    @Inject(DSPACER_CLIENT) private readonly client: DspacerClient,
    @InjectModel(SyncRun.name) private readonly runs: Model<SyncRun>,
    private readonly metrics: MetricsService,
  ) {}

  /**
   * Publishes without making the caller wait, and without letting a failure
   * reach them.
   *
   * The analysis is the product; publishing it is distribution. A request must
   * not fail, or take longer, because the connector is slow or down.
   *
   * The accepted consequence: the response cannot carry a warning that
   * publication failed, because it has already been sent. The outcome goes to the
   * log, to `ondas_reports_published_total` and to a `sync_runs` row instead.
   *
   * The document is snapshotted here, synchronously, so what gets published is
   * what the caller was given — not a version something mutated afterwards.
   */
  publishInBackground(
    response: AnalysesRunResponse,
    ctx: PublishContext,
  ): void {
    let snapshot: AnalysesRunResponse;
    try {
      snapshot = structuredClone(response);
    } catch (e) {
      // A response that cannot be cloned cannot be serialized either, so it was
      // never publishable. Nothing about the request changes.
      this.logger.warn(
        `not publishing: the analysis could not be snapshotted (${(e as Error).message})`,
      );
      this.metrics.recordReportPublished('failed');
      return;
    }

    const task = this.publish(snapshot, ctx).catch((e) => {
      // publish() already handles its own failures; this is the backstop for a
      // defect in it, which must still not become an unhandled rejection.
      this.logger.error(
        `publishing an analysis threw unexpectedly: ${(e as Error).message}`,
      );
      return { status: 'failed' as const, reason: 'unexpected error' };
    });
    this.pending.add(task);
    void task.finally(() => this.pending.delete(task));
  }

  /** Resolves once every background publication has settled. For tests. */
  async whenSettled(): Promise<void> {
    while (this.pending.size) {
      await Promise.allSettled([...this.pending]);
    }
  }

  /**
   * Publishes one analysis and reports what happened. Never throws.
   *
   * Everything the identity needs is read from the response itself, so the name
   * and the published document cannot disagree about which analysis this is.
   */
  async publish(
    response: AnalysesRunResponse,
    ctx: PublishContext,
  ): Promise<PublishOutcome> {
    if (!dspacerPublishEnabled()) {
      // Counted but not recorded: a row per analysis on every deployment that
      // has publishing off would bury the rows that mean something.
      this.metrics.recordReportPublished('skipped');
      return { status: 'skipped', reason: 'publishing is disabled' };
    }

    if (!dspacerConfigured()) {
      this.logger.warn(
        'DSPACER_PUBLISH_ENABLED is on but DSPACER_* is incomplete; nothing will be published',
      );
      this.metrics.recordReportPublished('skipped');
      return { status: 'skipped', reason: 'the connector is not configured' };
    }

    const cacheKey = response.meta?.cache?.cacheKey;
    if (!cacheKey) {
      this.logger.warn(
        'not publishing: the analysis carries no cache key, so it has no identity',
      );
      this.metrics.recordReportPublished('skipped');
      return { status: 'skipped', reason: 'the analysis has no cache key' };
    }

    const expiring = expiringReferences(response);
    if (expiring.length) {
      const reason =
        `${expiring.length} of its references are presigned URLs, which expire. ` +
        `Set S3_PUBLIC_BASE_URL so the analysis points at durable URLs.`;
      this.logger.warn(`not publishing ${cacheKey}: ${reason}`);
      this.metrics.recordReportPublished('skipped');
      await this.record({ status: 'skipped', reason }, { cacheKey, ctx });
      return { status: 'skipped', reason };
    }

    if (this.published.has(cacheKey)) {
      this.metrics.recordReportPublished('skipped');
      return {
        status: 'skipped',
        reason: 'this analysis was already published by this process',
      };
    }

    const identity = reportIdentity({
      location: response.input.location,
      area: response.input.area,
      dateRange: response.meta.dateRangeApplied,
      aggregation: response.meta.aggregation.mode,
      analyses: response.executedAnalyses,
      coast: ctx.coast,
      cacheKey,
      generatedAt: new Date(),
    });

    // Claimed before the upload so two concurrent identical requests do not both
    // publish. Released again on failure: a key that stayed claimed after a
    // failed attempt would never be retried.
    this.remember(cacheKey);
    const startedAt = new Date();

    try {
      const asset = await this.client.uploadData({
        name: identity.name,
        description: identity.description,
        payload: response,
      });

      // Ours to choose, and fresh per publication so two never collide.
      const policyId = randomUUID();
      const contractId = randomUUID();
      await this.client.createNoRestrictionPolicy(policyId);
      await this.client.createContract({
        contractId,
        policyId,
        assetId: asset.id,
      });

      const outcome: PublishOutcome = {
        status: 'published',
        assetId: asset.id,
        name: identity.name,
        digest: identity.digest,
        dataAddressBaseUrl: asset.dataAddressBaseUrl,
      };
      this.metrics.recordReportPublished(
        'published',
        (Date.now() - startedAt.getTime()) / 1000,
      );
      this.logger.log(
        `published ${identity.name} as asset ${asset.id} (key ${identity.digest})`,
      );
      await this.record(outcome, {
        cacheKey,
        ctx,
        identity,
        startedAt,
        policyId,
        contractId,
      });
      return outcome;
    } catch (e) {
      this.published.delete(cacheKey);
      const reason = (e as Error).message;
      this.metrics.recordReportPublished(
        'failed',
        (Date.now() - startedAt.getTime()) / 1000,
      );
      this.logger.error(`could not publish ${identity.name}: ${reason}`);
      await this.record(
        { status: 'failed', reason },
        {
          cacheKey,
          ctx,
          identity,
          startedAt,
        },
      );
      return { status: 'failed', reason };
    }
  }

  private remember(cacheKey: string): void {
    this.published.add(cacheKey);
    while (this.published.size > MAX_REMEMBERED_KEYS) {
      const oldest = this.published.values().next().value;
      if (oldest === undefined) return;
      this.published.delete(oldest);
    }
  }

  /**
   * Files the outcome in `sync_runs`, so `GET /v1/sync/runs` shows publications
   * beside ingests and the trail is auditable without a second collection.
   *
   * Start and finish are one write: a publication is three calls, not a scan, and
   * a `running` row would only ever be seen by a query that happened to land in
   * the middle of it.
   *
   * `organizationId` is null. A publication is the system acting, not a member
   * of an organization, and the same analysis is published whoever asked for it.
   */
  private async record(
    outcome: PublishOutcome,
    meta: {
      cacheKey: string;
      ctx: PublishContext;
      identity?: { name: string; digest: string };
      startedAt?: Date;
      policyId?: string;
      contractId?: string;
    },
  ): Promise<void> {
    const startedAt = meta.startedAt ?? new Date();
    try {
      await this.runs.create({
        kind: 'publish',
        userId: null,
        organizationId: null,
        input: {
          cacheKey: meta.cacheKey,
          coast: meta.ctx.coast,
          name: meta.identity?.name ?? null,
          digest: meta.identity?.digest ?? null,
          policyId: meta.policyId ?? null,
          contractId: meta.contractId ?? null,
        },
        startedAt,
        finishedAt: new Date(),
        // A refusal is not a failure: the row says `ok`, publishes nothing and
        // carries the reason as a warning. Only a connector error is `failed`.
        status: outcome.status === 'failed' ? 'failed' : 'ok',
        results: [
          {
            sourceId: outcome.assetId ?? meta.cacheKey,
            label: meta.identity?.name,
            action:
              outcome.status === 'published'
                ? 'created'
                : outcome.status === 'failed'
                  ? 'failed'
                  : 'skipped',
            assetId: outcome.assetId,
            error: outcome.reason,
          },
        ],
        totals: { published: outcome.status === 'published' ? 1 : 0 },
        warnings:
          outcome.status === 'published' ? [] : [outcome.reason ?? 'unknown'],
      });
    } catch (e) {
      // The publication itself already happened or already failed. Losing the
      // audit row must not turn one outcome into the other.
      this.logger.warn(
        `could not record the publication of ${meta.identity?.name ?? meta.cacheKey}: ${(e as Error).message}`,
      );
    }
  }
}
