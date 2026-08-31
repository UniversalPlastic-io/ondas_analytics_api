import { bucketSeries, OverviewService } from './overview.service';
import { OverviewSources } from './overview-sources';
import { AssetsRepository } from '../dataspace/assets.repository';
import {
  CleanupObservationRow,
  ObservationsRepository,
} from '../dataspace/observations.repository';
import { CleanupRow } from '../reports/reports.types';

const ROW = (date: string, kg: number): CleanupObservationRow => ({
  date,
  assetId: 'a1',
  location: 'Badalona',
  city: 'Badalona',
  lat: 41.437,
  lon: 2.244,
  kg,
  volunteers: 2,
  km: 1.5,
  durationSeconds: 1800,
  evidence: 3,
  polymers: {
    pct_pet: 40,
    pct_hdpe: 20,
    pct_ldpe: 10,
    pct_pp: 10,
    pct_ps: 0,
    pct_pvc: 0,
    pct_others: 0,
  },
});

function service(rows: CleanupObservationRow[]) {
  const assets = {
    findByPlaces: jest.fn().mockResolvedValue([{ _id: 'a1' }]),
  } as unknown as AssetsRepository;
  const observations = {
    cleanupRows: jest.fn().mockResolvedValue(rows),
  } as unknown as ObservationsRepository;
  const sources = {
    loadBiomass: jest.fn().mockResolvedValue(null),
    loadMicroplastics: jest.fn().mockResolvedValue(null),
    loadEnvironment: jest.fn().mockResolvedValue(null),
  } as unknown as OverviewSources;
  return {
    svc: new OverviewService(assets, observations, sources),
    assets,
    observations,
    sources,
  };
}

describe('bucketSeries', () => {
  const rows: CleanupRow[] = [
    {
      date: '2025-01-05',
      location: 'A',
      city: 'A',
      kg: 10,
      volunteers: 1,
      km: 1,
      duration: '',
      evidence: 0,
      status: 'verified',
    },
    {
      date: '2025-01-06',
      location: 'A',
      city: 'A',
      kg: 20,
      volunteers: 1,
      km: 1,
      duration: '',
      evidence: 0,
      status: 'verified',
    },
    {
      date: '2026-02-01',
      location: 'A',
      city: 'A',
      kg: 5,
      volunteers: 1,
      km: 1,
      duration: '',
      evidence: 0,
      status: 'verified',
    },
  ];

  it('sums per day, per month and per year', () => {
    expect(bucketSeries(rows, 'month')).toHaveLength(3);
    expect(bucketSeries(rows, 'year')).toEqual([
      { label: 'Jan', kg: 30 },
      { label: 'Feb', kg: 5 },
    ]);
    expect(bucketSeries(rows, 'all')).toEqual([
      { label: '2025', kg: 30 },
      { label: '2026', kg: 5 },
    ]);
  });
});

describe('OverviewService', () => {
  it('projects KPIs from the cleanup rows the repository returns', async () => {
    const { svc } = service([ROW('2025-11-07', 0.5), ROW('2025-11-09', 1.5)]);
    const res = await svc.get('all', 'all', new Date('2026-01-01T00:00:00Z'));
    expect(res.kpis.kg).toBeCloseTo(2.0, 5);
    expect(res.kpis.cleanups).toBe(2);
    expect(res.kpis.volunteers).toBe(4);
    expect(res.sourcesIncluded).toContain('recogidas_playa');
    expect(res.topLocations[0]).toMatchObject({
      name: 'Badalona',
      cleanups: 2,
    });
  });

  it('scopes the query by campaign and period', async () => {
    const { svc, assets, observations } = service([ROW('2025-11-07', 1)]);
    await svc.get('year', 'c3', new Date('2025-06-15T00:00:00Z'));
    expect(assets.findByPlaces).toHaveBeenCalledWith(
      ['barcelona'],
      expect.objectContaining({ category: 'cleanup', tier: 'observed' }),
    );
    expect(observations.cleanupRows).toHaveBeenCalledWith(
      expect.objectContaining({ start: '2025-01-01', end: '2025-12-31' }),
    );
  });

  it('passes the organization through when the caller asked for their own scope', async () => {
    const { svc, assets } = service([ROW('2025-11-07', 1)]);
    await svc.get('all', 'all', new Date(), 'org123');
    expect(assets.findByPlaces).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: 'org123' }),
    );
  });

  it('returns a zeroed overview instead of failing when the period is empty', async () => {
    const { svc } = service([]);
    const res = await svc.get('month', 'all', new Date('2026-01-01T00:00:00Z'));
    expect(res.kpis).toMatchObject({ kg: 0, cleanups: 0, index: 0 });
    expect(res.series).toEqual([]);
    expect(res.sourcesIncluded).toEqual([]);
  });

  it('attaches the optional sections only when they resolve', async () => {
    const { svc, sources } = service([ROW('2025-11-07', 1)]);
    (sources.loadBiomass as jest.Mock).mockResolvedValue({
      meanTonnes: 5,
      units: 'Tonnes',
      readings: 10,
      series: [],
    });
    const res = await svc.get('all', 'all');
    expect(res.biomass).toMatchObject({ meanTonnes: 5 });
    expect(res.microplastics).toBeUndefined();
    expect(res.sourcesIncluded).toContain('boya_biomasa');
  });

  it('survives a failing supporting source', async () => {
    const { svc, sources } = service([ROW('2025-11-07', 1)]);
    (sources.loadEnvironment as jest.Mock).mockRejectedValue(
      new Error('mongo down'),
    );
    const res = await svc.get('all', 'all');
    expect(res.environment).toBeUndefined();
    expect(res.kpis.cleanups).toBe(1);
  });
});
