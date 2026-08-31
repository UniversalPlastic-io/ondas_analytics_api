/**
 * Reference datasets: the calibration series the analytics engine falls back to
 * when a location has no observed dataset of a given category.
 *
 * They used to be a scenario block in `fixtures/analyses_overrides.json`, read
 * from disk at request time and keyed by an exact latitude/longitude/date-range
 * triple. Now they are ordinary data space assets: generated here, published to
 * the bucket like any participant file, and read back through the same
 * validate → normalize → Mongo pipeline. One code path instead of two, and the
 * engine no longer carries hardcoded magic numbers.
 *
 * The values reproduce the statistics the engine consumed from that scenario
 * (35 t of daily biomass, 55 kg per cleanup event, 45 km of coast, a wind speed
 * mapping to an environmental factor of ~1.0). The scenario's per-day trend and
 * weekly seasonality are deliberately not reproduced: they shaped a demo curve,
 * and the engine only ever reads a mean, a standard deviation and a polymer list
 * from these inputs.
 *
 * Generation is deterministic — same range in, byte-identical files out — so
 * regenerating never produces a spurious diff. See scripts/generate-reference-datasets.ts.
 */

import { jitter } from '../deterministic-rng';
import {
  REFERENCE_PUBLISHER,
  WATER_POLYMER_FIELDS,
} from './dataspace.constants';

export interface ReferenceRange {
  start: string;
  end: string;
}

export interface ReferenceDatasetFile {
  /** File name to write locally and to publish the asset under. */
  filename: string;
  fragment: string;
  body: {
    metadata: Record<string, unknown>;
    dataset: Record<string, unknown>;
  };
}

/** Ocean folder the reference files live under. */
export const REFERENCE_OCEAN = 'mediterraneo';

/**
 * Open water in the Balearic Sea, far enough from every station in STATIONS not
 * to be mistaken for one. The coordinates only order the reference tier against
 * itself — one file per category, so in practice they never decide anything.
 */
export const REFERENCE_LOCATION = { lat: 40.5, lon: 2.5 };

export const REFERENCE_RANGE: ReferenceRange = {
  start: '2025-01-01',
  end: '2025-12-31',
};

/** What the analytics engine reads back out of these datasets. */
export const REFERENCE_STATISTICS = {
  biomassTonnes: { mean: 35, amplitude: 2.5 },
  cleanupKg: { mean: 55, amplitude: 6 },
  coastLengthKm: 45,
  /** 7.5 m/s maps to an environmental factor of 1.0 in ScenarioLoader. */
  windSpeedMs: { mean: 7.5, amplitude: 1.5 },
  /** Canonical short codes, as `shortPolymer` emits them. */
  polymers: ['PE', 'PP', 'PET', 'PS'],
  /** Total microplastic concentration in surface water, μg L⁻¹. */
  waterMpPerL: { mean: 2.2, amplitude: 0.12 },
};

/** Fixed so that regenerating a file does not change its bytes. */
const CREATED_AT = '2026-08-28T00:00:00.000Z';

const LICENSE = 'https://creativecommons.org/licenses/by/4.0/';

/** Readings per day for the two buoy series. */
const READINGS_PER_DAY = 4;

const POLYMER_LONG_NAMES: Record<string, string> = {
  PE: 'Polyethylene',
  PP: 'Polypropylene',
  PET: 'Polyethylene terephthalate',
  PS: 'Polystyrene',
};

function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

function datesOf(range: ReferenceRange): string[] {
  const out: string[] = [];
  const end = new Date(`${range.end}T00:00:00.000Z`);
  for (
    let d = new Date(`${range.start}T00:00:00.000Z`);
    d <= end;
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/** `06:00:00`, `12:00:00`, … for reading `i` of the day. */
function readingTime(i: number): string {
  const hour = Math.round((24 / READINGS_PER_DAY) * i) % 24;
  return `${String(hour).padStart(2, '0')}:00:00`;
}

function metadataFor(opts: {
  datasetType: string;
  range: ReferenceRange;
  recordCount: number;
  provenance: string;
  /** Every column the file carries, in order, including the index columns. */
  columns: string[];
  units: Record<string, string>;
}): Record<string, unknown> {
  return {
    schemaVersion: 'v1',
    datasetType: opts.datasetType,
    dataProviderId: REFERENCE_PUBLISHER,
    'dct:publisher': REFERENCE_PUBLISHER,
    createdAt: CREATED_AT,
    'dct:temporal': { start: opts.range.start, end: opts.range.end },
    'dct:spatial': { ...REFERENCE_LOCATION },
    // The field the ingest actually reads for an asset's position; `dct:spatial`
    // mirrors it for the DCAT description. Without it, a filename with no
    // station suffix resolves to 0,0.
    location: { ...REFERENCE_LOCATION },
    recordCount: opts.recordCount,
    // The DCAT schema of a type declares every column the type can carry; a file
    // that publishes a subset says so here, and the validator then stops
    // reporting the rest as missing.
    fieldsIncluded: opts.columns,
    license: LICENSE,
    'dct:provenance': { 'rdfs:label': opts.provenance },
    units: opts.units,
  };
}

// ---------------------------------------------------------------------------
// boya_biomasa_slx+ — daily biomass across three depth layers
// ---------------------------------------------------------------------------

const BIOMASS_LAYERS: Array<{ column: string; share: number }> = [
  { column: 'Biomass depth -3_-5 m', share: 0.65 },
  { column: 'Biomass depth -5.00_-8 m', share: 0.25 },
  { column: 'Biomass depth -8.00_-11 m', share: 0.1 },
];

function biomassFile(range: ReferenceRange): ReferenceDatasetFile {
  const { mean, amplitude } = REFERENCE_STATISTICS.biomassTonnes;
  const records: Array<Record<string, unknown>> = [];

  for (const date of datesOf(range)) {
    // Day-to-day variation carries the standard deviation the engine reads; the
    // per-reading jitter only keeps a day from being a flat line.
    const dailyTotal = jitter(`reference|biomass|${date}`, mean, amplitude);
    for (let i = 0; i < READINGS_PER_DAY; i += 1) {
      const total = Math.max(
        1,
        jitter(`reference|biomass|${date}|${i}`, dailyTotal, 1.2),
      );
      const record: Record<string, unknown> = {
        Date: date,
        Time: readingTime(i),
      };
      for (const layer of BIOMASS_LAYERS) {
        record[layer.column] = round(total * layer.share, 1);
      }
      records.push(record);
    }
  }

  return {
    filename: filenameFor('boya_biomasa_referencia'),
    fragment: 'boya_biomasa_referencia',
    body: {
      metadata: metadataFor({
        datasetType: 'boya_biomasa_slx+',
        range,
        recordCount: records.length,
        provenance:
          'Serie de biomasa de referencia generada por ondas-analytics-api. Se sirve cuando el área consultada no tiene ninguna boya de biomasa con datos.',
        columns: ['Date', 'Time', ...BIOMASS_LAYERS.map((l) => l.column)],
        units: Object.fromEntries(
          BIOMASS_LAYERS.map((l) => [l.column, 'Tonnes']),
        ),
      }),
      dataset: { format: 'rows', records },
    },
  };
}

// ---------------------------------------------------------------------------
// recogidas_playa — one cleanup event per week
// ---------------------------------------------------------------------------

/**
 * Composition percentages, spelled the way the DCAT schema and most live files
 * do — without the `(%)` suffix. The normalizer accepts both spellings.
 */
const POLYMER_PCT = {
  'Polyethylene terephthalate': 22,
  'High-density polyethylene': 14,
  'Polyvinyl chloride': 6,
  'Low-density polyethylene': 13,
  Polypropylene: 24,
  Polystyrene: 11,
  Others: 10,
};

function cleanupFile(range: ReferenceRange): ReferenceDatasetFile {
  const { mean, amplitude } = REFERENCE_STATISTICS.cleanupKg;
  const records: Array<Record<string, unknown>> = [];
  const point = `${REFERENCE_LOCATION.lat},${REFERENCE_LOCATION.lon}`;

  // One event every seven days, so a year holds ~52.
  const dates = datesOf(range).filter((_, i) => i % 7 === 0);
  for (const date of dates) {
    const kg = round(jitter(`reference|cleanup|${date}`, mean, amplitude), 1);
    const participants = Math.round(
      jitter(`reference|cleanup|participants|${date}`, 12, 4),
    );
    records.push({
      Date: date,
      'Plastic waste collected': kg,
      'Number of participants': participants,
      'Walking distance': REFERENCE_STATISTICS.coastLengthKm,
      'Cleanup duration': '1:15:00',
      'Start point': point,
      'End point': point,
      // Declared and empty: a calibration series has no evidence photographs,
      // and omitting the column would only produce a DCAT warning.
      'Collected waste image': '',
      ...POLYMER_PCT,
    });
  }

  return {
    filename: filenameFor('recogidas_playas_referencia'),
    fragment: 'recogidas_playas_referencia',
    body: {
      metadata: metadataFor({
        datasetType: 'recogidas_playa',
        range,
        recordCount: records.length,
        provenance:
          'Serie de recogidas de referencia generada por ondas-analytics-api. Se sirve cuando el área consultada no tiene ninguna campaña de recogida con datos.',
        columns: Object.keys(records[0] ?? {}),
        units: {
          'Plastic waste collected': 'kg',
          'Number of participants': 'count',
          'Walking distance': 'km',
          'Cleanup duration': 'HH:MM:SS',
          'Start point': 'decimal degree',
          'End point': 'decimal degree',
          ...Object.fromEntries(Object.keys(POLYMER_PCT).map((k) => [k, '%'])),
        },
      }),
      dataset: { format: 'rows', records },
    },
  };
}

// ---------------------------------------------------------------------------
// environmental_boya — columnar met-ocean readings
//
// The environmental normalizer keeps the raw column name as the canonical field,
// so these columns are already named the way ScenarioLoader and buildSummary
// look them up.
// ---------------------------------------------------------------------------

function environmentalFile(range: ReferenceRange): ReferenceDatasetFile {
  const wind = REFERENCE_STATISTICS.windSpeedMs;
  const columns: Record<string, unknown[]> = {
    Date: [],
    Time: [],
    wind_speed: [],
    sea_surface_temperature: [],
    ocean_current_speed: [],
  };

  for (const date of datesOf(range)) {
    const dailyWind = jitter(
      `reference|environmental|${date}`,
      wind.mean,
      wind.amplitude,
    );
    // Mediterranean surface temperature, seasonal: coldest in February.
    const dayOfYear = Math.round(
      (Date.parse(`${date}T00:00:00.000Z`) -
        Date.parse(`${date.slice(0, 4)}-01-01T00:00:00.000Z`)) /
        86_400_000,
    );
    const seasonal = 18 - 5 * Math.cos((2 * Math.PI * (dayOfYear - 32)) / 365);

    for (let i = 0; i < READINGS_PER_DAY; i += 1) {
      columns.Date.push(date);
      columns.Time.push(readingTime(i));
      columns.wind_speed.push(
        round(
          Math.max(0.2, jitter(`reference|wind|${date}|${i}`, dailyWind, 0.8)),
          2,
        ),
      );
      columns.sea_surface_temperature.push(
        round(jitter(`reference|sst|${date}|${i}`, seasonal, 0.4), 2),
      );
      columns.ocean_current_speed.push(
        round(
          Math.max(0.01, jitter(`reference|current|${date}|${i}`, 0.3, 0.12)),
          3,
        ),
      );
    }
  }

  return {
    filename: filenameFor('environmental_referencia'),
    fragment: 'environmental_referencia',
    body: {
      metadata: metadataFor({
        datasetType: 'environmental_boya',
        range,
        recordCount: columns.Date.length,
        provenance:
          'Serie meteo-oceanográfica de referencia generada por ondas-analytics-api. Se sirve cuando el área consultada no tiene ninguna boya meteo-oceanográfica con datos.',
        columns: Object.keys(columns),
        units: {
          wind_speed: 'm/s',
          sea_surface_temperature: '°C',
          ocean_current_speed: 'm/s',
        },
      }),
      dataset: { format: 'columnar', index: ['Date', 'Time'], columns },
    },
  };
}

// ---------------------------------------------------------------------------
// boya_microplasticos_seabot — one record per detected particle
// ---------------------------------------------------------------------------

const PARTICLE_FORMS = ['Fragment', 'Fibre', 'Film', 'Pellet'];
const PARTICLE_COLOURS = ['Transparent', 'White', 'Blue', 'Black', 'Red'];

function microplasticsFile(range: ReferenceRange): ReferenceDatasetFile {
  const records: Array<Record<string, unknown>> = [];
  const polymers = REFERENCE_STATISTICS.polymers;

  // Four particles per sampling day, sampling every seventh day.
  const dates = datesOf(range).filter((_, i) => i % 7 === 3);
  let particleId = 1;
  for (const date of dates) {
    for (let i = 0; i < polymers.length; i += 1) {
      // Every polymer appears on every sampling day, so the distinct-polymer list
      // the engine reads is stable whatever slice of the range is queried.
      const code = polymers[i];
      records.push({
        Date: date,
        Particle_ID: particleId,
        Size: `${round(jitter(`reference|particle|size|${date}|${i}`, 0.45, 0.3), 2)} mm`,
        Form: PARTICLE_FORMS[particleId % PARTICLE_FORMS.length],
        Type_of_Polymer: POLYMER_LONG_NAMES[code] ?? code,
        Colour: PARTICLE_COLOURS[particleId % PARTICLE_COLOURS.length],
      });
      particleId += 1;
    }
  }

  return {
    filename: filenameFor('boya_microplasticos_referencia'),
    fragment: 'boya_microplasticos_referencia',
    body: {
      metadata: metadataFor({
        datasetType: 'boya_microplasticos_seabot',
        range,
        recordCount: records.length,
        provenance:
          'Serie de partículas de referencia generada por ondas-analytics-api. Se sirve cuando el área consultada no tiene ninguna boya de microplásticos con datos.',
        columns: Object.keys(records[0] ?? {}),
        units: { Size: 'mm' },
      }),
      dataset: { format: 'rows', records },
    },
  };
}

// ---------------------------------------------------------------------------
// muestras_de_agua_py_gcms — weekly Py-GC/MS analysis of a surface water sample
//
// One row per sample, one column per polymer in μg L⁻¹, exactly the schema in
// metadata/DCAT/muestras_de_agua_py_gcms.jsonld. These files go through the
// generic row normalizer, so each column name becomes a canonical field.
// ---------------------------------------------------------------------------

/**
 * How the total concentration splits across the twelve polymers, in μg L⁻¹.
 * Sums to REFERENCE_STATISTICS.waterMpPerL.mean.
 */
const WATER_POLYMER_SHARE: Record<string, number> = {
  Polyethylene: 0.62,
  Polypropylene: 0.48,
  Polystyrene: 0.22,
  'Polyvinyl chloride': 0.13,
  'Polyethylene terephthalate': 0.3,
  Polyamide: 0.11,
  Polycarbonate: 0.07,
  Polyurethane: 0.06,
  'Poly(methyl methacrylate)': 0.05,
  'Acrylonitrile-butadiene-styrene': 0.05,
  'Polyvinyl acetate': 0.06,
  'Polyvinyl alcohol': 0.05,
};

function waterSamplesFile(range: ReferenceRange): ReferenceDatasetFile {
  const { mean, amplitude } = REFERENCE_STATISTICS.waterMpPerL;
  const records: Array<Record<string, unknown>> = [];

  // Py-GC/MS is a lab analysis of a collected sample, so weekly, not hourly.
  const dates = datesOf(range).filter((_, i) => i % 7 === 5);
  for (const date of dates) {
    // One daily total, split by the shares: the polymer mix stays realistic
    // while the total carries the variation the engine reads.
    const total = jitter(`reference|water|${date}`, mean, amplitude);
    const scale = total / mean;
    const record: Record<string, unknown> = { Date: date };
    for (const { field } of WATER_POLYMER_FIELDS) {
      // precision=0.001 and min=0 come from the DCAT scale of every column.
      record[field] = Math.max(0, round(WATER_POLYMER_SHARE[field] * scale, 3));
    }
    records.push(record);
  }

  return {
    filename: filenameFor('muestras_de_agua_referencia'),
    fragment: 'muestras_de_agua_referencia',
    body: {
      metadata: metadataFor({
        datasetType: 'muestras_de_agua_py_gcms',
        range,
        recordCount: records.length,
        provenance:
          'Serie de concentración de microplásticos en agua de referencia generada por ondas-analytics-api. Se sirve cuando el área consultada no tiene ninguna muestra de agua con datos.',
        columns: Object.keys(records[0] ?? {}),
        units: Object.fromEntries(
          WATER_POLYMER_FIELDS.map(({ field }) => [field, 'μg L⁻¹']),
        ),
      }),
      dataset: { format: 'rows', records },
    },
  };
}

function filenameFor(fragment: string): string {
  return `${fragment}.json`;
}

/** The reference datasets, in a stable order. */
export function buildReferenceDatasets(
  range: ReferenceRange = REFERENCE_RANGE,
): ReferenceDatasetFile[] {
  return [
    biomassFile(range),
    cleanupFile(range),
    environmentalFile(range),
    microplasticsFile(range),
    waterSamplesFile(range),
  ];
}

/**
 * Names of the reference datasets. Listed rather than derived from
 * buildReferenceDatasets() so that importing this constant does not generate a
 * year of records.
 */
export const REFERENCE_FILENAMES: string[] = [
  'boya_biomasa_referencia',
  'recogidas_playas_referencia',
  'environmental_referencia',
  'boya_microplasticos_referencia',
  'muestras_de_agua_referencia',
].map(filenameFor);
