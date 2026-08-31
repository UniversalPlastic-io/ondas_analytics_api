import { Injectable } from '@nestjs/common';
import {
  CleanupRow,
  ResolvedPeriod,
  SeriesPoint,
} from '../reports/reports.types';
import { resolvePeriod } from '../reports/reports-period';
import { resolveCampaignScope } from '../reports/reports-campaign-map';
import { aggregateReportData } from '../reports/reports-data';
import {
  OverviewKpis,
  OverviewPeriod,
  OverviewResponse,
  OverviewSource,
  OverviewTopLocation,
} from './overview.types';
import { OverviewSources } from './overview-sources';
import { AssetsRepository } from '../dataspace/assets.repository';
import { ObservationsRepository } from '../dataspace/observations.repository';

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

function round(n: number, d = 2): number {
  const m = 10 ** d;
  return Math.round(n * m) / m;
}

export function bucketSeries(
  cleanups: CleanupRow[],
  period: OverviewPeriod,
): SeriesPoint[] {
  const totals = new Map<
    string,
    { sortKey: string; label: string; kg: number }
  >();
  for (const c of cleanups) {
    const date = c.date; // YYYY-MM-DD
    let sortKey: string;
    let label: string;
    if (period === 'month') {
      sortKey = date;
      label = date;
    } else if (period === 'year') {
      sortKey = date.slice(0, 7); // YYYY-MM
      label = MONTHS_SHORT[Number(date.slice(5, 7)) - 1] ?? date.slice(0, 7);
    } else {
      sortKey = date.slice(0, 4);
      label = date.slice(0, 4); // YYYY
    }
    const existing = totals.get(sortKey);
    if (existing) existing.kg += c.kg;
    else totals.set(sortKey, { sortKey, label, kg: c.kg });
  }
  return Array.from(totals.values())
    .sort((a, b) => (a.sortKey < b.sortKey ? -1 : 1))
    .map((b) => ({ label: b.label, kg: round(b.kg, 2) }));
}

function zeroKpis(): OverviewKpis {
  return {
    kg: 0,
    cleanups: 0,
    volunteers: 0,
    locations: 0,
    km: 0,
    hours: 0,
    ondas: 0,
    evidence: 0,
    verified: 0,
    avgKg: 0,
    index: 0,
  };
}

@Injectable()
export class OverviewService {
  constructor(
    private readonly assets: AssetsRepository,
    private readonly observations: ObservationsRepository,
    private readonly sources: OverviewSources,
  ) {}

  async get(
    period: OverviewPeriod = 'all',
    campaign = 'all',
    now: Date = new Date(),
    organizationId: string | null = null,
  ): Promise<OverviewResponse> {
    const periodType = period === 'month' ? 'monthly' : 'annual';
    const resolved: ResolvedPeriod = resolvePeriod(
      { preset: period },
      periodType,
      now,
    );
    const scope = resolveCampaignScope(campaign);
    const loc = { lat: scope.lat, lon: scope.lon };

    // Cleanup data: the database filters by campaign scope and period.
    const cleanupAssets = await this.assets.findByPlaces(scope.places, {
      category: 'cleanup',
      // The dashboard reports what participants measured. Excluding the
      // calibration tier used to happen only by coincidence, because the
      // campaign allowlist happened not to name the reference file.
      tier: 'observed',
      organizationId,
    });
    const rows = await this.observations.cleanupRows({
      assetIds: cleanupAssets.map((a) => a._id),
      start: resolved.start,
      end: resolved.end,
    });

    // An empty period is a zeroed overview, not an error.
    let data: ReturnType<typeof aggregateReportData> | null = null;
    try {
      data = aggregateReportData(rows, resolved, scope.campaignName, 'monthly');
    } catch (e) {
      if (!(e instanceof Error && e.message === 'insufficient_data')) throw e;
    }

    // Supporting sources (nearest asset per category), loaded in parallel, non-fatal.
    const [biomass, microplastics, environment] = await Promise.all([
      this.sources.loadBiomass(loc, period).catch(() => null),
      this.sources.loadMicroplastics(loc).catch(() => null),
      this.sources.loadEnvironment(loc).catch(() => null),
    ]);

    const sourcesIncluded: OverviewSource[] = [];

    const kpis: OverviewKpis = data
      ? {
          kg: data.kpis.kg,
          cleanups: data.kpis.cleanups,
          volunteers: data.kpis.volunteers,
          locations: data.kpis.locations,
          km: data.kpis.km,
          hours: Math.round(data.kpis.durationHours),
          ondas: data.kpis.cleanups,
          evidence: data.kpis.evidenceCount,
          verified: 100,
          avgKg: data.kpis.avgKg,
          index: data.kpis.impactIndex,
        }
      : zeroKpis();

    if (data) sourcesIncluded.push('recogidas_playa');

    const res: OverviewResponse = {
      period: resolved,
      scope: scope.campaignName,
      sourcesIncluded,
      kpis,
      series: data ? bucketSeries(data.cleanups, period) : [],
      plasticTypes: data ? data.plasticTypes : [],
      topLocations: data
        ? data.sites.slice(0, 5).map(
            (s): OverviewTopLocation => ({
              name: s.name,
              kg: s.kg,
              cleanups: s.cleanups,
            }),
          )
        : [],
    };

    if (biomass) {
      res.biomass = biomass;
      sourcesIncluded.push('boya_biomasa');
    }
    if (microplastics) {
      res.microplastics = microplastics;
      sourcesIncluded.push('boya_microplasticos');
    }
    if (environment) {
      res.environment = environment;
      sourcesIncluded.push('environmental_boya');
    }

    return res;
  }
}
