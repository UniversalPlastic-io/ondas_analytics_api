import {
  buildReferenceDatasets,
  REFERENCE_FILENAMES,
  REFERENCE_LOCATION,
  REFERENCE_RANGE,
  REFERENCE_STATISTICS,
  ReferenceDatasetFile,
} from './reference-datasets';
import {
  CATEGORY_BY_TYPE,
  REFERENCE_PUBLISHER,
  WATER_POLYMER_FIELDS,
  canonicalDatasetType,
} from './dataspace.constants';
import { resolveLocation } from './asset-location';
import { validateContainer } from './validate-container';
import { normalizeDataset } from './normalize';

const files = buildReferenceDatasets();

/** What the file declares it is. There is no path to read it out of any more. */
function typeOf(file: ReferenceDatasetFile) {
  return canonicalDatasetType(
    (file.body.metadata as { datasetType?: unknown }).datasetType,
  );
}

function categoryOf(file: ReferenceDatasetFile): string | null {
  const t = typeOf(file);
  return t ? CATEGORY_BY_TYPE[t] : null;
}

function fileFor(category: string) {
  const file = files.find((f) => categoryOf(f) === category);
  if (!file) throw new Error(`no reference dataset for category ${category}`);
  return file;
}

/** Runs a reference file through the same pipeline an ingest would. */
function ingest(category: string) {
  const file = fileFor(category);
  const container = validateContainer(file.body, typeOf(file));
  expect(container.ok).toBe(true);
  const normalized = normalizeDataset(
    container.datasetType!,
    container.envelope!.dataset,
  );
  return { file, container, normalized };
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Mean of the per-day means, which is what ScenarioLoader reads. */
function meanOfDailyMeans(
  observations: Array<{ date: string; values: Record<string, unknown> }>,
  field: string,
): number {
  const byDate = new Map<string, number[]>();
  for (const o of observations) {
    const v = o.values[field];
    if (typeof v !== 'number') continue;
    const bucket = byDate.get(o.date) ?? [];
    bucket.push(v);
    byDate.set(o.date, bucket);
  }
  return mean(Array.from(byDate.values()).map(mean));
}

describe('buildReferenceDatasets', () => {
  it('is deterministic: regenerating produces identical bytes', () => {
    expect(JSON.stringify(buildReferenceDatasets())).toEqual(
      JSON.stringify(buildReferenceDatasets()),
    );
  });

  it('produces one dataset per input the analytics engine loads', () => {
    const categories = files.map((f) => categoryOf(f)).sort();
    expect(categories).toEqual([
      'biomass',
      'cleanup',
      'environmental',
      'microplastics',
      'water_samples',
    ]);
  });

  it('declares its own dataset type, since no path carries it', () => {
    // These files are published as data space assets like any other, so what
    // they are has to be inside them.
    for (const file of files) {
      expect(typeOf(file)).not.toBeNull();
      expect(categoryOf(file)).not.toBeNull();
      expect((file.body.metadata as { dataProviderId?: string }).dataProviderId).toBe(
        REFERENCE_PUBLISHER,
      );
    }
  });

  it('exports its file names, in the order the datasets are built', () => {
    expect(REFERENCE_FILENAMES).toEqual(files.map((f) => f.filename));
  });

  it('declares a location the ingest can read, instead of falling back to 0,0', () => {
    for (const file of files) {
      // A reference series belongs to no station, so metadata.location is the
      // only source and it has to be usable on its own.
      const resolved = resolveLocation(
        file.fragment,
        file.body.metadata.location as { lat?: unknown; lon?: unknown },
        null,
      );
      expect(resolved).toEqual({ ...REFERENCE_LOCATION, warnings: [] });
    }
  });

  it('passes container validation with no errors and no type warnings', () => {
    for (const file of files) {
      const datasetType = typeOf(file);
      const container = validateContainer(file.body, datasetType);
      expect(container.errors).toEqual([]);
      expect(container.ok).toBe(true);
      expect(container.datasetType).toBe(datasetType);
      expect(container.warnings).toEqual([]);
    }
  });

  it('keeps every observation inside the declared range', () => {
    for (const file of files) {
      const datasetType = typeOf(file);
      const container = validateContainer(file.body, datasetType);
      const { observations } = normalizeDataset(
        container.datasetType!,
        container.envelope!.dataset,
      );
      expect(observations.length).toBeGreaterThan(0);
      for (const o of observations) {
        expect(o.date >= REFERENCE_RANGE.start).toBe(true);
        expect(o.date <= REFERENCE_RANGE.end).toBe(true);
      }
    }
  });

  it('normalizes biomass to biomass_t_total around the scenario mean', () => {
    const { normalized } = ingest('biomass');
    for (const o of normalized.observations) {
      expect(typeof o.values.biomass_t_total).toBe('number');
      expect(o.values.biomass_t_total as number).toBeGreaterThan(0);
    }
    const observed = meanOfDailyMeans(
      normalized.observations,
      'biomass_t_total',
    );
    expect(observed).toBeCloseTo(REFERENCE_STATISTICS.biomassTonnes.mean, 0);
    expect(normalized.warnings).toEqual([]);
  });

  it('normalizes cleanups to kg and distance_km', () => {
    const { normalized } = ingest('cleanup');
    for (const o of normalized.observations) {
      expect(o.values.distance_km).toBe(REFERENCE_STATISTICS.coastLengthKm);
      expect(typeof o.values.kg).toBe('number');
    }
    const kg = normalized.observations.map((o) => o.values.kg as number);
    // A year holds ~52 events, so the sample mean sits within about 1 kg of the
    // target. Tightening this further would mean forcing the mean in the
    // generator, which buys nothing: the engine reads the mean and the standard
    // deviation, and both are inside tolerance here.
    expect(
      Math.abs(mean(kg) - REFERENCE_STATISTICS.cleanupKg.mean),
    ).toBeLessThan(1.5);
  });

  it('normalizes the met-ocean file to the wind_speed field ScenarioLoader reads', () => {
    const { normalized } = ingest('environmental');
    expect(normalized.shape).toBe('columnar');
    for (const o of normalized.observations) {
      expect(typeof o.values.wind_speed).toBe('number');
      expect(typeof o.values.sea_surface_temperature).toBe('number');
    }
    const observed = meanOfDailyMeans(normalized.observations, 'wind_speed');
    expect(observed).toBeCloseTo(REFERENCE_STATISTICS.windSpeedMs.mean, 0);
    expect(normalized.warnings).toEqual([]);
  });

  it('normalizes water samples to one field per polymer, summing to the target', () => {
    const { normalized } = ingest('water_samples');
    const totals: number[] = [];
    for (const o of normalized.observations) {
      let total = 0;
      for (const { field } of WATER_POLYMER_FIELDS) {
        // The generic row normalizer keeps the column name as the field name.
        expect(typeof o.values[field]).toBe('number');
        expect(o.values[field] as number).toBeGreaterThan(0);
        total += o.values[field] as number;
      }
      totals.push(total);
    }
    expect(mean(totals)).toBeCloseTo(REFERENCE_STATISTICS.waterMpPerL.mean, 1);
    expect(normalized.warnings).toEqual([]);
  });

  it('normalizes microplastic particles to short polymer codes', () => {
    const { normalized } = ingest('microplastics');
    const polymers = new Set(
      normalized.observations.map((o) => o.values.polymer),
    );
    expect(Array.from(polymers).sort()).toEqual(
      REFERENCE_STATISTICS.polymers.slice().sort(),
    );
    expect(normalized.warnings).toEqual([]);
  });
});
