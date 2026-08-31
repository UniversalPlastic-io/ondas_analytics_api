/**
 * Canonical vocabulary of the ONDAs data space.
 *
 * The dataset type ids are the ones the live files carry in `metadata.datasetType`
 * (see docs/dataset-mapping.md). The ids used by the participant-facing spec
 * (docs/dataspace-assets copy.md) are accepted as aliases so a file uploaded to
 * either convention ingests without a code change.
 */

export const DATASET_TYPES = [
  'recogidas_playa',
  'boya_biomasa_slx+',
  'boya_microplasticos_seabot',
  'environmental_boya',
  'atmosfera_previa_evento',
  'oceanografia_previa_evento',
  'muestras_de_agua_py_gcms',
  'muestras_de_peces_py_gcms',
] as const;

export type DatasetType = (typeof DATASET_TYPES)[number];

/** Spec-side ids (dataspace-assets) → live ids. */
export const DATASET_TYPE_ALIASES: Record<string, DatasetType> = {
  recogidas_plastico_app_up_v700: 'recogidas_playa',
  meteorología_cdse_vl: 'environmental_boya',
  meteorologia_cdse_vl: 'environmental_boya',
};

export function canonicalDatasetType(raw: unknown): DatasetType | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if ((DATASET_TYPES as readonly string[]).includes(s)) return s as DatasetType;
  return DATASET_TYPE_ALIASES[s] ?? null;
}

export const CATEGORIES = [
  'cleanup',
  'biomass',
  'microplastics',
  'environmental',
  'atmospheric',
  'oceanographic',
  'water_samples',
  'fish_samples',
] as const;

export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_BY_TYPE: Record<DatasetType, Category> = {
  recogidas_playa: 'cleanup',
  'boya_biomasa_slx+': 'biomass',
  boya_microplasticos_seabot: 'microplastics',
  environmental_boya: 'environmental',
  atmosfera_previa_evento: 'atmospheric',
  oceanografia_previa_evento: 'oceanographic',
  muestras_de_agua_py_gcms: 'water_samples',
  muestras_de_peces_py_gcms: 'fish_samples',
};

/**
 * Polymer columns of `muestras_de_agua_py_gcms`, in the order the DCAT schema
 * declares them (metadata/DCAT/muestras_de_agua_py_gcms.jsonld). Values are mass
 * concentrations in μg L⁻¹.
 *
 * These files go through the generic row normalizer, which keeps the raw column
 * name as the canonical field, so `field` is what an observation's `values` holds
 * and `code` is the short polymer code the analytics engine compares against the
 * microplastics buoy.
 */
export const WATER_POLYMER_FIELDS: Array<{ field: string; code: string }> = [
  { field: 'Polyethylene', code: 'PE' },
  { field: 'Polypropylene', code: 'PP' },
  { field: 'Polystyrene', code: 'PS' },
  { field: 'Polyvinyl chloride', code: 'PVC' },
  { field: 'Polyethylene terephthalate', code: 'PET' },
  { field: 'Polyamide', code: 'PA' },
  { field: 'Polycarbonate', code: 'PC' },
  { field: 'Polyurethane', code: 'PU' },
  { field: 'Poly(methyl methacrylate)', code: 'PMMA' },
  { field: 'Acrylonitrile-butadiene-styrene', code: 'ABS' },
  { field: 'Polyvinyl acetate', code: 'PVAc' },
  { field: 'Polyvinyl alcohol', code: 'PVA' },
];

/** Marker label + colour per category, as `GET /v1/map/points` serves them. */
export const CATEGORY_META: Record<Category, { label: string; color: string }> =
  {
    cleanup: { label: 'Coastal cleanup', color: '#00003F' },
    biomass: { label: 'Fish biomass buoy', color: '#16a34a' },
    microplastics: { label: 'Microplastics buoy', color: '#42C3EE' },
    environmental: { label: 'Met-ocean buoy', color: '#4055F6' },
    atmospheric: { label: 'Atmospheric (pre-event)', color: '#B8BBC9' },
    oceanographic: { label: 'Oceanographic (pre-event)', color: '#2F8AA9' },
    water_samples: { label: 'Water samples', color: '#39B3D8' },
    fish_samples: { label: 'Fish samples', color: '#1C5264' },
  };

export const OCEANS = ['mediterraneo', 'atlantico', 'catambrico'] as const;
export type Ocean = (typeof OCEANS)[number];

/**
 * The publisher label the reference datasets carry.
 *
 * They are calibration series, not observations of a site, so every read that
 * answers "what was measured" excludes them. The exclusion is done on the stored
 * `tier` field; this constant only labels who publishes them.
 */
export const REFERENCE_PROVIDER_FOLDER = 'ondas_reference';

/**
 * Organization the reference datasets are published under. The folder above is
 * what marks the tier; this is only who owns the files, and it has to match an
 * organization's slug or dataProviderIds or the ingest cannot attach them to
 * one. Because the tier marker lives in the key, the two are independent.
 */
export const REFERENCE_PUBLISHER = 'universal_plastic';

/**
 * The tier an asset belongs to, decided once at ingest and then stored.
 *
 * Callers must not re-derive it. Every read that answers "what was measured"
 * filters on the stored `tier` field; deriving it from the key again would
 * reintroduce the coupling this exists to remove.
 */
export function tierForProviderFolder(
  providerFolder: string | null | undefined,
): 'observed' | 'reference' {
  return providerFolder === REFERENCE_PROVIDER_FOLDER
    ? 'reference'
    : 'observed';
}

export interface Station {
  slug: string;
  name: string;
  city: string;
  lat: number;
  lon: number;
  ocean: Ocean;
}

/**
 * Reference coordinates per place. Used as the fallback when a file's
 * `metadata.location` is missing, zeroed, or implausible — several live files
 * carry coordinates hundreds of km from the site they describe.
 */
export const STATIONS: Record<string, Station> = {
  badalona: {
    slug: 'badalona',
    name: 'Badalona',
    city: 'Badalona',
    lat: 41.4342,
    lon: 2.2433,
    ocean: 'mediterraneo',
  },
  barcelona: {
    slug: 'barcelona',
    name: 'Barcelona',
    city: 'Barcelona',
    lat: 41.6702,
    lon: 2.7895,
    ocean: 'mediterraneo',
  },
  blanes: {
    slug: 'blanes',
    name: 'Blanes',
    city: 'Costa Brava',
    lat: 41.676,
    lon: 2.795,
    ocean: 'mediterraneo',
  },
  tenerife: {
    slug: 'tenerife',
    name: 'Tenerife',
    city: 'Canary Islands',
    lat: 28.1876,
    lon: -16.6596,
    ocean: 'atlantico',
  },
  cadiz: {
    slug: 'cadiz',
    name: 'Cádiz',
    city: 'Cádiz',
    lat: 36.53,
    lon: -6.29,
    ocean: 'atlantico',
  },
  gijon: {
    slug: 'gijon',
    name: 'Gijón',
    city: 'Asturias',
    lat: 43.5721,
    lon: -5.7212,
    ocean: 'catambrico',
  },
};

/** Connector settings. The password is read from the environment and never logged. */
export const DSPACER_BASE_URL = process.env.DSPACER_BASE_URL ?? '';
export const DSPACER_LOGIN_URL = process.env.DSPACER_LOGIN_URL ?? '';
export const DSPACER_USER = process.env.DSPACER_USER ?? '';
export const DSPACER_PASSWORD = process.env.DSPACER_PASSWORD ?? '';

/** True when enough is configured to talk to the connector. */
export function dspacerConfigured(): boolean {
  return !!(DSPACER_BASE_URL && DSPACER_LOGIN_URL && DSPACER_USER && DSPACER_PASSWORD);
}
