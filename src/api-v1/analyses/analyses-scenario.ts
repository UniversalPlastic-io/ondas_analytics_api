import { Injectable } from '@nestjs/common';
import { AssetFilter, AssetsRepository } from '../dataspace/assets.repository';
import { ObservationsRepository } from '../dataspace/observations.repository';
import { Ocean, WATER_POLYMER_FIELDS } from '../dataspace/dataspace.constants';

/**
 * The data inputs the analyses engine calibrates its plots with.
 *
 * Same shape and same arithmetic as the previous S3-reading loader; the values
 * now come from Mongo, so no request touches the bucket.
 *
 * Each input is looked up in two tiers: the datasets participants observed on
 * the coast the request belongs to, and failing those the calibration series
 * (src/api-v1/dataspace/reference-datasets.ts). The tiers are asked in that
 * order rather than together because `nearest()` orders by distance alone and
 * would otherwise prefer a calibration series over a real buoy further away.
 */

export type BiomassData = {
  meanDailyTonnes: number;
  stdTonnes: number;
  dailySeries: Map<string, number>;
  sourceLoc: { lat: number; lon: number };
};

export type KgTotalData = {
  meanKgPerEvent: number;
  stdKg: number;
  coastLengthKm: number;
  eventSeries: Map<string, number>;
  sourceLoc: { lat: number; lon: number };
};

export type EnvFactorData = {
  meanFactor: number;
  stdFactor: number;
  dailySeries: Map<string, number>;
  sourceLoc: { lat: number; lon: number };
};

export type WaterSampleData = {
  /** Total microplastic concentration across every polymer, μg L⁻¹. */
  meanMpPerL: number;
  stdMpPerL: number;
  dailySeries: Map<string, number>;
  /** Short codes of the polymers actually detected in the samples. */
  polymers: string[];
  sourceLoc: { lat: number; lon: number };
};

export type S3Scenario = {
  biomass: BiomassData | null;
  kgTotal: KgTotalData | null;
  envFactor: EnvFactorData | null;
  buoyPolymers: string[] | null;
  water: WaterSampleData | null;
};

/** Fallback coast length when no cleanup record carries a walking distance. */
const DEFAULT_COAST_LENGTH_KM = 1.8;

function mean(vals: number[]): number {
  if (!vals.length) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function stddev(vals: number[]): number {
  if (vals.length < 2) return 0;
  const m = mean(vals);
  return Math.sqrt(
    vals.reduce((s, v) => s + (v - m) ** 2, 0) / (vals.length - 1),
  );
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

@Injectable()
export class ScenarioLoader {
  constructor(
    private readonly assets: AssetsRepository,
    private readonly observations: ObservationsRepository,
  ) {}

  /**
   * Loads every data input for a location, each independently optional.
   *
   * `coast` restricts the observed datasets to the stretch of coast the point
   * belongs to. Without it the nearest-neighbour search is unbounded, and a
   * request at Gijón for a category with no Cantabrian dataset silently answers
   * with Badalona's, 695 km away and in another sea.
   */
  async load(
    loc: { lat: number; lon: number },
    coast: Ocean | null,
  ): Promise<S3Scenario> {
    const tiered = <T>(load: (tier: AssetFilter) => Promise<T | null>) =>
      this.tiered(coast, load).catch(() => null);

    const [biomass, kgTotal, envFactor, buoyPolymers, water] =
      await Promise.all([
        tiered((tier) => this.loadBiomass(loc, tier)),
        tiered((tier) => this.loadKgTotal(loc, tier)),
        tiered((tier) => this.loadEnvFactor(loc, tier)),
        tiered((tier) => this.loadBuoyPolymers(loc, tier)),
        tiered((tier) => this.loadWaterSamples(loc, tier)),
      ]);
    return { biomass, kgTotal, envFactor, buoyPolymers, water };
  }

  /**
   * Runs a loader against the coast's observed datasets, then against the
   * calibration series if that produced nothing.
   *
   * The whole loader is retried, not just the asset lookup, so an observed
   * dataset that exists but holds no usable observations falls back too.
   *
   * The fallback is deliberately **not** restricted to the coast. A calibration
   * series measures nowhere — it is filed under one basin only because an asset
   * needs coordinates — and restricting it by coast would leave the Cantabrian
   * and Atlantic requests with no fallback at all, which is the exact gap the
   * reference tier exists to cover.
   */
  private async tiered<T>(
    coast: Ocean | null,
    load: (tier: AssetFilter) => Promise<T | null>,
  ): Promise<T | null> {
    const observed = await load(
      coast ? { tier: 'observed', ocean: coast } : { tier: 'observed' },
    );
    if (observed !== null) return observed;
    return load({ tier: 'reference' });
  }

  private async loadBiomass(
    loc: { lat: number; lon: number },
    tier: AssetFilter,
  ): Promise<BiomassData | null> {
    const asset = await this.assets.nearest(
      { ...tier, category: 'biomass' },
      loc,
    );
    if (!asset) return null;
    const dailySeries = await this.observations.dailyMean(
      { assetIds: [asset._id] },
      'biomass_t_total',
    );
    if (!dailySeries.size) return null;
    const dailyMeans = Array.from(dailySeries.values());
    const [lng, lat] = asset.location.coordinates;
    return {
      meanDailyTonnes: mean(dailyMeans),
      stdTonnes: stddev(dailyMeans),
      dailySeries,
      sourceLoc: { lat, lon: lng },
    };
  }

  private async loadKgTotal(
    loc: { lat: number; lon: number },
    tier: AssetFilter,
  ): Promise<KgTotalData | null> {
    const asset = await this.assets.nearest(
      { ...tier, category: 'cleanup' },
      loc,
    );
    if (!asset) return null;
    const rows = await this.observations.cleanupRows({ assetIds: [asset._id] });
    if (!rows.length) return null;

    const eventSeries = new Map<string, number>();
    const kgVals: number[] = [];
    const coastVals: number[] = [];
    for (const r of rows) {
      eventSeries.set(r.date, r.kg);
      kgVals.push(r.kg);
      if (r.km > 0) coastVals.push(r.km);
    }
    const [lng, lat] = asset.location.coordinates;
    return {
      meanKgPerEvent: mean(kgVals),
      stdKg: stddev(kgVals),
      coastLengthKm: coastVals.length
        ? mean(coastVals)
        : DEFAULT_COAST_LENGTH_KM,
      eventSeries,
      sourceLoc: { lat, lon: lng },
    };
  }

  private async loadEnvFactor(
    loc: { lat: number; lon: number },
    tier: AssetFilter,
  ): Promise<EnvFactorData | null> {
    const asset = await this.assets.nearest(
      { ...tier, category: 'environmental' },
      loc,
    );
    if (!asset) return null;
    let daily = await this.observations.dailyMean(
      { assetIds: [asset._id] },
      'wind_speed',
    );
    if (!daily.size) {
      daily = await this.observations.dailyMean(
        { assetIds: [asset._id] },
        'ocean_current_speed',
      );
    }
    if (!daily.size) return null;

    // 0 m/s → 0.5, 15 m/s → 1.5 (clipped)
    const dailySeries = new Map<string, number>();
    for (const [date, windSpeed] of daily) {
      dailySeries.set(date, clamp(0.5 + windSpeed / 15.0, 0.5, 1.5));
    }
    const factors = Array.from(dailySeries.values());
    const [lng, lat] = asset.location.coordinates;
    return {
      meanFactor: mean(factors),
      stdFactor: stddev(factors),
      dailySeries,
      sourceLoc: { lat, lon: lng },
    };
  }

  /**
   * Surface water microplastic concentration, in μg L⁻¹.
   *
   * The file carries one column per polymer, so the quantity the engine wants —
   * a total concentration — is their sum. The polymers detected above zero are
   * returned too: the plastic-origin indicator compares them against the ones
   * the microplastics buoy saw.
   */
  private async loadWaterSamples(
    loc: { lat: number; lon: number },
    tier: AssetFilter,
  ): Promise<WaterSampleData | null> {
    const asset = await this.assets.nearest(
      { ...tier, category: 'water_samples' },
      loc,
    );
    if (!asset) return null;

    const fields = WATER_POLYMER_FIELDS.map((p) => p.field);
    const dailySeries = await this.observations.dailyTotalMean(
      { assetIds: [asset._id] },
      fields,
    );
    if (!dailySeries.size) return null;

    const totals = Array.from(dailySeries.values());
    const means = await this.observations.fieldMeans(
      { assetIds: [asset._id] },
      fields,
    );
    const polymers = WATER_POLYMER_FIELDS.filter(
      (p) => (means[p.field] ?? 0) > 0,
    ).map((p) => p.code);

    const [lng, lat] = asset.location.coordinates;
    return {
      meanMpPerL: mean(totals),
      stdMpPerL: stddev(totals),
      dailySeries,
      polymers,
      sourceLoc: { lat, lon: lng },
    };
  }

  private async loadBuoyPolymers(
    loc: { lat: number; lon: number },
    tier: AssetFilter,
  ): Promise<string[] | null> {
    const asset = await this.assets.nearest(
      { ...tier, category: 'microplastics' },
      loc,
    );
    if (!asset) return null;
    const polymers = await this.observations.distinctStrings(
      { assetIds: [asset._id] },
      'polymer',
    );
    return polymers.length ? polymers : null;
  }
}
