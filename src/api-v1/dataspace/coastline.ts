import { Ocean } from './dataspace.constants';

/**
 * Which stretch of coast a requested point belongs to.
 *
 * The analytics engine used to answer this with `nearest()` over every observed
 * asset, unbounded: a request at Gijón whose category had no Cantabrian dataset
 * silently took Badalona's, 695 km away and in another sea, and said nothing.
 * Distance alone cannot express the rule either — the Mediterranean and the Gulf
 * of Cádiz are 200 km apart across the Strait but are different water bodies,
 * while Galicia and Asturias are 300 km apart along the same one.
 *
 * So a point is assigned to a coast, and only datasets on that coast may answer
 * for it. A coast with no dataset of a category falls back to the calibration
 * series — that is what the reference tier is for. Borrowing from another coast
 * is never right.
 *
 * Each coast is a set of polylines of coastal vertices rather than a bounding
 * box, because a box cannot tell the sea from the land behind it: Madrid sits
 * inside any box drawn around the Mediterranean coast. A point belongs to the
 * coast whose polylines come closest, and only if it lies within
 * `MAX_OFFSHORE_KM` of one.
 *
 * The islands are separate polylines rather than a continuation of the mainland
 * one. A single chain would run a segment from Portbou to Eivissa and another
 * from Tarifa to La Palma, and every point of open ocean along those 1 300 km
 * would count as coast.
 */

/** How far offshore — or inland — a point may be and still belong to a coast. */
export const MAX_OFFSHORE_KM = 100;

/**
 * Coastal vertices per coast, each group ordered along one stretch of shore.
 *
 * Deliberately coarse: they define which body of water a point faces, not a
 * shoreline. Adding detail between two vertices changes nothing, since what
 * decides is the distance to the polyline as a whole.
 */
export const COASTLINES: Record<Ocean, Array<Array<[number, number]>>> = {
  // Miño to Bidasoa. Galicia is included here: it is one continuous northern
  // coast, and Gijón is both the nearest data and the same water body. The
  // alternative — Galicia as Atlantic — would reach for Cádiz, 900 km south.
  catambrico: [
    [
      [41.86, -8.87], // desembocadura del Miño
      [42.24, -8.8], // Vigo
      [42.6, -8.95], // Ría de Arousa
      [43.02, -9.28], // Fisterra
      [43.37, -8.4], // A Coruña
      [43.79, -7.69], // Estaca de Bares
      [43.55, -7.04], // Ribadeo
      [43.55, -6.2], // Luarca
      [43.57, -5.72], // Gijón
      [43.42, -4.5], // San Vicente de la Barquera
      [43.46, -3.8], // Santander
      [43.4, -3.0], // Castro Urdiales
      [43.33, -2.0], // Getxo
      [43.39, -1.79], // Bidasoa
    ],
  ],

  // Punta de Tarifa to Portbou, and the Balearics. Tarifa is the conventional
  // divide: waters east of it are Mediterranean. It appears in both coasts, and
  // the point itself resolves here — see `COAST_ORDER`.
  mediterraneo: [
    [
      [36.01, -5.61], // Punta de Tarifa
      [36.13, -5.44], // Algeciras
      [36.5, -4.88], // Marbella
      [36.72, -4.42], // Málaga
      [36.75, -3.52], // Motril
      [36.83, -2.46], // Almería
      [37.58, -0.98], // Cartagena
      [38.08, -0.65], // Torrevieja
      [38.34, -0.48], // Alicante
      [38.84, 0.11], // Dénia
      [39.46, -0.33], // Valencia
      [40.0, 0.03], // Castellón
      [40.62, 0.72], // delta del Ebro
      [41.12, 1.24], // Tarragona
      [41.35, 2.16], // Barcelona
      [41.43, 2.24], // Badalona
      [41.68, 2.8], // Blanes
      [42.29, 3.28], // Cap de Creus
      [42.43, 3.17], // Portbou
    ],
    [
      [38.91, 1.43], // Eivissa
      [39.57, 2.65], // Palma
      [39.72, 3.46], // Manacor
      [39.95, 4.1], // Maó
    ],
  ],

  // Gulf of Cádiz and the Canaries: the Atlantic coast where ONDAs has data.
  atlantico: [
    [
      [37.21, -7.4], // Ayamonte
      [37.25, -6.95], // Huelva
      [36.8, -6.35], // Sanlúcar de Barrameda
      [36.53, -6.29], // Cádiz
      [36.28, -6.12], // Conil
      [36.01, -5.61], // Punta de Tarifa
    ],
    [
      [28.68, -17.76], // La Palma
      [27.75, -17.99], // El Hierro
      [28.19, -16.66], // Tenerife
      [28.1, -15.42], // Gran Canaria
      [28.5, -13.86], // Fuerteventura
      [28.96, -13.55], // Lanzarote
    ],
  ],
};

/**
 * The order coasts are tested in. Fixed so a tie is always resolved the same
 * way, and Mediterranean first so Punta de Tarifa — which belongs to both
 * coasts at distance zero — comes out Mediterranean, as the convention has it.
 */
const COAST_ORDER: Ocean[] = ['mediterraneo', 'atlantico', 'catambrico'];

/**
 * Equirectangular distance in km. Accurate enough at these latitudes and over
 * these distances, and the same approximation `asset-location.ts` uses.
 */
function distanceKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const rad = Math.PI / 180;
  const x = (b.lon - a.lon) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const y = (b.lat - a.lat) * rad;
  return Math.sqrt(x * x + y * y) * 6371;
}

/** Shortest distance from a point to the segment ab, in km. */
function distanceToSegmentKm(
  p: { lat: number; lon: number },
  a: [number, number],
  b: [number, number],
): number {
  // Project into a local plane so the segment maths is plain 2D. Longitude is
  // scaled by cos(lat) so a degree east is the same length as a degree north.
  const rad = Math.PI / 180;
  const scale = Math.cos(p.lat * rad) || 1;
  const px = p.lon * scale;
  const py = p.lat;
  const ax = a[1] * scale;
  const ay = a[0];
  const bx = b[1] * scale;
  const by = b[0];

  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return distanceKm(p, { lat: a[0], lon: a[1] });

  // How far along ab the perpendicular from p falls, clamped to the segment.
  const t = Math.max(
    0,
    Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared),
  );
  return distanceKm(p, { lat: ay + t * dy, lon: (ax + t * dx) / scale });
}

/** Shortest distance from a point to any of a coast's polylines, in km. */
export function distanceToCoastKm(
  loc: { lat: number; lon: number },
  coast: Ocean,
): number {
  let best = Infinity;
  for (const line of COASTLINES[coast]) {
    if (line.length === 1) {
      const d = distanceKm(loc, { lat: line[0][0], lon: line[0][1] });
      if (d < best) best = d;
      continue;
    }
    for (let i = 0; i < line.length - 1; i += 1) {
      const d = distanceToSegmentKm(loc, line[i], line[i + 1]);
      if (d < best) best = d;
    }
  }
  return best;
}

export interface CoastMatch {
  coast: Ocean;
  distanceKm: number;
}

/**
 * The coast a point belongs to, or null when it belongs to none.
 *
 * Null is the honest answer for an inland point, a foreign coast or open ocean:
 * there is no coast whose datasets could describe it, and answering with the
 * least-distant one would return numbers that look measured.
 * `POST /v1/analyses/run` rejects such a request rather than serving them.
 */
export function coastFor(loc: { lat: number; lon: number }): CoastMatch | null {
  let best: CoastMatch | null = null;
  for (const coast of COAST_ORDER) {
    const distanceKm = distanceToCoastKm(loc, coast);
    if (best === null || distanceKm < best.distanceKm) {
      best = { coast, distanceKm };
    }
  }
  return best && best.distanceKm <= MAX_OFFSHORE_KM ? best : null;
}
