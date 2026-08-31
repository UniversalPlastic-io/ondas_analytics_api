import { Logger, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Asset, AssetSchema } from './schemas/asset.schema';
import { Observation, ObservationSchema } from './schemas/observation.schema';
import { SyncRun, SyncRunSchema } from './schemas/sync-run.schema';
import { IngestService } from './ingest.service';
import { SyncService } from './sync.service';
import { SyncController } from './sync.controller';
import { AssetsRepository } from './assets.repository';
import { ObservationsRepository } from './observations.repository';
import { IdentityModule } from '../identity/identity.module';
import { DATASPACE_SOURCE } from './source/dataspace-source';
import { DspacerClient } from './source/dspacer.client';
import { DspacerSource } from './source/dspacer.source';
import {
  DSPACER_BASE_URL,
  DSPACER_LOGIN_URL,
  DSPACER_PASSWORD,
  DSPACER_USER,
  dspacerConfigured,
} from './dataspace.constants';

/**
 * The data space connector, built once per process.
 *
 * Missing credentials are not a startup failure: every analytic endpoint reads
 * from Mongo and only a sync touches the connector, so an API serving an already
 * populated read model must still boot. The failure surfaces on the first sync,
 * where it can be reported to whoever asked for it.
 */
const dataspaceSourceProvider = {
  provide: DATASPACE_SOURCE,
  useFactory: (): DspacerSource => {
    if (!dspacerConfigured()) {
      Logger.warn(
        'DSPACER_* is not fully configured; the analytic endpoints work from the ' +
          'read model but any sync will fail until it is set.',
        'DataspaceModule',
      );
    }
    return new DspacerSource(
      new DspacerClient({
        baseUrl: DSPACER_BASE_URL,
        loginUrl: DSPACER_LOGIN_URL,
        usuario: DSPACER_USER,
        password: DSPACER_PASSWORD,
      }),
    );
  },
};

@Module({
  imports: [
    IdentityModule,
    MongooseModule.forFeature([
      { name: Asset.name, schema: AssetSchema },
      { name: Observation.name, schema: ObservationSchema },
      { name: SyncRun.name, schema: SyncRunSchema },
    ]),
  ],
  controllers: [SyncController],
  providers: [
    dataspaceSourceProvider,
    IngestService,
    SyncService,
    AssetsRepository,
    ObservationsRepository,
  ],
  exports: [
    dataspaceSourceProvider,
    IngestService,
    SyncService,
    AssetsRepository,
    ObservationsRepository,
    MongooseModule,
  ],
})
export class DataspaceModule {}
