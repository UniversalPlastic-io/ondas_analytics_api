import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Asset } from './schemas/asset.schema';
import {
  SyncKind,
  SyncResultRow,
  SyncRun,
  SyncRunDocument,
  SyncStatus,
} from './schemas/sync-run.schema';
import { Organization } from '../identity/schemas/organization.schema';
import {
  IngestService,
  InvalidAssetError,
  NonDataAssetError,
  UnclassifiedAssetError,
} from './ingest.service';
import {
  AssetForbiddenError,
  AssetNotFoundError,
  DATASPACE_SOURCE,
  DataspaceSource,
  SourceEntry,
} from './source/dataspace-source';
import { MetricsService } from '../../metrics/metrics.service';

export interface SyncActor {
  userId: string | null;
  organizationId: string | null;
  role: 'admin' | 'provider' | 'viewer';
}

export interface SyncRunSummary {
  runId: string;
  /**
   * Widened to every kind the collection stores, because this mirrors a stored
   * row. `startRun` stays narrow: a sync can only ever start a sync.
   */
  kind: SyncKind;
  status: SyncStatus;
  startedAt: Date;
  finishedAt: Date | null;
  totals: Record<string, number>;
  results: SyncResultRow[];
  warnings: string[];
}

/**
 * Kept low on purpose. The limit is the contract negotiation, not the database:
 * each transfer is a full negotiation on the provider's connector, and a scan
 * that opens many at once is the kind of load a partner did not agree to.
 */
const SCAN_CONCURRENCY = 2;

/** Runs `tasks` with a bounded number in flight, preserving input order. */
async function pooled<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        if (index >= items.length) return;
        results[index] = await worker(items[index]);
      }
    },
  );
  await Promise.all(runners);
  return results;
}

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private readonly ingest: IngestService,
    @InjectModel(Asset.name) private readonly assets: Model<Asset>,
    @InjectModel(SyncRun.name) private readonly runs: Model<SyncRun>,
    @InjectModel(Organization.name)
    private readonly organizations: Model<Organization>,
    private readonly metrics: MetricsService,
    @Inject(DATASPACE_SOURCE) private readonly source: DataspaceSource,
  ) {
    // Read from Mongo on every scrape rather than kept in step with each write:
    // an ingest is not the only thing that changes the count.
    this.metrics.bindActiveAssets(() =>
      this.assets.countDocuments({ status: 'active' }).exec(),
    );
  }

  /**
   * The provider folders an actor may sync. Null for an admin, meaning all.
   *
   * Note this narrows what the API will act on; it never widens it. The data
   * space has already decided what this connector can see at all, through the
   * contracts each provider granted.
   */
  private async allowedFolders(actor: SyncActor): Promise<string[] | null> {
    if (actor.role === 'admin') return null;
    if (!actor.organizationId) return [];
    const org = await this.organizations.findById(actor.organizationId).exec();
    return org?.providerFolders ?? [];
  }

  private folderOf(entry: SourceEntry): string | null {
    return this.source.classify(entry)?.providerFolder ?? null;
  }

  private async startRun(
    kind: 'asset' | 'scan',
    actor: SyncActor,
    input: Record<string, unknown>,
  ): Promise<Types.ObjectId> {
    const run = await this.runs.create({
      kind,
      userId: actor.userId ? new Types.ObjectId(actor.userId) : null,
      organizationId: actor.organizationId
        ? new Types.ObjectId(actor.organizationId)
        : null,
      input,
      startedAt: new Date(),
      status: 'running',
      results: [],
      totals: {},
      warnings: [],
    });
    return run._id;
  }

  private async finishRun(
    runId: Types.ObjectId,
    results: SyncResultRow[],
    warnings: string[],
  ): Promise<SyncRunSummary> {
    const totals = {
      assets: results.length,
      created: results.filter((r) => r.action === 'created').length,
      updated: results.filter((r) => r.action === 'updated').length,
      unchanged: results.filter((r) => r.action === 'unchanged').length,
      missing: results.filter((r) => r.action === 'missing').length,
      skipped: results.filter((r) => r.action === 'skipped').length,
      failed: results.filter((r) => r.action === 'failed').length,
      observations: results.reduce((a, r) => a + (r.observations ?? 0), 0),
      warnings:
        results.reduce((a, r) => a + (r.warnings?.length ?? 0), 0) +
        warnings.length,
    };
    const failed = totals.failed;
    const status: SyncStatus =
      failed === 0 ? 'ok' : failed === results.length ? 'failed' : 'partial';
    const finishedAt = new Date();

    const run = await this.runs
      .findByIdAndUpdate(
        runId,
        { $set: { results, totals, warnings, status, finishedAt } },
        { new: true },
      )
      .exec();

    const kind = run?.kind ?? 'scan';
    this.metrics.recordSyncRun({ kind, status, totals, warnings });

    return {
      runId: String(runId),
      kind,
      status,
      startedAt: run?.startedAt ?? finishedAt,
      finishedAt,
      totals,
      results,
      warnings,
    };
  }

  /** Ingests one asset the caller names by its id in the space. */
  async syncAsset(
    sourceId: string,
    opts: { force?: boolean; actor: SyncActor },
  ): Promise<SyncRunSummary> {
    const listing = await this.source.list();
    const entry = listing.entries.find((e) => e.ref.id === sourceId);

    const runId = await this.startRun('asset', opts.actor, {
      sourceId,
      force: !!opts.force,
    });

    if (!entry) {
      return this.finishRun(
        runId,
        [
          {
            sourceId,
            action: 'missing',
            error: 'no provider in the space offers this asset to us',
          },
        ],
        listing.warnings,
      );
    }

    await this.assertEntryAllowed(opts.actor, entry);
    const row = await this.ingestOne(entry, {
      force: opts.force,
      syncRunId: runId,
    });
    return this.finishRun(runId, [row], listing.warnings);
  }

  private async assertEntryAllowed(
    actor: SyncActor,
    entry: SourceEntry,
  ): Promise<void> {
    const folders = await this.allowedFolders(actor);
    if (folders === null) return;
    const folder = this.folderOf(entry);
    if (!folder || !folders.includes(folder)) {
      throw new ForbiddenException(
        `your organization may only sync its own assets (${folders.join(', ') || 'none configured'})`,
      );
    }
  }

  private async ingestOne(
    entry: SourceEntry,
    opts: { force?: boolean; syncRunId: Types.ObjectId },
  ): Promise<SyncResultRow> {
    const sourceId = entry.ref.id;
    const label = entry.ref.label;
    try {
      return await this.ingest.ingestEntry(entry, this.source, {
        force: opts.force,
        syncRunId: opts.syncRunId,
      });
    } catch (e) {
      if (e instanceof NonDataAssetError) {
        return {
          sourceId,
          label,
          action: 'skipped',
          error: 'schema or metadata document, not a dataset',
        };
      }
      if (e instanceof UnclassifiedAssetError) {
        return { sourceId, label, action: 'skipped', error: e.message };
      }
      if (e instanceof AssetNotFoundError) {
        const marked = await this.ingest.markMissing(sourceId, opts.syncRunId);
        return {
          sourceId,
          label,
          action: 'missing',
          assetId: marked ? String(marked._id) : undefined,
          error: 'the space no longer offers this asset',
        };
      }
      if (e instanceof AssetForbiddenError) {
        // Readable yesterday, refused today. The asset still exists and its
        // observations remain valid, so it is reported as failed rather than
        // missing: `missing` is for something that is gone.
        return { sourceId, label, action: 'failed', error: e.message };
      }
      if (e instanceof InvalidAssetError) {
        return {
          sourceId,
          label,
          action: 'failed',
          error: e.errors.join('; '),
        };
      }
      this.logger.error(`ingest failed for ${label}: ${(e as Error).message}`);
      return { sourceId, label, action: 'failed', error: (e as Error).message };
    }
  }

  /**
   * Reconciles the read model against what the space currently offers.
   *
   * Every asset is transferred: the catalog exposes no version, date or
   * checksum, so an unchanged asset is only recognisable once its content has
   * been hashed. What the check saves is the reprocessing and the write.
   */
  async scan(opts: {
    provider?: string;
    dryRun?: boolean;
    force?: boolean;
    actor: SyncActor;
  }): Promise<SyncRunSummary> {
    const allowed = await this.allowedFolders(opts.actor);
    const listing = await this.source.list();
    const warnings = [...listing.warnings];

    let candidates = listing.entries;
    if (opts.provider) {
      const wanted = opts.provider.toLowerCase();
      candidates = candidates.filter(
        (e) =>
          e.provider.toLowerCase() === wanted ||
          this.folderOf(e)?.toLowerCase() === wanted,
      );
      if (!candidates.length) {
        warnings.push(`no assets matched provider "${opts.provider}"`);
      }
    }

    if (allowed !== null) {
      const before = candidates.length;
      candidates = candidates.filter((e) => {
        const folder = this.folderOf(e);
        return !!folder && allowed.includes(folder);
      });
      if (candidates.length !== before) {
        warnings.push(
          `${before - candidates.length} assets outside your organization were not considered`,
        );
      }
    }

    const runId = await this.startRun('scan', opts.actor, {
      provider: opts.provider ?? null,
      dryRun: !!opts.dryRun,
      force: !!opts.force,
      offered: listing.entries.length,
    });

    const results = await pooled(
      candidates,
      SCAN_CONCURRENCY,
      async (entry): Promise<SyncResultRow> => {
        if (opts.dryRun) {
          const existing = await this.assets
            .findOne({ sourceId: entry.ref.id })
            .select('_id')
            .exec();
          return {
            sourceId: entry.ref.id,
            label: entry.ref.label,
            action: existing ? 'updated' : 'created',
            assetId: existing ? String(existing._id) : undefined,
          };
        }
        return this.ingestOne(entry, { force: opts.force, syncRunId: runId });
      },
    );

    // Assets we hold that the space no longer offers. Provable here because a
    // catalog listing is complete by construction, unlike a partial one.
    const offered = new Set(listing.entries.map((e) => e.ref.id));
    const orphanFilter: Record<string, unknown> = {
      status: 'active',
      sourceId: { $nin: [...offered] },
    };
    if (allowed !== null && opts.actor.organizationId) {
      orphanFilter.organizationId = new Types.ObjectId(
        opts.actor.organizationId,
      );
    }
    const orphans = await this.assets
      .find(orphanFilter)
      .select('sourceId label')
      .exec();
    for (const orphan of orphans) {
      if (!opts.dryRun) await this.ingest.markMissing(orphan.sourceId, runId);
      results.push({
        sourceId: orphan.sourceId,
        label: orphan.label ?? undefined,
        action: 'missing',
        assetId: String(orphan._id),
      });
    }

    if (opts.dryRun) warnings.push('dryRun: nothing was written');
    return this.finishRun(runId, results, warnings);
  }

  async listRuns(actor: SyncActor, limit = 20): Promise<SyncRunDocument[]> {
    const filter: Record<string, unknown> = {};
    if (actor.role !== 'admin' && actor.organizationId) {
      filter.organizationId = new Types.ObjectId(actor.organizationId);
    }
    return this.runs
      .find(filter)
      .sort({ startedAt: -1 })
      .limit(Math.min(limit, 100))
      .exec();
  }

  async getRun(id: string, actor: SyncActor): Promise<SyncRunDocument> {
    if (!Types.ObjectId.isValid(id))
      throw new NotFoundException('sync run not found');
    const run = await this.runs.findById(id).exec();
    if (!run) throw new NotFoundException('sync run not found');
    if (
      actor.role !== 'admin' &&
      run.organizationId &&
      String(run.organizationId) !== String(actor.organizationId)
    ) {
      throw new ForbiddenException(
        'this sync run belongs to another organization',
      );
    }
    return run;
  }
}
