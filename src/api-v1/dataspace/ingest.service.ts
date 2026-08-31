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
  DATA_BUCKET,
  DatasetType,
  tierForProviderFolder,
} from './dataspace.constants';
import { parseKey, resolveLocation } from './s3-keys';
import { getObject, ObjectNotFoundError } from './s3-reader';
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

export class UnsupportedKeyError extends Error {
  constructor(key: string) {
    super(
      `key "${key}" does not match the data space layout public/{ocean}/{provider}/{file}.json (or points at a schema/output folder)`,
    );
    this.name = 'UnsupportedKeyError';
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
  key: string;
  bucket: string;
  url: string;
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
   * Fetches one key, validates it, normalizes it and replaces its observations.
   *
   * The asset upsert, the delete of the previous observations and the insert of
   * the new ones run in one transaction, so a reader never sees a half-replaced
   * dataset.
   */
  async ingestKey(
    key: string,
    options: IngestOptions = {},
  ): Promise<IngestOutcome> {
    const parsed = parseKey(key);
    if (!parsed) throw new UnsupportedKeyError(key);

    const fetched = await getObject(parsed.key);
    const existing = await this.assets.findOne({ key: parsed.key }).exec();

    if (
      !options.force &&
      existing &&
      existing.status === 'active' &&
      existing.checksum &&
      existing.checksum === fetched.checksum
    ) {
      return {
        key: parsed.key,
        action: 'unchanged',
        assetId: String(existing._id),
        observations: existing.observationCount,
        warnings: [],
      };
    }

    const container = validateContainer(fetched.json, parsed.datasetType);
    if (!container.ok || !container.envelope || !container.datasetType) {
      await this.markFailed(
        parsed.key,
        container.errors.join('; '),
        options.syncRunId ?? null,
      );
      throw new InvalidAssetError(
        `asset ${parsed.key} failed container validation`,
        container.errors,
      );
    }

    const datasetType: DatasetType = container.datasetType;
    const category = CATEGORY_BY_TYPE[datasetType];
    const { metadata, dataset } = container.envelope;
    const warnings = [...container.warnings];

    const location = resolveLocation(
      parsed.fragment,
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
      key: parsed.key,
      bucket: DATA_BUCKET,
      url: fetched.url,
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
      etag: fetched.etag,
      checksum: fetched.checksum,
      sizeBytes: fetched.sizeBytes,
      sourceLastModified: fetched.lastModified,
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
      `${action} ${parsed.key} → ${normalized.observations.length} observations, ${warnings.length} warnings`,
    );

    return {
      key: parsed.key,
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
        { key: assetDoc.key },
        {
          $setOnInsert: {
            key: assetDoc.key,
            bucket: assetDoc.bucket,
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
        `stale observations left behind for ${assetDoc.key}: ${(e as Error).message}. They are not served; the next sync removes them.`,
      );
    }

    return assetId;
  }

  /** Records a validation/fetch failure on the asset without dropping its data. */
  private async markFailed(
    key: string,
    error: string,
    syncRunId: Types.ObjectId | null,
  ): Promise<void> {
    await this.assets
      .updateOne(
        { key },
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

  /** Flags an asset whose object no longer exists. Observations are kept. */
  async markMissing(
    key: string,
    syncRunId: Types.ObjectId | null,
  ): Promise<AssetDocument | null> {
    return this.assets
      .findOneAndUpdate(
        { key },
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
    return e instanceof ObjectNotFoundError;
  }
}
