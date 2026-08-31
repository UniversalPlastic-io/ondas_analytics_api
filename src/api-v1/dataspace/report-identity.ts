import { createHash } from 'node:crypto';

/**
 * The name and description a published analysis carries in the catalog.
 *
 * Pure: no clock, no configuration, no connector. The instant is passed in, so
 * the same request always produces the same identity and the whole thing is
 * testable without publishing anything.
 *
 * The split between the two fields is the point. The name is what a person scans
 * a catalog listing for, so it holds only the point and the day. The description
 * holds what actually distinguishes one analysis of that point from another —
 * radius, window, aggregation, which analyses ran — because the name cannot:
 * two requests for the same point on the same day with radius 25 and 50 km are
 * different analyses with the same name.
 */

/** Marks the digest inside the description, so a reader can find it. */
export const KEY_FIELD = 'key=';

const PREFIX = 'report';

export interface ReportIdentityInput {
  location: { lat: number; lon: number };
  area: { type: string; value: number };
  dateRange: { start: string; end: string };
  aggregation: string;
  analyses: readonly string[];
  /** The coast the request resolved to. Names the water body in one word. */
  coast: string;
  /** `meta.cache.cacheKey` of the response being published. */
  cacheKey: string;
  /** When the analysis was generated. Its UTC day goes in the name. */
  generatedAt: Date;
}

export interface ReportIdentity {
  name: string;
  description: string;
  /** Short digest of the cache key, as it appears in the description. */
  digest: string;
}

/**
 * Four decimals, fixed width.
 *
 * The same rounding `computeCacheKey` applies, so the name and the identity agree
 * on which point this is. Fixed width rather than the shortest representation
 * because a listing where some names carry one decimal and others four cannot be
 * scanned or prefix-filtered.
 */
function coord(n: number): string {
  if (!Number.isFinite(n)) {
    throw new Error(`coordinate is not a finite number: ${n}`);
  }
  const rounded = Math.round(n * 1e4) / 1e4;
  // Rounding a small negative number gives -0, which prints as "-0.0000".
  return (rounded === 0 ? 0 : rounded).toFixed(4);
}

/** The UTC day. Not the local one: the same analysis must not be named twice. */
function utcDay(at: Date): string {
  const iso = at.toISOString();
  if (!iso) throw new Error('generatedAt is not a valid date');
  return iso.slice(0, 10);
}

/**
 * A short, stable digest of the cache key.
 *
 * The cache key itself is a JSON document a few hundred characters long — the
 * whole normalized request — which is not something to put in a description.
 * The digest is enough to tell two analyses apart and to search for one, and the
 * full key is inside the published document anyway, at `meta.cache.cacheKey`.
 */
export function reportKeyDigest(cacheKey: string): string {
  return createHash('sha256').update(cacheKey).digest('hex').slice(0, 16);
}

export function reportIdentity(input: ReportIdentityInput): ReportIdentity {
  const digest = reportKeyDigest(input.cacheKey);
  const name = [
    PREFIX,
    coord(input.location.lat),
    coord(input.location.lon),
    utcDay(input.generatedAt),
  ].join('_');

  const area =
    input.area.type === 'radius_km'
      ? `radio ${input.area.value} km`
      : `${input.area.type} ${input.area.value}`;
  const analyses = input.analyses.length
    ? [...input.analyses].sort().join('+')
    : 'ninguno';

  const description = [
    'ONDAs analytics report',
    input.coast,
    area,
    `${input.dateRange.start}→${input.dateRange.end}`,
    input.aggregation,
    analyses,
    `${KEY_FIELD}${digest}`,
  ].join(' · ');

  return { name, description, digest };
}
