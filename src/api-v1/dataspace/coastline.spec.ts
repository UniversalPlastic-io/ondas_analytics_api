import { COASTLINES, MAX_OFFSHORE_KM, coastFor } from './coastline';
import { OCEANS, STATIONS } from './dataspace.constants';
import { REFERENCE_LOCATION } from './reference-datasets';

/**
 * The coast decides which datasets may answer a request, so a wrong answer here
 * is a silent one: figures from another sea, presented as measurements of the
 * place asked about.
 */

const coast = (lat: number, lon: number) =>
  coastFor({ lat, lon })?.coast ?? null;

describe('coastFor', () => {
  it('places every station on the coast its own ocean says it is on', () => {
    // The stations are where the participants publish. If the coastline and the
    // station table disagreed, an asset would sit on a coast that never selects
    // it, and its category would fall back to calibration for ever.
    for (const station of Object.values(STATIONS)) {
      expect(coast(station.lat, station.lon)).toBe(station.ocean);
    }
  });

  it('reads the three coasts along the mainland', () => {
    expect(coast(43.37, -8.4)).toBe('catambrico'); // A Coruña
    expect(coast(43.46, -3.8)).toBe('catambrico'); // Santander
    expect(coast(43.32, -1.98)).toBe('catambrico'); // San Sebastián
    expect(coast(39.46, -0.33)).toBe('mediterraneo'); // Valencia
    expect(coast(37.6, -0.98)).toBe('mediterraneo'); // Cartagena
    expect(coast(36.72, -4.42)).toBe('mediterraneo'); // Málaga
    expect(coast(37.25, -6.95)).toBe('atlantico'); // Huelva
  });

  it('puts Galicia on the Cantabrian coast', () => {
    // A decision, not a fact of geography: Galicia faces the Atlantic, but it is
    // one continuous northern coast and Gijón is both the nearest data and the
    // same body of water. Treating it as Atlantic would reach for Cádiz, 900 km
    // south, for every Galician request.
    expect(coast(42.24, -8.72)).toBe('catambrico'); // Vigo
    expect(coast(42.6, -8.95)).toBe('catambrico'); // Ría de Arousa
    expect(coast(43.02, -9.28)).toBe('catambrico'); // Fisterra
  });

  it('reads the islands', () => {
    expect(coast(39.57, 2.65)).toBe('mediterraneo'); // Palma
    expect(coast(39.95, 4.1)).toBe('mediterraneo'); // Maó
    expect(coast(38.91, 1.43)).toBe('mediterraneo'); // Eivissa
    expect(coast(28.1, -15.42)).toBe('atlantico'); // Gran Canaria
    expect(coast(28.96, -13.55)).toBe('atlantico'); // Lanzarote
    expect(coast(28.68, -17.76)).toBe('atlantico'); // La Palma
  });

  it('divides the Mediterranean from the Atlantic at Punta de Tarifa', () => {
    // Both coasts hold the point, so the tie has to resolve the same way every
    // time. East of it is Mediterranean by convention.
    expect(coast(36.01, -5.61)).toBe('mediterraneo');
    expect(coast(36.13, -5.44)).toBe('mediterraneo'); // Algeciras, east
    expect(coast(36.28, -6.12)).toBe('atlantico'); // Conil, west
  });

  it('accepts a point offshore, up to the tolerance', () => {
    expect(coast(43.79, -5.72)).toBe('catambrico'); // 24 km north of Gijón
    expect(coast(41.65, 2.24)).toBe('mediterraneo'); // 24 km off Badalona
  });

  it('refuses an inland point instead of guessing the nearest sea', () => {
    // The reason this is a polyline and not a bounding box: Madrid sits inside
    // any box drawn around the Mediterranean coast.
    expect(coast(40.4168, -3.7038)).toBeNull(); // Madrid
    expect(coast(41.6488, -0.8891)).toBeNull(); // Zaragoza
    expect(coast(40.9701, -5.6635)).toBeNull(); // Salamanca
  });

  it('refuses a coast that is not Spanish, and the open ocean', () => {
    expect(coast(38.7223, -9.1393)).toBeNull(); // Lisboa
    expect(coast(43.2965, 5.3698)).toBeNull(); // Marsella
    expect(coast(48.8566, 2.3522)).toBeNull(); // París
    expect(coast(32.0, -25.0)).toBeNull(); // mid-Atlantic
    expect(coast(0, 0)).toBeNull(); // Null Island
  });

  it('reports how far from the coast the point was', () => {
    const gijon = coastFor({ lat: 43.5721, lon: -5.7212 })!;
    expect(gijon.distanceKm).toBeLessThan(1);
    const offshore = coastFor({ lat: 43.79, lon: -5.72 })!;
    expect(offshore.distanceKm).toBeGreaterThan(20);
    expect(offshore.distanceKm).toBeLessThanOrEqual(MAX_OFFSHORE_KM);
  });

  it('keeps the precision-report grid inside the tolerance', () => {
    // The six points `scripts/validate-precision.ts` queries. They are the
    // evidence E4.1 cites for R4.1, and the report fails outright if one of them
    // starts returning 400 — so a change to the coastline that pushes one out
    // has to fail here instead, where the cause is obvious.
    //
    // "Mediterráneo abierto" sits 98.7 km out, 1.3 km inside the tolerance. That
    // is the margin: it is thin on purpose, because the point exists to exercise
    // open water, but it means MAX_OFFSHORE_KM cannot be tightened without
    // moving it.
    const grid = [
      { name: 'Badalona', lat: 41.4469, lon: 2.2475 },
      { name: 'Barcelona', lat: 41.3874, lon: 2.1686 },
      { name: 'Tenerife', lat: 28.1876, lon: -16.6596 },
      { name: 'Gijón', lat: 43.5322, lon: -5.6611 },
      { name: 'Mediterráneo abierto', lat: 40.5, lon: 2.5 },
      { name: 'Costa Brava', lat: 41.9, lon: 3.16 },
    ];
    const rejected = grid
      .filter((p) => coastFor(p) === null)
      .map((p) => p.name);
    expect(rejected).toEqual([]);
  });

  it('holds the calibration series coordinates on a coast', () => {
    // Not required for the fallback to work — the reference tier is never
    // filtered by coast — but a series filed on no coast at all would be a sign
    // its coordinates had drifted somewhere unintended.
    expect(
      coast(REFERENCE_LOCATION.lat, REFERENCE_LOCATION.lon),
    ).not.toBeNull();
  });
});

describe('COASTLINES', () => {
  it('covers every ocean the system knows, with no extras', () => {
    expect(Object.keys(COASTLINES).sort()).toEqual([...OCEANS].sort());
  });

  it('gives every polyline at least two vertices, in range', () => {
    for (const [, lines] of Object.entries(COASTLINES)) {
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line.length).toBeGreaterThanOrEqual(2);
        for (const [lat, lon] of line) {
          expect(lat).toBeGreaterThanOrEqual(-90);
          expect(lat).toBeLessThanOrEqual(90);
          expect(lon).toBeGreaterThanOrEqual(-180);
          expect(lon).toBeLessThanOrEqual(180);
        }
      }
    }
  });

  it('keeps consecutive vertices close enough not to cut across open sea', () => {
    // A long segment behaves as coastline along its whole length: the reason the
    // islands are separate polylines rather than appended to the mainland, which
    // would run a 1 300 km line from Tarifa to La Palma through open ocean.
    const rad = Math.PI / 180;
    const tooLong: string[] = [];
    for (const [ocean, lines] of Object.entries(COASTLINES)) {
      for (const line of lines) {
        for (let i = 0; i < line.length - 1; i += 1) {
          const [aLat, aLon] = line[i];
          const [bLat, bLon] = line[i + 1];
          const x = (bLon - aLon) * rad * Math.cos(((aLat + bLat) / 2) * rad);
          const y = (bLat - aLat) * rad;
          const km = Math.sqrt(x * x + y * y) * 6371;
          if (km >= 200) {
            tooLong.push(
              `${ocean} ${line[i]} → ${line[i + 1]} (${km.toFixed(0)} km)`,
            );
          }
        }
      }
    }
    expect(tooLong).toEqual([]);
  });
});
