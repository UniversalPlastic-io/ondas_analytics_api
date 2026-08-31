import { Injectable } from '@nestjs/common';
import {
  AggregationMode,
  AnalysesRunRequest,
  AnalysesRunResponse,
  AnalysisId,
  CacheMode,
  DataFormattedForPlots,
} from './analyses.types';
import { savePlotsPdfReport } from './analyses-plot-pdf';
import { savePlotsAsWebp } from './analyses-plot-webp';
import { uploadPlotsToS3, uploadAnalysisResultToS3 } from './analyses-s3';
import { hashString, mulberry32 } from '../deterministic-rng';
import { S3Scenario, ScenarioLoader } from './analyses-scenario';
import { MetricsService } from '../../metrics/metrics.service';
import {
  AssetsRepository,
  UNPLACED_OCEAN,
} from '../dataspace/assets.repository';

type CacheEntry = {
  expiresAtMs: number;
  cachedAtIso: string;
  response: AnalysesRunResponse;
};

const SUPPORTED_ANALYSES: AnalysisId[] = [
  'basic_contamination',
  'trophic_transfer',
  'eco_risk',
  'plastic_origin',
];

function stableStringify(obj: unknown): string {
  // Deterministic stringification for cache keys.
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map((x) => stableStringify(x)).join(',')}]`;
  const o = obj as Record<string, unknown>;
  const keys = Object.keys(o).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function roundTo(n: number, decimals: number): number {
  const m = Math.pow(10, decimals);
  return Math.round(n * m) / m;
}

function isoNow(): string {
  return new Date().toISOString();
}

function dateToIsoDay(dateStr: string): string {
  // Accepts YYYY-MM-DD, returns the same format for simplicity.
  return dateStr;
}

function toMs(dateStr: string): number {
  // Date parsing without timezone ambiguity: treat as UTC day.
  // eslint-disable-next-line no-new-wrappers
  return new Date(`${dateStr}T00:00:00.000Z`).getTime();
}

function daysInclusive(start: string, end: string): number {
  const a = toMs(start);
  const b = toMs(end);
  const diffDays = Math.floor((b - a) / (24 * 60 * 60 * 1000));
  return diffDays + 1;
}

function sampleDates(start: string, end: string, count: number, maxCountCap = 12): string[] {
  const total = daysInclusive(start, end);
  if (total <= 0) return [start];
  const capped = Math.min(count, total, maxCountCap);
  if (capped <= 1) return [start];
  const a = toMs(start);
  const b = toMs(end);
  const span = b - a;
  const step = span / (capped - 1);
  const out: string[] = [];
  for (let i = 0; i < capped; i++) {
    const ms = a + Math.round(i * step);
    const d = new Date(ms);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    out.push(`${yyyy}-${mm}-${dd}`);
  }
  return out;
}

function allDates(start: string, end: string, maxCountCap = 60): string[] {
  const total = daysInclusive(start, end);
  const capped = Math.min(Math.max(total, 1), maxCountCap);
  const out: string[] = [];
  const a = toMs(start);
  for (let i = 0; i < capped; i++) {
    const ms = a + i * 24 * 60 * 60 * 1000;
    const d = new Date(ms);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    out.push(`${yyyy}-${mm}-${dd}`);
  }
  return out;
}

function normalizeAnalyses(reqAnalyses: AnalysesRunRequest['analyses']): AnalysisId[] {
  const raw = Array.isArray(reqAnalyses) ? reqAnalyses : [];
  if (raw.includes('all')) return SUPPORTED_ANALYSES.slice();
  const set = new Set<AnalysisId>();
  for (const a of raw) {
    if (SUPPORTED_ANALYSES.includes(a as AnalysisId)) set.add(a as AnalysisId);
  }
  return Array.from(set);
}

function computeCacheKey(req: AnalysesRunRequest, selectedAnalyses: AnalysisId[], aggregationMode: AggregationMode): string {
  const locationNorm = {
    lat: roundTo(req.location.lat, 4),
    lon: roundTo(req.location.lon, 4),
  };
  const areaNorm = {
    type: req.area.type,
    value: roundTo(req.area.value, 3),
  };

  const dateRangeApplied = req.dateRange ?? { start: '', end: '' };
  const analysesSorted = selectedAnalyses.slice().sort();

  // Bumped when the shape or the source of the calibration inputs changes,
  // so cached results from an older generation are not reused.
  const dataVer = 'dataspace-1';
  const formulaVer = 'v1';

  const payload = {
    location: locationNorm,
    area: areaNorm,
    dateRange: dateRangeApplied,
    analyses: analysesSorted,
    aggregation: { mode: aggregationMode },
    dataFormattedForPlots: req.options?.dataFormattedForPlots === true,
    savePlotsWebp: req.options?.savePlotsWebp === true,
    dataVer,
    formulaVer,
  };

  return `analyses|${stableStringify(payload)}`;
}

function randomWeights(rng: () => number, n: number): number[] {
  const weights: number[] = [];
  for (let i = 0; i < n; i++) weights.push(-Math.log(Math.max(1e-12, rng())));
  const sum = weights.reduce((acc, x) => acc + x, 0);
  if (sum === 0) return weights;
  return weights.map((w) => (w / sum) * 100);
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stddev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  let s = 0;
  for (const x of arr) s += (x - m) * (x - m);
  return Math.sqrt(s / (arr.length - 1));
}

function jaccardPercent(a: string[], b: string[]): number {
  const A = new Set(a);
  const B = new Set(b);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const union = new Set([...A, ...B]).size;
  if (union === 0) return 0;
  return (inter / union) * 100;
}

function pearsonCorrelation(xs: number[], ys: number[]): { r: number; p: number } {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return { r: 0, p: 1 };
  const x = xs.slice(0, n);
  const y = ys.slice(0, n);

  const mx = mean(x);
  const my = mean(y);
  let cov = 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    cov += dx * dy;
    sx += dx * dx;
    sy += dy * dy;
  }
  if (sx === 0 || sy === 0) return { r: 0, p: 1 };
  const r = cov / Math.sqrt(sx * sy);
  const rClamped = clamp(r, -1, 1);

  // Approximate p-value mapping: the project carries no external stats library.
  const p = clamp(1 - Math.abs(rClamped), 0, 1);
  return { r: rClamped, p };
}

function toIsoMs(ms: number): string {
  return new Date(ms).toISOString();
}

function approxDistanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  // Equirectangular approximation, good enough for the small radii queried here.
  const rad = Math.PI / 180;
  const x = (b.lon - a.lon) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const y = (b.lat - a.lat) * rad;
  const earthRadiusKm = 6371;
  return Math.sqrt(x * x + y * y) * earthRadiusKm;
}

function weightedMean(pairs: Array<{ value: number; weight: number }>): number {
  let wSum = 0;
  let vSum = 0;
  for (const { value, weight } of pairs) {
    const w = Number.isFinite(weight) ? Math.max(0, weight) : 0;
    const v = Number.isFinite(value) ? value : 0;
    wSum += w;
    vSum += v * w;
  }
  if (wSum <= 0) return 0;
  return vSum / wSum;
}

/**
 * Derives stable, location-specific visual characteristics from coordinates.
 * Mediterranean: high mp baseline, summer peak, high BCF (enclosed, warm).
 * Atlantic (Cádiz/Tenerife): low mp baseline, variable, spring peak, lower BCF.
 * Cantabrian: intermediate baseline, winter peak, mid BCF.
 */
function locationProfile(lat: number, lon: number): {
  mpBase: number; mpSeasonAmp: number; seasonPhase: number;
  mpTrendPerDay: number; bcfBase: number; bcfRange: number;
} {
  const h = hashString(`profile|${Math.round(lat * 10)}|${Math.round(lon * 10)}`);
  const rp = mulberry32(h);
  const isMed  = lon > -3;
  const isCant = lat > 42 && lon < 0;
  // Atlantic is neither Med nor Cant
  return {
    mpBase:        isMed  ? 2.0 + rp() * 0.8 : isCant ? 1.0 + rp() * 0.4 : 0.3 + rp() * 0.3,
    mpSeasonAmp:   isMed  ? 0.8 + rp() * 0.4 : isCant ? 0.4 + rp() * 0.3 : 1.1 + rp() * 0.5,
    seasonPhase:   isMed  ? 0                 : isCant ? Math.PI           : Math.PI / 2,
    mpTrendPerDay: (rp() - 0.35) * 0.004,
    bcfBase:       isMed  ? 160 + rp() * 90   : isCant ? 80 + rp() * 70   : 30 + rp() * 50,
    bcfRange:      isMed  ? 280               : isCant ? 200               : 140,
  };
}

/** 7-day rolling mean aligned with daily series; first 6 entries are null (notebook-style IPC smooth). */
function rollingMean7(values: number[]): Array<number | null> {
  return values.map((_, i) => {
    if (i < 6) return null;
    let s = 0;
    for (let j = i - 6; j <= i; j++) s += values[j];
    return Number((s / 7).toFixed(6));
  });
}

@Injectable()
export class AnalysesService {
  constructor(
    private readonly scenario: ScenarioLoader,
    private readonly metrics: MetricsService,
    private readonly assets: AssetsRepository,
  ) {}

  private readonly cache = new Map<string, CacheEntry>();

  async run(
    req: AnalysesRunRequest,
    runOpts?: { publicBaseUrl?: string },
  ): Promise<AnalysesRunResponse> {
    const aggregationMode: AggregationMode = req.aggregation?.mode === 'monthly' ? 'monthly' : 'raw';
    const selectedAnalyses = normalizeAnalyses(req.analyses);
    // Counted per analysis, not per request: `["all"]` is four analyses, and a
    // per-request counter would hide which indicator is actually being used.
    this.metrics.recordAnalyses(selectedAnalyses);

    const dateRangeApplied = req.dateRange?.start && req.dateRange?.end
      ? { start: dateToIsoDay(req.dateRange.start), end: dateToIsoDay(req.dateRange.end) }
      : { start: '2025-01-01', end: '2025-01-30' };

    const cacheMode: CacheMode = req.options?.cache?.mode ?? 'reuse';
    const ttlSeconds: number = req.options?.cache?.ttlSeconds ?? 30 * 24 * 60 * 60; // 30d
    const skipCacheForWebp = req.options?.savePlotsWebp === true;

    const cacheKey = computeCacheKey(req, selectedAnalyses, aggregationMode);

    const nowMs = Date.now();
    if (cacheMode === 'reuse' && !skipCacheForWebp) {
      const entry = this.cache.get(cacheKey);
      if (entry && entry.expiresAtMs > nowMs) {
        // Ensure cache hit meta matches the current request.
        const cached = structuredClone(entry.response);
        cached.requestId = `req_${Math.random().toString(16).slice(2, 10)}`;
        const cacheMeta = (cached.meta.cache ?? (cached.meta.cache = {} as any));
        cacheMeta.hit = true;
        cacheMeta.cacheKey = cacheKey;
        cacheMeta.cachedAt = entry.cachedAtIso;
        return cached;
      }
    }

    // cacheMode=recompute and bypass both recompute.
    const computed = await this.computeResponse(req, {
      selectedAnalyses,
      aggregationMode,
      dateRangeApplied,
      publicBaseUrl: runOpts?.publicBaseUrl,
    });

    if ((cacheMode === 'recompute' || cacheMode === 'reuse') && !skipCacheForWebp) {
      const cachedAt = isoNow();
      const expiresAtMs = nowMs + ttlSeconds * 1000;
      this.cache.set(cacheKey, {
        expiresAtMs,
        cachedAtIso: cachedAt,
        response: computed,
      });

      // Fill cache meta for the response when reuse/recompute is enabled.
      computed.meta.cache = {
        mode: cacheMode,
        hit: false,
        cacheKey,
        cachedAt,
        expiresAt: toIsoMs(expiresAtMs),
      };
    } else {
      // bypass
      computed.meta.cache = {
        mode: cacheMode,
        hit: false,
        cacheKey,
      };
    }

    return computed;
  }

  private async computeResponse(
    req: AnalysesRunRequest,
    ctx: {
      selectedAnalyses: AnalysisId[];
      aggregationMode: AggregationMode;
      dateRangeApplied: { start: string; end: string };
      publicBaseUrl?: string;
    },
  ): Promise<AnalysesRunResponse> {
    const requestId = `req_${Math.random().toString(16).slice(2, 10)}`;

    const location = req.location;
    const radiusKm = req.area.value;
    const dateRangeApplied = ctx.dateRangeApplied;
    const totalDays = daysInclusive(dateRangeApplied.start, dateRangeApplied.end);
    const dates =
      ctx.aggregationMode === 'raw'
        ? // For raw, keep daily resolution up to ~1 year (dashboard default).
          // For larger ranges, cap to keep payloads reasonable.
          allDates(dateRangeApplied.start, dateRangeApplied.end, totalDays <= 370 ? 400 : 90)
        : // For monthly aggregation, return ~12 representative points (1 per month).
          sampleDates(dateRangeApplied.start, dateRangeApplied.end, 12, 12);

    const targetLoc = { lat: location.lat, lon: location.lon };

    // Single real location — real S3 data is already position-specific.
    const pseudoLocations = [{ locationId: 'loc_target', lat: location.lat, lon: location.lon }];
    const weightsByLocId = new Map([['loc_target', 1]]);

    const polymers = ['PE', 'PP', 'PET', 'PS'] as const;

    // Nearest datasets for this location: observed where they exist, the
    // reference series otherwise. Non-blocking: null on any error.
    const s3 = await this.safeLoadS3Data(req.location);

    const datasetsUsed: Record<string, number> = {
      water_samples: s3?.water ? s3.water.dailySeries.size : 0,
      fish_samples: 0,
      biomass_buoy: s3?.biomass ? s3.biomass.dailySeries.size : 0,
      coastal_cleanup: s3?.kgTotal ? s3.kgTotal.eventSeries.size : 0,
      environmental: s3?.envFactor ? s3.envFactor.dailySeries.size : 0,
    };

    // No dataset carries an ingestion probability, so this one stays a constant.
    const probIngestion = 0.5;
    const coastLengthKm = Math.max(0.1, s3?.kgTotal?.coastLengthKm ?? 1.8);

    // Calibrated from the datasets above. The literals are the last resort for
    // an empty read model, when not even a reference series has been ingested.
    const s3BiomassBase = s3?.biomass?.meanDailyTonnes ?? 35;
    const s3BiomassStd = Math.min(s3?.biomass?.stdTonnes ?? 2.5, s3BiomassBase * 0.5);
    const s3KgBase = s3?.kgTotal?.meanKgPerEvent ?? 60;
    const s3KgStd = Math.min(s3?.kgTotal?.stdKg ?? 6, s3KgBase * 0.5);
    const s3EnvBase = s3?.envFactor?.meanFactor ?? 1.0;
    const s3EnvStd = Math.min(s3?.envFactor?.stdFactor ?? 0.1, 0.3);
    // Water samples give a real concentration; without them mp_per_L is derived
    // from the coordinates, which is the pre-data-space behaviour.
    const s3MpBase = s3?.water?.meanMpPerL ?? null;
    const s3MpStd = Math.min(s3?.water?.stdMpPerL ?? 0, (s3MpBase ?? 1) * 0.5);

    const results: Record<string, unknown> = {};

    // Internal per-(pseudoLocation,date) values used by other indicators.
    // key: locId|YYYY-MM-DD -> mp_per_L
    const mpByKey = new Map<string, number>();
    const biomassByKey = new Map<string, number>();
    const kgTotalByKey = new Map<string, number>();
    const envFactorByKey = new Map<string, number>();

    // Fill them once, whatever was requested: the indicators that are not
    // `basic_contamination` read the same values, and both branches used to
    // compute them identically.
    for (const loc of pseudoLocations) {
      for (const d of dates) {
        const key = `${loc.locationId}|${d}`;
        const rr = mulberry32(hashString(`${loc.locationId}|${loc.lat}|${loc.lon}|${d}`));

        // Consumed either way, so the values below do not shift with the branch.
        const mpNoise = rr();
        if (s3MpBase !== null) {
          mpByKey.set(key, Math.max(0.01, s3MpBase + (mpNoise - 0.5) * 2 * s3MpStd));
        } else {
          const mpBase = (Math.abs(loc.lat) + Math.abs(loc.lon)) % 10;
          const mpAmp = 2 + (radiusKm % 5);
          mpByKey.set(key, Math.max(0.01, mpBase / 10 + mpAmp * 0.3 + mpNoise * 2));
        }

        biomassByKey.set(key, Math.max(0.1, s3BiomassBase + (rr() - 0.5) * 2 * s3BiomassStd));
        kgTotalByKey.set(key, Math.max(0.1, s3KgBase + (rr() - 0.5) * 2 * s3KgStd));
        envFactorByKey.set(key, clamp(s3EnvBase + (rr() - 0.5) * 2 * s3EnvStd, 0.5, 1.5));
      }
    }

    if (ctx.selectedAnalyses.includes('basic_contamination')) {
      const items: Array<{ location: { lat: number; lon: number }; date: string; mp_per_L: number }> = [];
      for (const d of dates) {
        const pairs: Array<{ value: number; weight: number }> = [];
        for (const loc of pseudoLocations) {
          const mp = mpByKey.get(`${loc.locationId}|${d}`) ?? 0;
          pairs.push({ value: mp, weight: weightsByLocId.get(loc.locationId) ?? 0 });
        }
        const agg = weightedMean(pairs);
        items.push({ location: targetLoc, date: d, mp_per_L: Number(agg.toFixed(3)) });
      }

      const mpSeries = items.map((it) => it.mp_per_L);
      const meanMp = mean(mpSeries);
      const stdMp = stddev(mpSeries);
      const cv = meanMp > 0 ? stdMp / meanMp : 0;

      // Buoy vs water concordance over polymers. Both lists come from the
      // datasets when they carry one; the deterministic selection below is the
      // fallback for an empty read model.
      const concordSeed = hashString(`concord|${targetLoc.lat}|${targetLoc.lon}|${dateRangeApplied.start}|${dateRangeApplied.end}`);
      const rc = mulberry32(concordSeed);
      const buoyPolymers: string[] = s3?.buoyPolymers ?? (polymers.filter(() => rc() > 0.25) as unknown as string[]);
      const waterPolymers: string[] =
        s3?.water?.polymers ?? (polymers.filter(() => rc() > 0.1) as unknown as string[]);
      const overlapPercent = Number(jaccardPercent(buoyPolymers, waterPolymers).toFixed(1));

      results.basic_contamination = {
        units: { mp_per_L: 'µg/L' },
        byLocationAndDate: items,
        summary: {
          mean_mp_per_L: Number(meanMp.toFixed(3)),
          std_mp_per_L: Number(stdMp.toFixed(3)),
          cv_mp_per_L: Number(cv.toFixed(4)),
        },
        concordance_buoy_vs_water: {
          byLocationAndDateRange: [
            {
              location: targetLoc,
              dateRange: { start: dateRangeApplied.start, end: dateRangeApplied.end },
              buoyPolymers,
              waterPolymers,
              overlapPercent,
            },
          ],
        },
      };
    }

    if (ctx.selectedAnalyses.includes('trophic_transfer')) {
      // BCF and polymer similarity.
      const bcfItems: Array<{ location: { lat: number; lon: number }; date: string; BCF: number }> = [];

      // Aggregate BCF per date (weighted across pseudo-locations).
      const locProf = locationProfile(targetLoc.lat, targetLoc.lon);
      for (const d of dates) {
        const pairs: Array<{ value: number; weight: number }> = [];
        for (const loc of pseudoLocations) {
          const mp = mpByKey.get(`${loc.locationId}|${d}`) ?? 0.1;
          const daySeed = hashString(`fish|${loc.locationId}|${loc.lat}|${loc.lon}|${d}`);
          const rr = mulberry32(daySeed);
          const fishFactor = locProf.bcfBase + rr() * locProf.bcfRange;
          const mp_per_kg_fish = mp * fishFactor;
          const BCF = mp_per_kg_fish / Math.max(1e-6, mp);
          pairs.push({ value: BCF, weight: weightsByLocId.get(loc.locationId) ?? 0 });
        }
        bcfItems.push({ location: targetLoc, date: d, BCF: Number(weightedMean(pairs).toFixed(2)) });
      }

      // Polymer similarity: build aggregated water/fish % per date, then pearson per polymer.
      const waterPercByPolyAgg: Record<(typeof polymers)[number], number[]> = { PE: [], PP: [], PET: [], PS: [] };
      const fishPercByPolyAgg: Record<(typeof polymers)[number], number[]> = { PE: [], PP: [], PET: [], PS: [] };

      for (const d of dates) {
        const waterPairsByPoly: Record<(typeof polymers)[number], Array<{ value: number; weight: number }>> = {
          PE: [],
          PP: [],
          PET: [],
          PS: [],
        };
        const fishPairsByPoly: Record<(typeof polymers)[number], Array<{ value: number; weight: number }>> = {
          PE: [],
          PP: [],
          PET: [],
          PS: [],
        };

        for (const loc of pseudoLocations) {
          const daySeed = hashString(`poly|${loc.locationId}|${loc.lat}|${loc.lon}|${d}`);
          const rr = mulberry32(daySeed);
          const wts = randomWeights(rr, polymers.length);

          const fishNoiseScale = 0.4;
          const fRaw = wts.map((x) => Math.max(0.001, x * (1 + (rr() - 0.5) * fishNoiseScale)));
          const sum = fRaw.reduce((a, b) => a + b, 0);
          const fPerc = fRaw.map((x) => (x / sum) * 100);

          const w = weightsByLocId.get(loc.locationId) ?? 0;
          for (let pi = 0; pi < polymers.length; pi++) {
            const p = polymers[pi];
            waterPairsByPoly[p].push({ value: wts[pi], weight: w });
            fishPairsByPoly[p].push({ value: fPerc[pi], weight: w });
          }
        }

        for (const p of polymers) {
          waterPercByPolyAgg[p].push(weightedMean(waterPairsByPoly[p]));
          fishPercByPolyAgg[p].push(weightedMean(fishPairsByPoly[p]));
        }
      }

      const polymersResult: Record<string, { pearson_r: number; p_value: number }> = {};
      for (const p of polymers) {
        const { r, p: pval } = pearsonCorrelation(waterPercByPolyAgg[p], fishPercByPolyAgg[p]);
        polymersResult[p] = { pearson_r: Number(r.toFixed(2)), p_value: Number(pval.toFixed(3)) };
      }

      // Also compute a single similarity coefficient between water vs fish composition vectors
      // aggregated over the whole requested window.
      const waterVec = polymers.map((p) => mean(waterPercByPolyAgg[p]));
      const fishVec = polymers.map((p) => mean(fishPercByPolyAgg[p]));
      const { r: simR, p: simP } = pearsonCorrelation(waterVec, fishVec);

      results.trophic_transfer = {
        BCF: {
          units: 'dimensionless',
          byLocationAndDate: bcfItems,
        },
        polymers_similarity: {
          byLocationAndDateRange: [
            {
              location: targetLoc,
              dateRange: { start: dateRangeApplied.start, end: dateRangeApplied.end },
              polymers: polymersResult,
            },
          ],
        },
        polymer_similarity_water_vs_fish: {
          byLocationAndDateRange: [
            {
              location: targetLoc,
              dateRange: { start: dateRangeApplied.start, end: dateRangeApplied.end },
              polymerLabels: [...polymers],
              waterPercent: waterVec.map((x) => Number(x.toFixed(2))),
              fishPercent: fishVec.map((x) => Number(x.toFixed(2))),
              pearson_r: Number(simR.toFixed(2)),
              p_value: Number(simP.toFixed(3)),
            },
          ],
        },
      };
    }

    if (ctx.selectedAnalyses.includes('eco_risk')) {
      const exposureItems: Array<{ location: { lat: number; lon: number }; date: string; Exposure_Index: number }> = [];
      const pressureItems: Array<{ location: { lat: number; lon: number }; date: string; Plastic_Pressure_Index: number }> = [];
      const ipcItems: Array<{ location: { lat: number; lon: number }; date: string; IPC: number }> = [];

      for (const d of dates) {
        const exposurePairs: Array<{ value: number; weight: number }> = [];
        const pressurePairs: Array<{ value: number; weight: number }> = [];
        const ipcPairs: Array<{ value: number; weight: number }> = [];

        for (const loc of pseudoLocations) {
          const mp = mpByKey.get(`${loc.locationId}|${d}`) ?? 0.1;
          const daySeed = hashString(`env|${loc.locationId}|${loc.lat}|${loc.lon}|${d}`);
          const rr = mulberry32(daySeed);

          const key = `${loc.locationId}|${d}`;
          const biomass = biomassByKey.get(key) ?? (10 + rr() * 90);
          const Exposure_Index = mp * biomass * probIngestion;

          const kg_total = kgTotalByKey.get(key) ?? (rr() * 150);
          const kg_per_km = kg_total / coastLengthKm;
          const Plastic_Pressure_Index = mp + kg_per_km * 0.01;

          const envFactor = envFactorByKey.get(key) ?? (0.5 + rr());
          const IPC = kg_per_km * envFactor;

          const w = weightsByLocId.get(loc.locationId) ?? 0;
          exposurePairs.push({ value: Exposure_Index, weight: w });
          pressurePairs.push({ value: Plastic_Pressure_Index, weight: w });
          ipcPairs.push({ value: IPC, weight: w });
        }

        exposureItems.push({ location: targetLoc, date: d, Exposure_Index: Number(weightedMean(exposurePairs).toFixed(3)) });
        pressureItems.push({
          location: targetLoc,
          date: d,
          Plastic_Pressure_Index: Number(weightedMean(pressurePairs).toFixed(3)),
        });
        ipcItems.push({ location: targetLoc, date: d, IPC: Number(weightedMean(ipcPairs).toFixed(3)) });
      }

      results.eco_risk = {
        Exposure_Index: {
          units: 'dimensionless',
          byLocationAndDate: exposureItems,
        },
        Plastic_Pressure_Index: {
          units: 'dimensionless',
          byLocationAndDate: pressureItems,
        },
        IPC: {
          units: 'dimensionless',
          byLocationAndDate: ipcItems,
        },
      };
    }

    if (ctx.selectedAnalyses.includes('plastic_origin')) {
      const csiItems: Array<{ location: { lat: number; lon: number }; date: string; CSI: number }> = [];
      for (const d of dates) {
        const pairs: Array<{ value: number; weight: number }> = [];
        for (const loc of pseudoLocations) {
          const mp = mpByKey.get(`${loc.locationId}|${d}`) ?? 0.1;
          const daySeed = hashString(`coast|${loc.locationId}|${loc.lat}|${loc.lon}|${d}`);
          const rr = mulberry32(daySeed);
          const key = `${loc.locationId}|${d}`;
          const kg_total = kgTotalByKey.get(key) ?? (rr() * 150);
          const CSI = mp / Math.max(1e-6, kg_total);
          pairs.push({ value: CSI, weight: weightsByLocId.get(loc.locationId) ?? 0 });
        }
        csiItems.push({ location: targetLoc, date: d, CSI: Number(weightedMean(pairs).toFixed(6)) });
      }
      results.plastic_origin = {
        CSI: {
          units: 'µg/L per kg',
          byLocationAndDate: csiItems,
        },
      };
    }

    // If aggregationMode were monthly, we would aggregate; raw keeps the structure as is.
    // Keep API contract stable for now.
    const response: AnalysesRunResponse = {
      requestId,
      input: {
        location: { lat: req.location.lat, lon: req.location.lon },
        area: req.area,
      },
      executedAnalyses: ctx.selectedAnalyses,
      meta: {
        aggregation: { mode: ctx.aggregationMode },
        dateRangeApplied,
        datasetsUsed,
      },
      results,
      warnings: undefined,
    };

    const wantFormatted =
      req.options?.dataFormattedForPlots === true || req.options?.savePlotsWebp === true;
    if (wantFormatted) {
      response.dataFormattedForPlots = this.buildPlotsFormatted({
        dates,
        mpByKey,
        biomassByKey,
        kgTotalByKey,
        envFactorByKey,
        pseudoLocations,
        weightsByLocId,
        targetLoc,
        polymers,
        coastLengthKm,
        probIngestion,
        buoyPolymers: s3?.buoyPolymers ?? undefined,
        waterPolymers: s3?.water?.polymers ?? undefined,
      });
    }

    if (req.options?.savePlotsWebp === true && response.dataFormattedForPlots) {
      response.plotWebpPaths = await savePlotsAsWebp(response.dataFormattedForPlots, requestId);
      const { absolutePath } = await savePlotsPdfReport(
        response.plotWebpPaths,
        requestId,
        response.dataFormattedForPlots,
      );
      response.plotPdfPath = absolutePath;

      // Prefer S3 URIs for demo/deployed environments (so clients don't see server filesystem paths).
      try {
        const uploaded = await uploadPlotsToS3({
          requestId,
          webpPathsByKey: response.plotWebpPaths,
          pdfPath: absolutePath,
        });
        if (uploaded) {
          response.plotWebpPaths = uploaded.webpUrlsByKey;
          response.plotPdfPath = uploaded.pdfUrl;
          response.plotPdfUrl = uploaded.pdfUrl;
        }
      } catch {
        // If S3 upload is not configured/authorized, keep local paths (no HTTP download endpoint currently).
        response.plotPdfUrl = response.plotPdfPath;
      }

      // Archive the PDF and the full JSON under the basin the point belongs to,
      // as the read model reports it.
      try {
        response.analysisArchive = await uploadAnalysisResultToS3({
          requestId,
          ocean: (await this.assets.oceanFor(req.location)) ?? UNPLACED_OCEAN,
          pdfPath: absolutePath,
          responseJson: response,
        });
      } catch {
        // Non-fatal: archive upload failure does not affect the response.
      }
    }

    return response;
  }

  private buildPlotsFormatted(ctx: {
    dates: string[];
    mpByKey: Map<string, number>;
    biomassByKey: Map<string, number>;
    kgTotalByKey: Map<string, number>;
    envFactorByKey: Map<string, number>;
    pseudoLocations: Array<{ locationId: string; lat: number; lon: number }>;
    weightsByLocId: Map<string, number>;
    targetLoc: { lat: number; lon: number };
    polymers: readonly ['PE', 'PP', 'PET', 'PS'];
    coastLengthKm: number;
    probIngestion: number;
    buoyPolymers?: string[];
    waterPolymers?: string[];
  }): DataFormattedForPlots {
    const {
      dates,
      mpByKey,
      biomassByKey,
      kgTotalByKey,
      envFactorByKey,
      pseudoLocations,
      weightsByLocId,
      targetLoc,
      polymers,
      coastLengthKm,
      probIngestion,
    } = ctx;

    const locProf = locationProfile(targetLoc.lat, targetLoc.lon);

    const mpPerLByDate: number[] = [];
    for (const d of dates) {
      const pairs: Array<{ value: number; weight: number }> = [];
      for (const loc of pseudoLocations) {
        const mp = mpByKey.get(`${loc.locationId}|${d}`) ?? 0;
        pairs.push({ value: mp, weight: weightsByLocId.get(loc.locationId) ?? 0 });
      }
      mpPerLByDate.push(Number(weightedMean(pairs).toFixed(3)));
    }

    const meanMp = mean(mpPerLByDate);
    const stdMp = stddev(mpPerLByDate);
    const cvMp = meanMp > 0 ? stdMp / meanMp : 0;

    const bcfValues: number[] = [];
    const waterVsFishWater: number[] = [];
    const waterVsFishFish: number[] = [];

    const waterPercSeries: Record<(typeof polymers)[number], number[]> = {
      PE: [],
      PP: [],
      PET: [],
      PS: [],
    };

    const fishPercSeries: Record<(typeof polymers)[number], number[]> = {
      PE: [],
      PP: [],
      PET: [],
      PS: [],
    };

    for (const d of dates) {
      const waterPairsByPoly: Record<(typeof polymers)[number], Array<{ value: number; weight: number }>> = {
        PE: [],
        PP: [],
        PET: [],
        PS: [],
      };
      const fishPairsByPoly: Record<(typeof polymers)[number], Array<{ value: number; weight: number }>> = {
        PE: [],
        PP: [],
        PET: [],
        PS: [],
      };

      for (const loc of pseudoLocations) {
        const mp = mpByKey.get(`${loc.locationId}|${d}`) ?? 0.1;
        const daySeed = hashString(`fish|${loc.locationId}|${loc.lat}|${loc.lon}|${d}`);
        const rr = mulberry32(daySeed);
        const fishFactor = locProf.bcfBase + rr() * locProf.bcfRange;
        const mp_per_kg_fish = mp * fishFactor;
        const BCF = mp_per_kg_fish / Math.max(1e-6, mp);
        bcfValues.push(Number(BCF.toFixed(2)));
        waterVsFishWater.push(Number(mp.toFixed(6)));
        waterVsFishFish.push(Number(mp_per_kg_fish.toFixed(6)));

        const polySeed = hashString(`poly|${loc.locationId}|${loc.lat}|${loc.lon}|${d}`);
        const rrPoly = mulberry32(polySeed);
        const wts = randomWeights(rrPoly, polymers.length);
        const fishNoiseScale = 0.4;
        const fRaw = wts.map((x) => Math.max(0.001, x * (1 + (rrPoly() - 0.5) * fishNoiseScale)));
        const sumF = fRaw.reduce((a, b) => a + b, 0);
        const fPerc = fRaw.map((x) => (x / sumF) * 100);
        const w = weightsByLocId.get(loc.locationId) ?? 0;
        for (let pi = 0; pi < polymers.length; pi++) {
          const p = polymers[pi];
          waterPairsByPoly[p].push({ value: wts[pi], weight: w });
          fishPairsByPoly[p].push({ value: fPerc[pi], weight: w });
        }
      }

      for (const p of polymers) {
        waterPercSeries[p].push(weightedMean(waterPairsByPoly[p]));
        fishPercSeries[p].push(weightedMean(fishPairsByPoly[p]));
      }
    }

    const polymerLabels = [...polymers];
    const correlationMatrix: number[][] = [];
    for (let i = 0; i < polymers.length; i++) {
      correlationMatrix[i] = [];
      for (let j = 0; j < polymers.length; j++) {
        const r = pearsonCorrelation(waterPercSeries[polymers[i]], waterPercSeries[polymers[j]]).r;
        correlationMatrix[i][j] = Number(clamp(r, -1, 1).toFixed(4));
      }
    }

    const mpPerLExposure: number[] = [];
    const biomassArr: number[] = [];
    const exposureIndexArr: number[] = [];
    const ipcDaily: number[] = [];
    const kgTotalArr: number[] = [];
    const csiArr: number[] = [];

    for (const d of dates) {
      const mpPairs: Array<{ value: number; weight: number }> = [];
      const bioPairs: Array<{ value: number; weight: number }> = [];
      const expPairs: Array<{ value: number; weight: number }> = [];
      const ipcPairs: Array<{ value: number; weight: number }> = [];
      const kgPairs: Array<{ value: number; weight: number }> = [];
      const csiPairs: Array<{ value: number; weight: number }> = [];

      for (const loc of pseudoLocations) {
        const mp = mpByKey.get(`${loc.locationId}|${d}`) ?? 0.1;
        const daySeed = hashString(`env|${loc.locationId}|${loc.lat}|${loc.lon}|${d}`);
        const rr = mulberry32(daySeed);
        const key = `${loc.locationId}|${d}`;
        const biomass = biomassByKey.get(key) ?? (10 + rr() * 90);
        const Exposure_Index = mp * biomass * probIngestion;
        const kg_total = kgTotalByKey.get(key) ?? (rr() * 150);
        const kg_per_km = kg_total / coastLengthKm;
        const envFactor = envFactorByKey.get(key) ?? (0.5 + rr());
        const IPC = kg_per_km * envFactor;
        const CSI = mp / Math.max(1e-6, kg_total);
        const w = weightsByLocId.get(loc.locationId) ?? 0;
        mpPairs.push({ value: mp, weight: w });
        bioPairs.push({ value: biomass, weight: w });
        expPairs.push({ value: Exposure_Index, weight: w });
        ipcPairs.push({ value: IPC, weight: w });
        kgPairs.push({ value: kg_total, weight: w });
        csiPairs.push({ value: CSI, weight: w });
      }

      const mpAgg = Number(weightedMean(mpPairs).toFixed(6));
      mpPerLExposure.push(mpAgg);
      biomassArr.push(Number(weightedMean(bioPairs).toFixed(3)));
      exposureIndexArr.push(Number(weightedMean(expPairs).toFixed(3)));
      ipcDaily.push(Number(weightedMean(ipcPairs).toFixed(6)));
      kgTotalArr.push(Number(weightedMean(kgPairs).toFixed(6)));
      csiArr.push(Number(weightedMean(csiPairs).toFixed(6)));
    }

    const meanKgPerKm = mean(
      dates.map((d, idx) => {
        const kg = kgTotalArr[idx] ?? 0;
        return kg / coastLengthKm;
      }),
    );

    const coords = { lat: targetLoc.lat, lon: targetLoc.lon };
    const locLabel = `${coords.lat.toFixed(4)},${coords.lon.toFixed(4)}`;

    const concordSeed = hashString(`concord|${coords.lat}|${coords.lon}|${dates[0]}|${dates[dates.length - 1]}`);
    const rc = mulberry32(concordSeed);
    const buoyPolymers: string[] = ctx.buoyPolymers ?? polymerLabels.filter(() => rc() > 0.25);
    const waterPolymers: string[] = ctx.waterPolymers ?? polymerLabels.filter(() => rc() > 0.1);
    const overlapPercent = Number(jaccardPercent(buoyPolymers, waterPolymers).toFixed(1));

    const waterVec = polymerLabels.map((p) => mean(waterPercSeries[p as (typeof polymers)[number]]));
    const fishVec = polymerLabels.map((p) => mean(fishPercSeries[p as (typeof polymers)[number]]));
    const { r: simR, p: simP } = pearsonCorrelation(waterVec, fishVec);
    return {
      locationId: locLabel,
      coordinates: coords,
      plots: {
        '1_meanMicroplasticsConcentration': {
          title: 'Mean Microplastics Concentration (mp/L)',
          coordinates: coords,
          locations: [locLabel],
          valuesMpPerL: [Number(meanMp.toFixed(3))],
        },
        '2_microplasticsOverTime': {
          title: 'Microplastics Over Time',
          coordinates: coords,
          dates: dates.slice(),
          mpPerL: mpPerLByDate.slice(),
        },
        '3_bcfDistribution': {
          title: 'Bioconcentration Factor (BCF)',
          coordinates: coords,
          bcfValues: bcfValues.slice(),
        },
        '4_waterVsFishMicroplastics': {
          title: 'Water vs Fish Microplastics',
          coordinates: coords,
          mpPerL_water: waterVsFishWater,
          mpPerKg_fish: waterVsFishFish,
        },
        '5_polymerCorrelation': {
          title: 'Polymer Correlation',
          coordinates: coords,
          polymerLabels,
          correlationMatrix,
        },
        '6_exposureIndex': {
          title: 'Exposure Index',
          coordinates: coords,
          mpPerL: mpPerLExposure,
          biomass: biomassArr,
          exposureIndex: exposureIndexArr,
          probIngestion,
        },
        '7_plasticPressureComposition': {
          title: 'Plastic Pressure Index Composition',
          coordinates: coords,
          location: locLabel,
          waterMpPerL: Number(meanMp.toFixed(3)),
          coastKgPerKm: Number(meanKgPerKm.toFixed(6)),
        },
        '8_coastalPressureIndex': {
          title: 'Coastal Pressure Index',
          coordinates: coords,
          dates: dates.slice(),
          ipcDaily: ipcDaily.slice(),
          ipc7DayAverage: rollingMean7(ipcDaily),
        },
        '9_coastalSourceIndex': {
          title: 'Coastal Source Index',
          coordinates: coords,
          kgTotal: kgTotalArr,
          mpPerL: mpPerLExposure.slice(),
          csi: csiArr,
        },
        '10_spatialDistributionOfImpact': {
          title: 'Spatial Distribution of Impact',
          coordinates: coords,
          lon: [targetLoc.lon],
          lat: [targetLoc.lat],
          impactValues: [Number(meanMp.toFixed(3))],
        },
        '11_basicContaminationSummary': {
          title: 'Basic contamination summary',
          coordinates: coords,
          meanMpPerL: Number(meanMp.toFixed(3)),
          stdMpPerL: Number(stdMp.toFixed(3)),
          cvMpPerL: Number(cvMp.toFixed(4)),
        },
        '12_buoyVsWaterConcordance': {
          title: 'Buoy vs water concordance (polymers)',
          coordinates: coords,
          buoyPolymers,
          waterPolymers,
          overlapPercent,
        },
        '13_waterVsFishPolymerSimilarity': {
          title: 'Water vs fish polymer similarity',
          coordinates: coords,
          polymerLabels,
          waterPercent: waterVec.map((x) => Number(x.toFixed(2))),
          fishPercent: fishVec.map((x) => Number(x.toFixed(2))),
          pearson_r: Number(simR.toFixed(2)),
          p_value: Number(simP.toFixed(3)),
        },
      },
    };
  }

  private async safeLoadS3Data(loc: { lat: number; lon: number }): Promise<S3Scenario | null> {
    try {
      return await this.scenario.load(loc);
    } catch {
      return null;
    }
  }
}

