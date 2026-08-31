import { Injectable } from '@nestjs/common';
import { SeriesPoint } from '../reports/reports.types';
import { OverviewPeriod } from './overview.types';
import { AssetsRepository } from '../dataspace/assets.repository';
import { ObservationsRepository } from '../dataspace/observations.repository';

/**
 * The dashboard reports what participants measured, so the reference
 * calibration series never contributes to it. Only the analytics engine falls
 * back to that tier, and it says so through its own lookup.
 */
const OBSERVED_ONLY = { tier: 'observed' } as const;

function round(n: number, d = 2): number {
  const m = 10 ** d;
  return Math.round(n * m) / m;
}

const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** Buckets a daily series into day / month / year points, averaging within a bucket. */
export function bucketAverage(
  daily: Map<string, number>,
  period: OverviewPeriod,
): SeriesPoint[] {
  const groups = new Map<
    string,
    { sortKey: string; label: string; sum: number; n: number }
  >();
  for (const [date, value] of daily) {
    let sortKey: string;
    let label: string;
    if (period === 'month') {
      sortKey = date;
      label = date;
    } else if (period === 'year') {
      sortKey = date.slice(0, 7);
      label = MONTHS_SHORT[Number(date.slice(5, 7)) - 1] ?? date.slice(0, 7);
    } else {
      sortKey = date.slice(0, 4);
      label = date.slice(0, 4);
    }
    const g = groups.get(sortKey);
    if (g) {
      g.sum += value;
      g.n += 1;
    } else groups.set(sortKey, { sortKey, label, sum: value, n: 1 });
  }
  return Array.from(groups.values())
    .sort((a, b) => (a.sortKey < b.sortKey ? -1 : 1))
    .map((g) => ({ label: g.label, kg: round(g.sum / g.n, 2) }));
}

export interface BiomassSection {
  meanTonnes: number;
  units: 'Tonnes';
  readings: number;
  series: SeriesPoint[];
}

export interface MicroplasticsSection {
  particles: number;
  byPolymer: Array<{ type: string; count: number }>;
  bySize: Array<{ size: string; count: number }>;
}

export interface EnvironmentSection {
  readings: number;
  meanSeaSurfaceTemperatureC: number | null;
  meanWindSpeedMs: number | null;
}

/**
 * The supporting dataset sections of the overview.
 *
 * Each one picks the asset nearest the requested location and reads it from
 * Mongo. Headline numbers come from the asset's `summary`, computed once at
 * ingest; only the biomass series needs an aggregation over observations.
 */
@Injectable()
export class OverviewSources {
  constructor(
    private readonly assets: AssetsRepository,
    private readonly observations: ObservationsRepository,
  ) {}

  async loadBiomass(
    loc: { lat: number; lon: number },
    period: OverviewPeriod,
  ): Promise<BiomassSection | null> {
    const asset = await this.assets.nearest(
      { ...OBSERVED_ONLY, category: 'biomass' },
      loc,
    );
    if (!asset) return null;
    const summary = asset.summary as { meanTonnes?: number; readings?: number };
    const daily = await this.observations.dailyMean(
      { assetIds: [asset._id] },
      'biomass_t_total',
    );
    if (!daily.size) return null;
    return {
      meanTonnes: round(summary.meanTonnes ?? 0),
      units: 'Tonnes',
      readings: summary.readings ?? asset.observationCount,
      series: bucketAverage(daily, period),
    };
  }

  async loadMicroplastics(loc: {
    lat: number;
    lon: number;
  }): Promise<MicroplasticsSection | null> {
    const asset = await this.assets.nearest(
      { ...OBSERVED_ONLY, category: 'microplastics' },
      loc,
    );
    if (!asset) return null;
    const summary = asset.summary as Partial<MicroplasticsSection>;
    if (!summary.particles) return null;
    return {
      particles: summary.particles,
      byPolymer: summary.byPolymer ?? [],
      bySize: summary.bySize ?? [],
    };
  }

  async loadEnvironment(loc: {
    lat: number;
    lon: number;
  }): Promise<EnvironmentSection | null> {
    const asset = await this.assets.nearest(
      { ...OBSERVED_ONLY, category: 'environmental' },
      loc,
    );
    if (!asset) return null;
    const summary = asset.summary as Partial<EnvironmentSection>;
    if (!summary.readings) return null;
    return {
      readings: summary.readings,
      meanSeaSurfaceTemperatureC: summary.meanSeaSurfaceTemperatureC ?? null,
      meanWindSpeedMs: summary.meanWindSpeedMs ?? null,
    };
  }
}
