import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Asset, AssetDocument } from './schemas/asset.schema';
import { Observation } from './schemas/observation.schema';
import { SyncResultRow } from './schemas/sync-run.schema';
import {
  Organization,
  OrganizationDocument,
} from '../identity/schemas/organization.schema';
import { GeoPoint, point } from './schemas/geo.schema';
import {
  CATEGORY_BY_TYPE,
  DatasetType,
  tierForProviderFolder,
} from './dataspace.constants';
import { resolveLocation } from './asset-location';
import {
  AssetNotFoundError,
  DataspaceSource,
  SourceEntry,
} from './source/dataspace-source';
import { classifyEntry } from './source/asset-map';
import { validateContainer } from './validate-container';
import { validateAgainstDcat } from './validate-dcat';
import { CanonicalObservation, normalizeDataset } from './normalize';
import { buildSummary, dateRangeOf } from './asset-summary';

export class InvalidAssetError extends Error {
  constructor(
    message: string,
    readonly errors: string[],
  ) {
    super(message);
    this.name = 'InvalidAssetError';
  }
}

/** The asset is offered, but the API does not know what it is. */
export class UnclassifiedAssetError extends Error {
  constructor(
    readonly sourceId: string,
    reason: string,
  ) {
    super(reason);
    this.name = 'UnclassifiedAssetError';
  }
}

/** A schema or metadata document. Published alongside datasets, and not one. */
export class NonDataAssetError extends Error {
  constructor(readonly sourceId: string) {
    super(`asset ${sourceId} is a schema or metadata document, not a dataset`);
    this.name = 'NonDataAssetError';
  }
}

export interface IngestOptions {
  force?: boolean;
  syncRunId?: Types.ObjectId | null;
}

export interface IngestOutcome extends SyncResultRow {
  action: 'created' | 'updated' | 'unchanged';
  assetId: string;
  observations: number;
  warnings: string[];
}

const INSERT_CHUNK = 2000;

/** Exactly the fields an ingest writes onto an asset. */
interface AssetUpsert {
  sourceId: string;
  label: string | null;
  providerBpn: string | null;
  url: string | null;
  tier: 'observed' | 'reference';
  providerFolder: string | null;
  datasetType: string;
  category: string;
  organizationId: Types.ObjectId | null;
  dataProviderIdRaw: string | null;
  ocean: string;
  place: string | null;
  placeName: string | null;
  city: string | null;
  location: GeoPoint;
  schemaVersion: string | null;
  dcatSchemaRef: string | null;
  format: string;
  units: Record<string, string>;
  recordCount: number;
  observationCount: number;
  dateRange: { start: string; end: string } | null;
  summary: Record<string, unknown>;
  warnings: string[];
  status: 'active';
  currentIngestId: Types.ObjectId;
  etag: string | null;
  checksum: string | null;
  sizeBytes: number | null;
  sourceLastModified: Date | null;
  lastSyncedAt: Date;
  lastSyncRunId: Types.ObjectId | null;
  lastError: string | null;
}

/** Top-level records in the source file, before nested windows are expanded. */
function sourceRecordCount(dataset: Record<string, unknown>): number {
  const records = dataset['records'];
  if (Array.isArray(records)) return records.length;
  const columns = dataset['columns'];
  if (columns && typeof columns === 'object') {
    const first = Object.values(columns as Record<string, unknown>).find((v) =>
      Array.isArray(v),
    );
    return Array.isArray(first) ? first.length : 0;
  }
  return 0;
}

function unitsOf(metadata: Record<string, unknown>): Record<string, string> {
  const units = metadata['units'];
  if (!units || typeof units !== 'object' || Array.isArray(units)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(units as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);

  constructor(
    @InjectModel(Asset.name) private readonly assets: Model<Asset>,
    @InjectModel(Observation.name)
    private readonly observations: Model<Observation>,
    @InjectModel(Organization.name)
    private readonly organizations: Model<Organization>,
  ) {}

  /** Matches a file's provider folder / declared provider id to an organization. */
  private async resolveOrganization(
    providerFolder: string,
    dataProviderIdRaw: string | null,
  ): Promise<OrganizationDocument | null> {
    const candidates = [providerFolder, dataProviderIdRaw].filter(
      (x): x is string => !!x,
    );
    if (!candidates.length) return null;
    return this.organizations
      .findOne({
        $or: [
          { providerFolders: { $in: candidates } },
          { dataProviderIds: { $in: candidates } },
          { slug: { $in: candidates.map((c) => c.toLowerCase()) } },
        ],
      })
      .exec();
  }

  /**
   * Transfers one asset, validates it, normalizes it and replaces its
   * observations.
   *
   * The unchanged check happens after the transfer, not before it. The catalog
   * carries no version, date or checksum, so there is nothing to compare until
   * the content is in hand; what is saved is the reprocessing and the write, not
   * the fetch.
   */
  async ingestEntry(
    entry: SourceEntry,
    source: DataspaceSource,
    options: IngestOptions = {},
  ): Promise<IngestOutcome> {
    const sourceId = entry.ref.id;
    const classification = classifyEntry(entry);
    if (classification.skipped) throw new NonDataAssetError(sourceId);
    if (!classification.classified) {
      throw new UnclassifiedAssetError(
        sourceId,
        classification.warning ?? `asset ${sourceId} could not be classified`,
      );
    }
    const parsed = classification.classified;

    const fetched = await source.get(entry.ref);
    const existing = await this.assets.findOne({ sourceId }).exec();

    if (
      !options.force &&
      existing &&
      existing.status === 'active' &&
      existing.checksum &&
      existing.checksum === fetched.checksum
    ) {
      return {
        sourceId,
        label: entry.ref.label,
        action: 'unchanged',
        assetId: String(existing._id),
        observations: existing.observationCount,
        warnings: [],
      };
    }

    const container = validateContainer(fetched.json, parsed.datasetType);
    if (!container.ok || !container.envelope || !container.datasetType) {
      await this.markFailed(
        sourceId,
        container.errors.join('; '),
        options.syncRunId ?? null,
      );
      throw new InvalidAssetError(
        `asset ${entry.ref.label} (${sourceId}) failed container validation`,
        container.errors,
      );
    }

    const datasetType: DatasetType = container.datasetType;
    const category = CATEGORY_BY_TYPE[datasetType];
    const { metadata, dataset } = container.envelope;
    const warnings = [...container.warnings];

    const location = resolveLocation(
      sourceId,
      metadata['location'] as { lat?: unknown; lon?: unknown } | null,
      parsed.station,
    );
    warnings.push(...location.warnings);

    const normalized = normalizeDataset(datasetType, dataset);
    warnings.push(...normalized.warnings);
    if (normalized.skipped) {
      const samples = normalized.skippedSamples
        .slice(0, 5)
        .map((v) => JSON.stringify(v))
        .join(', ');
      warnings.push(
        `${normalized.skipped} records skipped for lacking a usable date${samples ? ` (e.g. ${samples})` : ''}`,
      );
    }

    const dcat = await validateAgainstDcat({ datasetType, dataset, metadata });
    warnings.push(...dcat.warnings);

    const derivedRange = dateRangeOf(normalized.observations);
    const metaRange = metadata['dateRange'] as
      | { start?: unknown; end?: unknown }
      | null
      | undefined;
    if (
      metaRange &&
      typeof metaRange.start === 'string' &&
      typeof metaRange.end === 'string'
    ) {
      if (metaRange.start > metaRange.end) {
        warnings.push(
          `metadata.dateRange is inverted (${metaRange.start} → ${metaRange.end}); derived range used`,
        );
      } else if (
        derivedRange &&
        (metaRange.start !== derivedRange.start ||
          metaRange.end !== derivedRange.end)
      ) {
        warnings.push(
          `metadata.dateRange ${metaRange.start}→${metaRange.end} differs from the records ${derivedRange.start}→${derivedRange.end}; derived range used`,
        );
      }
    }

    const dataProviderIdRaw =
      typeof metadata['dataProviderId'] === 'string'
        ? (metadata['dataProviderId'] as string)
        : null;
    const organization = await this.resolveOrganization(
      parsed.providerFolder,
      dataProviderIdRaw,
    );
    if (!organization) {
      warnings.push(
        `no organization matches provider folder "${parsed.providerFolder}" / dataProviderId "${dataProviderIdRaw ?? '—'}"`,
      );
    }

    const assetDoc: AssetUpsert = {
      sourceId,
      label: entry.ref.label,
      providerBpn:
        (entry.ref.payload as { providerBpn?: string } | undefined)
          ?.providerBpn ?? null,
      url: fetched.url ?? null,
      // Decided once, here, and stored. Every tier-aware read filters on the
      // field; none of them re-derive it from the key.
      tier: tierForProviderFolder(parsed.providerFolder),
      providerFolder: parsed.providerFolder,
      datasetType,
      category,
      organizationId: organization?._id ?? null,
      dataProviderIdRaw,
      ocean: parsed.ocean,
      place: parsed.place,
      placeName: parsed.station?.name ?? null,
      city: parsed.station?.city ?? null,
      location: point(location.lat, location.lon),
      schemaVersion:
        typeof metadata['schemaVersion'] === 'string'
          ? (metadata['schemaVersion'] as string)
          : null,
      dcatSchemaRef:
        typeof metadata['dcatSchemaRef'] === 'string'
          ? (metadata['dcatSchemaRef'] as string)
          : null,
      format: normalized.shape,
      units: unitsOf(metadata),
      recordCount: sourceRecordCount(dataset),
      observationCount: normalized.observations.length,
      dateRange: derivedRange,
      summary: buildSummary(category, normalized.observations),
      warnings,
      status: 'active' as const,
      etag: fetched.etag ?? null,
      checksum: fetched.checksum,
      sizeBytes: fetched.sizeBytes,
      sourceLastModified: fetched.lastModified ?? null,
      lastSyncedAt: new Date(),
      lastSyncRunId: options.syncRunId ?? null,
      lastError: null,
      // Replaced with the real generation id by publishGeneration.
      currentIngestId: new Types.ObjectId(),
    };

    const action: 'created' | 'updated' = existing ? 'updated' : 'created';
    const assetId = await this.publishGeneration(
      assetDoc,
      normalized.observations,
      organization?._id ?? null,
    );

    this.logger.log(
      `${action} ${entry.ref.label} (${sourceId}) → ${normalized.observations.length} observations, ${warnings.length} warnings`,
    );

    return {
      sourceId,
      label: entry.ref.label,
      action,
      assetId: String(assetId),
      observations: normalized.observations.length,
      warnings,
    };
  }

  /**
   * Publishes a new generation of observations for an asset.
   *
   *   1. reserve the asset row (so the observations have an id to hang off)
   *   2. insert the whole new generation — invisible, because the asset still
   *      points at the previous one
   *   3. flip the asset to the new generation in one document update, which also
   *      publishes the metadata describing it
   *   4. delete every other generation
   *
   * Only step 3 has to be atomic, and it is a single small update, so ingest time
   * no longer has to fit inside a server transaction window. A failure before
   * step 3 leaves readers on the previous generation and abandons the partial
   * write, which step 4 of the next successful ingest cleans up.
   */
  private async publishGeneration(
    assetDoc: AssetUpsert,
    observations: CanonicalObservation[],
    organizationId: Types.ObjectId | null,
  ): Promise<Types.ObjectId> {
    const ingestId = new Types.ObjectId();

    const reserved = await this.assets
      .findOneAndUpdate(
        { sourceId: assetDoc.sourceId },
        {
          $setOnInsert: {
            sourceId: assetDoc.sourceId,
            url: assetDoc.url,
            datasetType: assetDoc.datasetType,
            category: assetDoc.category,
            ocean: assetDoc.ocean,
            location: assetDoc.location,
            format: assetDoc.format,
            status: 'active',
            currentIngestId: null,
          },
        },
        { upsert: true, returnDocument: 'after' },
      )
      .exec();
    const assetId = reserved!._id;

    const docs = observations.map((o) => ({
      assetId,
      ingestId,
      datasetType: assetDoc.datasetType,
      category: assetDoc.category,
      organizationId,
      ocean: assetDoc.ocean,
      place: assetDoc.place,
      placeName: assetDoc.placeName,
      city: assetDoc.city,
      date: o.date,
      time: o.time,
      ts: o.ts,
      eventDate: o.eventDate,
      location: o.lat !== null && o.lon !== null ? point(o.lat, o.lon) : null,
      values: o.values,
      raw: o.raw ?? null,
    }));

    for (let i = 0; i < docs.length; i += INSERT_CHUNK) {
      // Unordered so the driver can write a batch in parallel.
      await this.observations.insertMany(docs.slice(i, i + INSERT_CHUNK), {
        ordered: false,
      });
    }

    // The moment the new data becomes visible.
    await this.assets
      .updateOne(
        { _id: assetId },
        { $set: { ...assetDoc, currentIngestId: ingestId } },
      )
      .exec();

    // Previous generation, plus anything an earlier failed ingest abandoned.
    try {
      await this.observations
        .deleteMany({ assetId, ingestId: { $ne: ingestId } })
        .exec();
    } catch (e) {
      this.logger.warn(
        `stale observations left behind for ${assetDoc.sourceId}: ${(e as Error).message}. They are not served; the next sync removes them.`,
      );
    }

    return assetId;
  }

  /** Records a validation/fetch failure on the asset without dropping its data. */
  private async markFailed(
    sourceId: string,
    error: string,
    syncRunId: Types.ObjectId | null,
  ): Promise<void> {
    await this.assets
      .updateOne(
        { sourceId },
        {
          $set: {
            status: 'failed',
            lastError: error,
            lastSyncedAt: new Date(),
            lastSyncRunId: syncRunId,
          },
        },
      )
      .exec();
  }

  /**
   * Flags an asset the space no longer offers. Observations are kept.
   *
   * Reserved for an asset that genuinely disappeared from every catalog. An
   * asset that is merely unreadable — a lapsed contract, a provider serving no
   * data — is not missing, and marking it so would discard valid observations.
   */
  async markMissing(
    sourceId: string,
    syncRunId: Types.ObjectId | null,
  ): Promise<AssetDocument | null> {
    return this.assets
      .findOneAndUpdate(
        { sourceId },
        {
          $set: {
            status: 'missing',
            lastSyncedAt: new Date(),
            lastSyncRunId: syncRunId,
          },
        },
        { new: true },
      )
      .exec();
  }

  static isNotFound(e: unknown): boolean {
    return e instanceof AssetNotFoundError;
  }
}
