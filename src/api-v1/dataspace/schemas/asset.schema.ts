import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { GeoPoint, PointSchema } from './geo.schema';

export type AssetStatus = 'active' | 'missing' | 'failed';

/**
 * Whether an asset is something a participant measured, or a calibration series
 * the API generates and falls back to.
 *
 * This used to be derived from the provider folder in the object key, which made
 * every tier-aware read a regex over a storage path. Storing it means a read
 * model whose meaning does not depend on where the bytes came from — and it is
 * what lets the source change without the calibration series silently appearing
 * as measurements.
 */
export type AssetTier = 'observed' | 'reference';

/**
 * One document per dataset file in the data space bucket.
 * Replaces the hardcoded S3_CATALOGUE / MAP_CATALOGUE as the runtime inventory.
 */
@Schema({ collection: 'assets', timestamps: true })
export class Asset {
  @Prop({ required: true, unique: true })
  key!: string;

  @Prop({ required: true })
  bucket!: string;

  @Prop({ required: true })
  url!: string;

  @Prop({
    type: String,
    required: true,
    enum: ['observed', 'reference'],
    default: 'observed',
  })
  tier!: AssetTier;

  /**
   * The publishing provider, as an attribute rather than a path segment. Kept
   * alongside `dataProviderIdRaw`, which is whatever the file declared, typos
   * included; this one is the folder/participant the asset actually came from.
   */
  @Prop({ type: String, default: null })
  providerFolder!: string | null;

  @Prop({ required: true })
  datasetType!: string;

  @Prop({ required: true })
  category!: string;

  @Prop({ type: Types.ObjectId, ref: 'Organization', default: null })
  organizationId!: Types.ObjectId | null;

  /** Provider id exactly as the file spells it, typos included. */
  @Prop({ type: String, default: null })
  dataProviderIdRaw!: string | null;

  @Prop({ required: true })
  ocean!: string;

  @Prop({ type: String, default: null })
  place!: string | null;

  @Prop({ type: String, default: null })
  placeName!: string | null;

  @Prop({ type: String, default: null })
  city!: string | null;

  @Prop({ type: PointSchema, required: true })
  location!: GeoPoint;

  @Prop({ type: String, default: null })
  schemaVersion!: string | null;

  @Prop({ type: String, default: null })
  dcatSchemaRef!: string | null;

  /** How the file stores its data: rows | columnar | nested. */
  @Prop({ required: true })
  format!: string;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  units!: Record<string, string>;

  @Prop({ default: 0 })
  recordCount!: number;

  /** Observations actually written for this asset (nested files expand). */
  @Prop({ default: 0 })
  observationCount!: number;

  /**
   * Generation of observations this asset currently serves. Flipping this field
   * is what makes an ingest visible; it is a single-document update, so it is
   * atomic however large the dataset is.
   */
  @Prop({ type: Types.ObjectId, default: null })
  currentIngestId!: Types.ObjectId | null;

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  dateRange!: { start: string; end: string } | null;

  /** Per-category headline numbers for the map popup, computed at ingest. */
  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  summary!: Record<string, unknown>;

  @Prop({ type: [String], default: [] })
  warnings!: string[];

  @Prop({
    type: String,
    required: true,
    enum: ['active', 'missing', 'failed'],
    default: 'active',
  })
  status!: AssetStatus;

  @Prop({ type: String, default: null })
  etag!: string | null;

  @Prop({ type: String, default: null })
  checksum!: string | null;

  @Prop({ type: Number, default: null })
  sizeBytes!: number | null;

  @Prop({ type: Date, default: null })
  sourceLastModified!: Date | null;

  @Prop({ type: Date, default: null })
  lastSyncedAt!: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'SyncRun', default: null })
  lastSyncRunId!: Types.ObjectId | null;

  @Prop({ type: String, default: null })
  lastError!: string | null;
}

export type AssetDocument = HydratedDocument<Asset>;
export const AssetSchema = SchemaFactory.createForClass(Asset);

AssetSchema.index({ tier: 1, category: 1 });
AssetSchema.index({ providerFolder: 1 });
AssetSchema.index({ datasetType: 1 });
AssetSchema.index({ organizationId: 1 });
AssetSchema.index({ ocean: 1, datasetType: 1 });
AssetSchema.index({ status: 1 });
AssetSchema.index({ location: '2dsphere' });
