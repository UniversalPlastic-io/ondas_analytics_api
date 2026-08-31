import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatasetType } from './dataspace.constants';
import { biomassDepthField, recogidasKey } from './normalize/field-maps';

/**
 * Phases 2 and 3 of the asset contract (docs/dataspace-assets copy.md § Validación):
 * compare the dataset's columns against the DCAT schema for its type, and read the
 * `clave=valor` semantics out of `schema:description`.
 *
 * Never blocking — every deviation becomes a warning stored on the asset.
 */

/**
 * The bundled copies. Two types have none — `atmosfera_previa_evento` and
 * `oceanografia_previa_evento` — which is why their columns have never been
 * checked against anything. The data space is where that gap closes: the
 * providers publish a DCAT document per dataset, and those two are among them.
 */
const LOCAL_DCAT: Partial<Record<DatasetType, string>> = {
  recogidas_playa: 'recogidas_plastico_app_up_v700.jsonld',
  'boya_biomasa_slx+': 'boya_biomasa_slx+.jsonld',
  boya_microplasticos_seabot: 'boya_microplasticos_seabot.jsonld',
  environmental_boya: 'meteorología_cdse_vl.jsonld',
  muestras_de_agua_py_gcms: 'muestras_de_agua_py_gcms.jsonld',
  muestras_de_peces_py_gcms: 'muestras_de_peces_py_gcms.jsonld',
};

/** Types that have a bundled copy. The other two depend entirely on the space. */
export function bundledDcatTypes(): DatasetType[] {
  return Object.keys(LOCAL_DCAT) as DatasetType[];
}

export interface DcatVariable {
  name: string;
  description: string;
  attrs: Record<string, string>;
}

export interface DcatSchema {
  id: string;
  /**
   * Where the schema was read from.
   *
   * `dataspace` is the document the provider actually published, and is
   * preferred; `local` is the copy bundled in `metadata/DCAT/`, which can drift
   * from it; `remote` is the URL a dataset's own `dcatSchemaRef` points at.
   */
  source: 'dataspace' | 'local' | 'remote';
  variables: DcatVariable[];
  names: Set<string>;
}

/**
 * Reads the DCAT document a provider published for a type, or null when there is
 * none, it cannot be fetched, or the connector refuses it.
 *
 * A function rather than a dependency so this module keeps doing arithmetic on
 * JSON and nothing else: the connector, the asset table and the memoization of
 * fetched documents all stay in `DcatCatalog`.
 */
export type SpaceDcatLoader = (
  datasetType: DatasetType,
) => Promise<{ id: string; raw: unknown } | null>;

const schemaCache = new Map<string, DcatSchema | null>();

function parseAttrs(description: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const part of description.split(';')) {
    const [k, ...rest] = part.split('=');
    if (!k || !rest.length) continue;
    attrs[k.trim()] = rest.join('=').trim();
  }
  return attrs;
}

function textOf(v: unknown): string {
  if (typeof v === 'string') return v;
  if (
    v &&
    typeof v === 'object' &&
    '@value' in (v as Record<string, unknown>)
  ) {
    const inner = (v as Record<string, unknown>)['@value'];
    return typeof inner === 'string' ? inner : '';
  }
  return '';
}

function buildSchema(
  raw: unknown,
  id: string,
  source: DcatSchema['source'],
): DcatSchema | null {
  const measured = (raw as { 'schema:variableMeasured'?: unknown })?.[
    'schema:variableMeasured'
  ];
  if (!Array.isArray(measured)) return null;
  const variables: DcatVariable[] = [];
  for (const entry of measured) {
    const name = textOf((entry as Record<string, unknown>)?.['schema:name']);
    if (!name) continue;
    const description = textOf(
      (entry as Record<string, unknown>)?.['schema:description'],
    );
    variables.push({ name, description, attrs: parseAttrs(description) });
  }
  if (!variables.length) return null;
  return {
    id,
    source,
    variables,
    names: new Set(variables.map((v) => v.name)),
  };
}

/**
 * Loads the DCAT for a type.
 *
 * Order: the document published in the data space, then the bundled copy, then
 * the URL the dataset's own `dcatSchemaRef` names.
 *
 * The published document goes first because it is the one the provider is
 * actually offering — the bundled copy is a snapshot of it and can drift, and
 * for two of the eight types there is no bundled copy at all. The bundled copy
 * stays as the fallback rather than being deleted: fetching from the space is a
 * contract negotiation that can fail, and losing the column check because a
 * connector was slow would be a worse outcome than validating against a
 * slightly older schema.
 */
export async function loadDcat(
  datasetType: DatasetType,
  dcatSchemaRef?: string | null,
  space?: SpaceDcatLoader,
): Promise<DcatSchema | null> {
  // Only the local and remote answers are memoized here. A bundled file does not
  // change while the process runs, but what the space offers does: if the first
  // sync of a long-lived process ran while the connector was refusing, a cached
  // answer would make every later sync validate against the bundled copy for
  // ever. The space loader is expected to memoize for its own lifetime — one
  // sync run — which is the scope where re-fetching is waste rather than
  // staleness.
  const cacheKey = `${datasetType}|${dcatSchemaRef ?? ''}`;
  const memoizable = !space;
  if (memoizable && schemaCache.has(cacheKey)) {
    return schemaCache.get(cacheKey) ?? null;
  }

  let schema: DcatSchema | null = null;
  if (space) {
    try {
      const published = await space(datasetType);
      if (published) {
        schema = buildSchema(published.raw, published.id, 'dataspace');
      }
    } catch {
      // Never fatal: the bundled copy answers below. DcatCatalog logs why.
      schema = null;
    }
  }

  const localName = LOCAL_DCAT[datasetType];
  if (!schema && localName) {
    const path = join(process.cwd(), 'metadata', 'DCAT', localName);
    if (existsSync(path)) {
      try {
        schema = buildSchema(
          JSON.parse(readFileSync(path, 'utf8')),
          localName,
          'local',
        );
      } catch {
        schema = null;
      }
    }
  }

  if (!schema && dcatSchemaRef && /^https?:\/\//.test(dcatSchemaRef)) {
    try {
      const res = await fetch(dcatSchemaRef);
      if (res.ok)
        schema = buildSchema(await res.json(), dcatSchemaRef, 'remote');
    } catch {
      schema = null;
    }
  }

  if (memoizable) schemaCache.set(cacheKey, schema);
  return schema;
}

/** Test helper: drop the memoized schemas. */
export function __clearDcatCache(): void {
  schemaCache.clear();
}

/**
 * Raw column names present in a dataset block, whatever its shape.
 *
 * Pre-event windows nest their measurements one level down, under a `*_previa`
 * key. Their DCAT declares those inner variables, so the inner keys are part of
 * the column list; otherwise every declared variable would read as absent.
 */
export function rawColumnsOf(dataset: Record<string, unknown>): string[] {
  const columns = dataset['columns'];
  if (columns && typeof columns === 'object' && !Array.isArray(columns)) {
    return Object.keys(columns as Record<string, unknown>);
  }
  const records = dataset['records'];
  if (!Array.isArray(records)) return [];
  const names = new Set<string>();
  for (const record of records.slice(0, 50)) {
    if (!record || typeof record !== 'object') continue;
    for (const [key, value] of Object.entries(
      record as Record<string, unknown>,
    )) {
      names.add(key);
      if (!key.endsWith('_previa')) continue;
      const inner = (value as { records?: unknown })?.records;
      if (!Array.isArray(inner)) continue;
      for (const day of inner.slice(0, 10)) {
        if (day && typeof day === 'object') {
          for (const innerKey of Object.keys(day as Record<string, unknown>))
            names.add(innerKey);
        }
      }
    }
  }
  return Array.from(names);
}

/**
 * Comparable form of a column name, so that spellings the normalizer already
 * treats as one column do not surface as a schema mismatch.
 *
 * The bucket carries `Polypropylene`, `Polypropylene (%)` and `Polypropylene `
 * for the same measurement, and both `Biomass depth -5_-8 m` and
 * `Biomass depth -5.00_-8 m`. Declaring every variant in the DCAT would state
 * the same variable several times; collapsing them here keeps the published
 * schema single-valued and the warnings meaningful.
 */
/**
 * Keys that carry the structure of a pre-event window rather than a measurement:
 * the event it belongs to, where it happened, and the container of the daily
 * records. The DCAT of those types declares the daily variables, so these three
 * are not schema deviations.
 */
function isEnvelopeColumn(datasetType: DatasetType, name: string): boolean {
  if (
    datasetType !== 'atmosfera_previa_evento' &&
    datasetType !== 'oceanografia_previa_evento'
  ) {
    return false;
  }
  return (
    name === 'event_date' || name === 'location' || name.endsWith('_previa')
  );
}

function comparableColumn(datasetType: DatasetType, name: string): string {
  if (datasetType === 'recogidas_playa') return recogidasKey(name);
  if (datasetType === 'boya_biomasa_slx+')
    return biomassDepthField(name) ?? name.trim();
  return name.trim();
}

export interface DcatValidation {
  checked: boolean;
  schemaId: string | null;
  /** Which of the three sources answered. Null when no schema was found. */
  schemaSource: DcatSchema['source'] | null;
  unknownColumns: string[];
  missingColumns: string[];
  warnings: string[];
}

export async function validateAgainstDcat(opts: {
  datasetType: DatasetType;
  dataset: Record<string, unknown>;
  metadata: Record<string, unknown>;
  /** Reads the schema the provider published. Omitted, only local copies are used. */
  space?: SpaceDcatLoader;
}): Promise<DcatValidation> {
  const { datasetType, dataset, metadata } = opts;
  const warnings: string[] = [];
  const dcatSchemaRef =
    typeof metadata['dcatSchemaRef'] === 'string'
      ? metadata['dcatSchemaRef']
      : null;
  const schema = await loadDcat(datasetType, dcatSchemaRef, opts.space);

  if (!schema) {
    return {
      checked: false,
      schemaId: null,
      schemaSource: null,
      unknownColumns: [],
      missingColumns: [],
      warnings: [
        `no DCAT schema available for "${datasetType}"; column check skipped`,
      ],
    };
  }

  const columns = rawColumnsOf(dataset);
  const declaredSubset = Array.isArray(metadata['fieldsIncluded'])
    ? new Set(
        (metadata['fieldsIncluded'] as unknown[]).filter(
          (x): x is string => typeof x === 'string',
        ),
      )
    : null;

  const declaredComparable = new Set(
    schema.variables.map((v) => comparableColumn(datasetType, v.name)),
  );
  const presentComparable = new Set(
    columns.map((c) => comparableColumn(datasetType, c)),
  );

  const unknownColumns = columns.filter(
    (c) =>
      !isEnvelopeColumn(datasetType, c) &&
      !declaredComparable.has(comparableColumn(datasetType, c)),
  );
  const missingColumns = schema.variables
    .map((v) => v.name)
    .filter(
      (name) => !presentComparable.has(comparableColumn(datasetType, name)),
    )
    .filter((name) => (declaredSubset ? declaredSubset.has(name) : true));

  if (unknownColumns.length) {
    warnings.push(
      `columns not in the DCAT schema: ${unknownColumns.join(', ')}`,
    );
  }
  if (missingColumns.length) {
    warnings.push(
      `DCAT variables absent from the dataset: ${missingColumns.join(', ')}`,
    );
  }
  if (declaredSubset) {
    const outside = columns.filter(
      (c) => !declaredSubset.has(c) && schema.names.has(c),
    );
    if (outside.length) {
      warnings.push(
        `columns present but not declared in metadata.fieldsIncluded: ${outside.join(', ')}`,
      );
    }
  }

  return {
    checked: true,
    schemaId: schema.id,
    schemaSource: schema.source,
    unknownColumns,
    missingColumns,
    warnings,
  };
}

/** Units declared by the DCAT, keyed by variable name (`unit=` in the description). */
export function unitsFromDcat(
  schema: DcatSchema | null,
): Record<string, string> {
  if (!schema) return {};
  const units: Record<string, string> = {};
  for (const v of schema.variables) {
    if (v.attrs.unit) units[v.name] = v.attrs.unit;
  }
  return units;
}
