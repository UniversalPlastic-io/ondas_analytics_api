import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

/**
 * A participant of the ONDAs data space. One organization owns one S3 prefix and
 * publishes assets under it.
 */
@Schema({ collection: 'organizations', timestamps: true })
export class Organization {
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  slug!: string;

  /**
   * Every spelling of this org's `dataProviderId` found in the datasets it
   * publishes. The same participant appears as `universal_plastic`,
   * `universalplastic` and ``universal`plastic`` across its own files.
   */
  @Prop({ type: [String], default: [] })
  dataProviderIds!: string[];

  /**
   * Provider folders owned by this org. A folder is the normalised name of a
   * participant in the space, as `providerFolderFor` derives it, and it is what
   * scopes a sync run for a non-admin caller.
   */
  @Prop({ type: [String], default: [] })
  providerFolders!: string[];

  @Prop({ required: true })
  name!: string;

  @Prop({ default: 'Company' })
  type!: string;

  @Prop({ type: String, default: null })
  territory!: string | null;

  @Prop({ type: String, default: null })
  description!: string | null;

  @Prop({ type: String, default: null })
  website!: string | null;

  @Prop({ type: String, default: null })
  contact!: string | null;

  @Prop({ default: true })
  publicProfile!: boolean;

  @Prop({ default: true })
  active!: boolean;
}

export type OrganizationDocument = HydratedDocument<Organization>;
export const OrganizationSchema = SchemaFactory.createForClass(Organization);

OrganizationSchema.index({ dataProviderIds: 1 });
OrganizationSchema.index({ providerFolders: 1 });
