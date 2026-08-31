import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type SyncAction =
  | 'created'
  | 'updated'
  | 'unchanged'
  | 'missing'
  | 'failed'
  | 'skipped';

/**
 * What a run did. `publish` is the outward direction: the API publishing a
 * generated analysis into the space, rather than ingesting from it. It shares
 * this collection so `GET /v1/sync/runs` shows both without a second one.
 */
export type SyncKind = 'asset' | 'scan' | 'publish';
export type SyncStatus = 'running' | 'ok' | 'partial' | 'failed';

export interface SyncResultRow {
  /** The asset id the source identified it by. */
  sourceId: string;
  /** The published name, so a run is readable without looking every id up. */
  label?: string;
  action: SyncAction;
  assetId?: string;
  observations?: number;
  warnings?: string[];
  error?: string;
}

/** Audit trail: what a sync touched, when, triggered by whom. */
@Schema({ collection: 'sync_runs', timestamps: true })
export class SyncRun {
  @Prop({ type: String, required: true, enum: ['asset', 'scan', 'publish'] })
  kind!: SyncKind;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  userId!: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'Organization', default: null })
  organizationId!: Types.ObjectId | null;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  input!: Record<string, unknown>;

  @Prop({ required: true })
  startedAt!: Date;

  @Prop({ type: Date, default: null })
  finishedAt!: Date | null;

  @Prop({
    type: String,
    required: true,
    enum: ['running', 'ok', 'partial', 'failed'],
    default: 'running',
  })
  status!: SyncStatus;

  @Prop({ type: MongooseSchema.Types.Mixed, default: [] })
  results!: SyncResultRow[];

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  totals!: Record<string, number>;

  @Prop({ type: [String], default: [] })
  warnings!: string[];
}

export type SyncRunDocument = HydratedDocument<SyncRun>;
export const SyncRunSchema = SchemaFactory.createForClass(SyncRun);

SyncRunSchema.index({ startedAt: -1 });
SyncRunSchema.index({ organizationId: 1, startedAt: -1 });
