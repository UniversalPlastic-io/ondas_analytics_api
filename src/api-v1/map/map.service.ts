import { Injectable } from '@nestjs/common';
import { MapFilter, MapPoint, MapResponse } from './map.types';
import { AssetsRepository } from '../dataspace/assets.repository';
import { ObservationsRepository } from '../dataspace/observations.repository';
import { CATEGORY_META, Category } from '../dataspace/dataspace.constants';
import { AssetDocument } from '../dataspace/schemas/asset.schema';
import { formatDuration } from '../reports/reports-data';

function unitsSample(
  u: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!u) return undefined;
  const entries = Object.entries(u).slice(0, 3);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

/** `public/mediterraneo/port_badalona/boya_biomasa_badalona.json` → `mediterraneo/port_badalona/boya_biomasa_badalona` */
function idOf(key: string): string {
  return key.replace(/^public\//, '').replace(/\.json$/, '');
}

/**
 * Falls back to the provider stored on the asset. Older documents ingested
 * before that field existed still carry it in the key, hence the second step.
 */
function providerOf(asset: {
  dataProviderIdRaw: string | null;
  providerFolder?: string | null;
  key: string;
}): string {
  return (
    asset.dataProviderIdRaw ??
    asset.providerFolder ??
    asset.key.split('/')[2] ??
    ''
  );
}

/**
 * One marker per dataset in the data space.
 *
 * Everything on a marker was computed at ingest and lives on the asset document,
 * so a map request is a single indexed query — the endpoint no longer fetches
 * every file from S3 on each call. Only cleanup markers touch observations, for
 * their per-event list.
 */
@Injectable()
export class MapService {
  constructor(
    private readonly assets: AssetsRepository,
    private readonly observations: ObservationsRepository,
  ) {}

  async getPoints(filter: MapFilter = {}): Promise<MapResponse> {
    const assets = await this.assets.find({
      ocean: filter.ocean,
      datasetType: filter.datasetType,
      provider: filter.provider,
      organizationId: filter.organizationId,
      // The map shows what participants measured somewhere, so the reference
      // calibration series has no marker.
      tier: 'observed',
      // Assets whose file disappeared keep serving the data already ingested.
      status: 'any',
    });
    const visible = assets.filter(
      (a) => a.status !== 'failed' && a.currentIngestId,
    );

    const points = await Promise.all(visible.map((a) => this.buildPoint(a)));
    return {
      count: points.length,
      bounds: AssetsRepository.bounds(visible),
      points,
    };
  }

  private async buildPoint(asset: AssetDocument): Promise<MapPoint> {
    const category = asset.category as Category;
    const meta = CATEGORY_META[category] ?? {
      label: asset.datasetType,
      color: '#9BB5C0',
    };
    const [lng, lat] = asset.location.coordinates;

    const point: MapPoint = {
      id: idOf(asset.key),
      name: `${asset.placeName ?? asset.place ?? asset.ocean} — ${meta.label}`,
      datasetType: asset.datasetType,
      label: meta.label,
      category: category as MapPoint['category'],
      color: meta.color,
      provider: providerOf(asset),
      ocean: asset.ocean,
      lat,
      lng,
      records: asset.recordCount || null,
      dateRange: asset.dateRange,
      format: asset.format,
      units: unitsSample(asset.units),
      url: asset.url,
      metadataSchemaRef: asset.dcatSchemaRef,
      warnings: asset.warnings.slice(),
      summary: asset.summary,
    };

    if (asset.status === 'missing') {
      point.warnings.push(
        'the source object is no longer in the bucket; showing the last ingested data',
      );
    }

    if (category === 'cleanup') {
      const rows = await this.observations.cleanupRows({
        assetIds: [asset._id],
      });
      point.cleanupsList = rows.map((r) => ({
        date: r.date,
        kg: r.kg,
        volunteers: r.volunteers,
        km: r.km,
        duration: formatDuration(r.durationSeconds) || null,
        evidence: r.evidence,
      }));
    }

    return point;
  }
}
