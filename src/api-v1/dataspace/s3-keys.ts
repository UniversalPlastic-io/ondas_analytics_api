import {
  Category,
  CATEGORY_BY_TYPE,
  DatasetType,
  Ocean,
  OCEANS,
  ROOT_PREFIX,
  STATIONS,
  Station,
} from './dataspace.constants';

/**
 * Resolves an S3 object key into everything derivable from the key itself.
 *
 * Live layout (docs/dataset-mapping.md):
 *   public/{ocean}/{providerFolder}/{file}.json
 */

const KEY_RE = /^public\/([^/]+)\/([^/]+)\/([^/]+)\.json$/;

/** Folders that hold schemas or API-written output, never participant datasets. */
const EXCLUDED_SEGMENTS = [/^metadatos$/i, /^analise-/i, /^analyses?$/i, /^plots$/i];

export interface ParsedKey {
  key: string;
  ocean: Ocean;
  providerFolder: string;
  fragment: string;
  place: string | null;
  station: Station | null;
  datasetType: DatasetType | null;
  category: Category | null;
}

/** Filename fragment → dataset type. Order matters: longer prefixes first. */
const TYPE_BY_FILENAME: Array<[RegExp, DatasetType]> = [
  [/^recogidas_playas?_/, 'recogidas_playa'],
  [/^boya_biomasa_/, 'boya_biomasa_slx+'],
  [/^boya_microplasticos_/, 'boya_microplasticos_seabot'],
  [/^environmental_/, 'environmental_boya'],
  [/^atmosfera_/, 'atmosfera_previa_evento'],
  [/^oceanografia_/, 'oceanografia_previa_evento'],
  [/^muestras_de_agua_/, 'muestras_de_agua_py_gcms'],
  [/^muestras_de_peces_/, 'muestras_de_peces_py_gcms'],
];

export function datasetTypeFromFilename(fragment: string): DatasetType | null {
  for (const [re, type] of TYPE_BY_FILENAME) {
    if (re.test(fragment)) return type;
  }
  return null;
}

export function placeFromFilename(fragment: string): string | null {
  const lower = fragment.toLowerCase();
  for (const slug of Object.keys(STATIONS)) {
    if (lower.endsWith(`_${slug}`)) return slug;
  }
  return null;
}

/** True when the key is a schema/output folder rather than a participant dataset. */
export function isExcludedKey(key: string): boolean {
  const segments = key.split('/');
  return segments.some((seg) => EXCLUDED_SEGMENTS.some((re) => re.test(seg)));
}

export function parseKey(key: string): ParsedKey | null {
  const trimmed = key.replace(/^\/+/, '');
  if (!trimmed.startsWith(ROOT_PREFIX)) return null;
  if (isExcludedKey(trimmed)) return null;
  const m = KEY_RE.exec(trimmed);
  if (!m) return null;
  const [, oceanRaw, providerFolder, fragment] = m;
  if (!(OCEANS as readonly string[]).includes(oceanRaw)) return null;
  const ocean = oceanRaw as Ocean;
  const datasetType = datasetTypeFromFilename(fragment);
  const place = placeFromFilename(fragment);
  return {
    key: trimmed,
    ocean,
    providerFolder,
    fragment,
    place,
    station: place ? STATIONS[place] : null,
    datasetType,
    category: datasetType ? CATEGORY_BY_TYPE[datasetType] : null,
  };
}

// ---------------------------------------------------------------------------
// Known data-quality corrections (docs/dataset-mapping.md § Data Quality Issues)
// ---------------------------------------------------------------------------

export interface Correction {
  /** Replaces the file's coordinates outright. */
  location?: { lat: number; lon: number };
  /** Multiplies the file's longitude (sign fixes). */
  lonSign?: -1 | 1;
  note: string;
}

export const CORRECTIONS: Record<string, Correction> = {
  recogidas_playa_tenerife: {
    location: { lat: 28.1876084, lon: -16.6595858 },
    note: 'coords corrected 31.483,-11.926 → Tenerife (28.188,-16.660)',
  },
  recogidas_playas_gijon: {
    location: { lat: 43.5721291, lon: -5.7212135 },
    note: 'coords corrected 31.483,-11.926 → Gijón (43.572,-5.721)',
  },
  boya_biomasa_gijon: {
    lonSign: -1,
    note: 'location.lon corrected +5.679 → -5.679',
  },
};

/** Distance beyond which a file's own coordinates are rejected for its station. */
const MAX_PLAUSIBLE_KM = 150;

export function approxDistanceKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const rad = Math.PI / 180;
  const x = (b.lon - a.lon) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const y = (b.lat - a.lat) * rad;
  return Math.sqrt(x * x + y * y) * 6371;
}

export interface ResolvedLocation {
  lat: number;
  lon: number;
  warnings: string[];
}

/**
 * Picks the coordinates to store for an asset.
 *
 * Order: explicit correction → the file's own metadata.location (when plausible
 * for its station) → the station reference point. Every deviation is recorded as
 * a warning so the map can show why a marker moved.
 */
export function resolveLocation(
  fragment: string,
  metadataLocation: { lat?: unknown; lon?: unknown } | null | undefined,
  station: Station | null,
): ResolvedLocation {
  const warnings: string[] = [];
  const correction = CORRECTIONS[fragment];

  const rawLat = Number(metadataLocation?.lat);
  const rawLon = Number(metadataLocation?.lon);
  const hasRaw =
    Number.isFinite(rawLat) && Number.isFinite(rawLon) && !(rawLat === 0 && rawLon === 0);

  if (correction?.location) {
    warnings.push(correction.note);
    return { lat: correction.location.lat, lon: correction.location.lon, warnings };
  }

  if (hasRaw && correction?.lonSign) {
    const lon = Math.abs(rawLon) * correction.lonSign;
    if (lon !== rawLon) warnings.push(correction.note);
    return { lat: rawLat, lon, warnings };
  }

  if (!hasRaw) {
    if (!station) return { lat: 0, lon: 0, warnings: ['no usable location in metadata and no station match'] };
    warnings.push(`metadata.location missing or 0,0 → station reference ${station.name}`);
    return { lat: station.lat, lon: station.lon, warnings };
  }

  if (station) {
    const distance = approxDistanceKm({ lat: rawLat, lon: rawLon }, station);
    if (distance > MAX_PLAUSIBLE_KM) {
      warnings.push(
        `metadata.location ${rawLat},${rawLon} is ${Math.round(distance)} km from ${station.name} → station reference used`,
      );
      return { lat: station.lat, lon: station.lon, warnings };
    }
  }

  return { lat: rawLat, lon: rawLon, warnings };
}
