import { ScenarioLoader } from './analyses-scenario';
import { AssetFilter, AssetsRepository } from '../dataspace/assets.repository';
import { ObservationsRepository } from '../dataspace/observations.repository';

const LOC = { lat: 41.4, lon: 2.2 };

const asset = (id: string, coords: [number, number] = [2.24, 41.43]) => ({
  _id: id,
  location: { type: 'Point', coordinates: coords },
});

/** True when the filter asks for observed datasets (reference excluded). */
function isObservedTier(filter: AssetFilter): boolean {
  return filter.tier === 'observed';
}

function isReferenceTier(filter: AssetFilter): boolean {
  return filter.tier === 'reference';
}

/**
 * @param observed  assets returned for the observed tier, by category
 * @param series    daily series per asset id; an id absent here has no observations
 */
function loader(
  observed: Record<string, string | undefined>,
  series: Record<string, Map<string, number>>,
) {
  const nearest = jest.fn(async (filter: AssetFilter) => {
    const category = filter.category!;
    if (isObservedTier(filter)) {
      const id = observed[category];
      return id ? asset(id) : null;
    }
    if (isReferenceTier(filter))
      return asset(`reference-${category}`, [2.5, 40.5]);
    throw new Error(`filter names neither tier: ${JSON.stringify(filter)}`);
  });

  const assets = { nearest } as unknown as AssetsRepository;
  const observations = {
    dailyMean: jest.fn(
      async (scope: { assetIds?: string[] }) =>
        series[String(scope.assetIds?.[0])] ?? new Map(),
    ),
    cleanupRows: jest.fn(async (scope: { assetIds?: string[] }) => {
      const s = series[String(scope.assetIds?.[0])];
      if (!s) return [];
      return Array.from(s.entries()).map(([date, kg]) => ({
        date,
        kg,
        km: 45,
      }));
    }),
    distinctStrings: jest.fn(async (scope: { assetIds?: string[] }) =>
      series[String(scope.assetIds?.[0])] ? ['PE', 'PP'] : [],
    ),
    dailyTotalMean: jest.fn(
      async (scope: { assetIds?: string[] }) =>
        series[String(scope.assetIds?.[0])] ?? new Map(),
    ),
    // Only the first two polymers are detected, so the loader has to filter.
    fieldMeans: jest.fn(async (_scope: unknown, fields: string[]) =>
      Object.fromEntries(fields.map((f, i) => [f, i < 2 ? 1.1 : 0])),
    ),
  } as unknown as ObservationsRepository;

  return { svc: new ScenarioLoader(assets, observations), nearest };
}

const series = (value: number) => new Map([['2025-06-01', value]]);

describe('ScenarioLoader tiering', () => {
  it('uses the observed dataset and never touches the reference tier', async () => {
    const { svc, nearest } = loader(
      {
        biomass: 'a-bio',
        cleanup: 'a-clean',
        environmental: 'a-env',
        microplastics: 'a-mp',
        water_samples: 'a-water',
      },
      {
        'a-bio': series(12),
        'a-clean': series(80),
        'a-env': series(7.5),
        'a-mp': series(1),
        'a-water': series(2.2),
      },
    );

    const res = await svc.load(LOC);

    expect(res.biomass?.meanDailyTonnes).toBe(12);
    expect(res.kgTotal?.meanKgPerEvent).toBe(80);
    expect(res.buoyPolymers).toEqual(['PE', 'PP']);
    expect(res.water?.meanMpPerL).toBe(2.2);
    // Only the polymers with a non-zero mean are reported.
    expect(res.water?.polymers).toEqual(['PE', 'PP']);
    // Every call asked for the observed tier only.
    for (const call of nearest.mock.calls)
      expect(isObservedTier(call[0])).toBe(true);
  });

  it('falls back to the reference dataset when no observed dataset exists', async () => {
    const { svc, nearest } = loader(
      {},
      {
        'reference-biomass': series(35),
        'reference-cleanup': series(55),
        'reference-water_samples': series(2.2),
      },
    );

    const res = await svc.load(LOC);

    expect(res.biomass?.meanDailyTonnes).toBe(35);
    expect(res.biomass?.sourceLoc).toEqual({ lat: 40.5, lon: 2.5 });
    expect(res.kgTotal?.meanKgPerEvent).toBe(55);
    expect(res.kgTotal?.coastLengthKm).toBe(45);
    expect(res.water?.meanMpPerL).toBe(2.2);
    expect(
      nearest.mock.calls.filter((c) => isReferenceTier(c[0])).length,
    ).toBeGreaterThan(0);
  });

  it('falls back when the observed dataset exists but carries no observations', async () => {
    const { svc } = loader(
      { biomass: 'a-bio' },
      { 'reference-biomass': series(35) },
    );

    const res = await svc.load(LOC);

    expect(res.biomass?.meanDailyTonnes).toBe(35);
  });

  it('returns null for a category with neither an observed nor a reference series', async () => {
    const { svc } = loader({}, {});

    const res = await svc.load(LOC);

    expect(res.biomass).toBeNull();
    expect(res.kgTotal).toBeNull();
    expect(res.envFactor).toBeNull();
    expect(res.buoyPolymers).toBeNull();
    expect(res.water).toBeNull();
  });
});
