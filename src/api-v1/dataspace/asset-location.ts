import { Station } from './dataspace.constants';

/**
 * Where an asset actually is.
 *
 * Several published datasets carry coordinates that are wrong — zeroed, sign
 * flipped, or hundreds of kilometres from the site they describe. The fixes are
 * kept here, keyed by asset id, and every deviation is recorded as a warning so
 * a moved marker can always be explained.
 */

export interface Correction {
  /** Replaces the published coordinates outright. */
  location?: { lat: number; lon: number };
  /** Multiplies the published longitude. For sign errors. */
  lonSign?: -1 | 1;
  note: string;
}

/**
 * Corrections by asset id.
 *
 * Keyed by id rather than by name because within one publication the id is the
 * only stable handle: a provider can rename an asset at any time, and a
 * correction that silently stopped applying would put a marker back in the sea
 * off West Africa without anything failing.
 *
 * The trade-off is that republishing changes the id, and these keys must then be
 * refreshed with the table — `npm run assets:refresh` reports the new ids. The
 * corrections below have not been re-verified against the republished data,
 * because transfers do not resolve yet: they are kept because the defect they
 * describe is in the source file, not in the publication.
 */
export const CORRECTIONS: Record<string, Correction> = {
  // Innoceana — Recogidas playas Tenerife_v1.1
  'f2aec864-8a58-42d9-9231-19cad86968fc': {
    location: { lat: 28.1876084, lon: -16.6595858 },
    note: 'coords corrected 31.483,-11.926 → Tenerife (28.188,-16.660)',
  },
  // Universal Plastic — Boya biomasa Gijón_v1.1
  'c8ef3fe3-c966-4e63-a003-f3615ad94c71': {
    lonSign: -1,
    note: 'location.lon corrected +5.679 → -5.679',
  },
  // Gijón's cleanup dataset carried the same wrong coordinates as Tenerife's,
  // but it was not republished in the `_v1.1` round: no asset in the space is
  // a `recogidas_playa` for Gijón any more. The correction is re-added, keyed
  // by the new id, when the provider publishes it again.
};

/** Distance beyond which an asset's own coordinates are rejected for its station. */
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
 * Order: explicit correction → the asset's own metadata.location, when plausible
 * for its station → the station reference point.
 */
export function resolveLocation(
  assetId: string,
  metadataLocation: { lat?: unknown; lon?: unknown } | null | undefined,
  station: Station | null,
): ResolvedLocation {
  const warnings: string[] = [];
  const correction = CORRECTIONS[assetId];

  const rawLat = Number(metadataLocation?.lat);
  const rawLon = Number(metadataLocation?.lon);
  const hasRaw =
    Number.isFinite(rawLat) &&
    Number.isFinite(rawLon) &&
    !(rawLat === 0 && rawLon === 0);

  if (correction?.location) {
    warnings.push(correction.note);
    return {
      lat: correction.location.lat,
      lon: correction.location.lon,
      warnings,
    };
  }

  if (hasRaw && correction?.lonSign) {
    const lon = Math.abs(rawLon) * correction.lonSign;
    if (lon !== rawLon) warnings.push(correction.note);
    return { lat: rawLat, lon, warnings };
  }

  if (!hasRaw) {
    if (!station) {
      return {
        lat: 0,
        lon: 0,
        warnings: ['no usable location in metadata and no station match'],
      };
    }
    warnings.push(
      `metadata.location missing or 0,0 → station reference ${station.name}`,
    );
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
