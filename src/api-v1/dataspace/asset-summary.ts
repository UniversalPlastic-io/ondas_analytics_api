import { Category } from './dataspace.constants';
import { CanonicalObservation } from './normalize';

/**
 * Headline numbers stored on the asset at ingest time, so the map popup and the
 * dataset list never aggregate observations on the read path.
 *
 * The shapes are the map contract: what changes here changes `MapPointDto`, so
 * regenerate docs/openapi.json when it does.
 */

function round(n: number, d = 2): number {
  const m = 10 ** d;
  return Math.round(n * m) / m;
}

function nums(observations: CanonicalObservation[], field: string): number[] {
  const out: number[] = [];
  for (const o of observations) {
    const v = o.values[field];
    if (typeof v === 'number' && Number.isFinite(v)) out.push(v);
  }
  return out;
}

const sum = (v: number[]): number => v.reduce((a, b) => a + b, 0);
const mean = (v: number[]): number | null => (v.length ? sum(v) / v.length : null);

function meanRounded(observations: CanonicalObservation[], field: string): number | null {
  const m = mean(nums(observations, field));
  return m === null ? null : round(m);
}

function countBy(observations: CanonicalObservation[], field: string): Array<{ key: string; count: number }> {
  const counts = new Map<string, number>();
  for (const o of observations) {
    const v = o.values[field];
    if (typeof v !== 'string' || !v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => ({ key, count }));
}

export function dateRangeOf(observations: CanonicalObservation[]): { start: string; end: string } | null {
  if (!observations.length) return null;
  let start = observations[0].date;
  let end = observations[0].date;
  for (const o of observations) {
    if (o.date < start) start = o.date;
    if (o.date > end) end = o.date;
  }
  return { start, end };
}

export function buildSummary(category: Category, observations: CanonicalObservation[]): Record<string, unknown> {
  switch (category) {
    case 'cleanup': {
      const durations = nums(observations, 'duration_s');
      return {
        kg: round(sum(nums(observations, 'kg'))),
        volunteers: sum(nums(observations, 'participants')),
        cleanups: observations.length,
        km: round(sum(nums(observations, 'distance_km'))),
        durationHours: round(sum(durations) / 3600),
        evidence: sum(nums(observations, 'evidence_count')),
      };
    }
    case 'biomass': {
      const totals = nums(observations, 'biomass_t_total');
      const layers = new Set<string>();
      for (const o of observations) {
        for (const [k, v] of Object.entries(o.values)) {
          if (k !== 'biomass_t_total' && k.startsWith('biomass_t_') && typeof v === 'number') layers.add(k);
        }
      }
      return {
        meanTonnes: totals.length ? round(sum(totals) / totals.length) : null,
        maxTonnes: totals.length ? round(Math.max(...totals)) : null,
        depthLayers: layers.size,
        readings: observations.length,
      };
    }
    case 'microplastics':
      return {
        particles: observations.length,
        byPolymer: countBy(observations, 'polymer').map(({ key, count }) => ({ type: key, count })),
        bySize: countBy(observations, 'size').map(({ key, count }) => ({ size: key, count })),
        byForm: countBy(observations, 'form').map(({ key, count }) => ({ form: key, count })),
      };
    case 'environmental':
      return {
        readings: observations.length,
        meanSeaSurfaceTemperatureC: meanRounded(observations, 'sea_surface_temperature'),
        meanWindSpeedMs: meanRounded(observations, 'wind_speed'),
      };
    case 'atmospheric':
      return {
        events: new Set(observations.map((o) => o.eventDate).filter(Boolean)).size,
        days: observations.length,
        meanAirTemperatureC: meanRounded(observations, 'air_temperature'),
        meanWindSpeedMs: meanRounded(observations, 'wind_speed'),
      };
    case 'oceanographic':
      return {
        events: new Set(observations.map((o) => o.eventDate).filter(Boolean)).size,
        days: observations.length,
        meanSeaSurfaceTemperatureC: meanRounded(observations, 'sea_surface_temperature'),
        meanSignificantWaveHeightM: meanRounded(observations, 'significant_wave_height'),
      };
    default:
      return { records: observations.length };
  }
}
