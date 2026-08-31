import {
  CATEGORY_BY_TYPE,
  DatasetType,
  Ocean,
  STATIONS,
  canonicalDatasetType,
} from '../dataspace.constants';
import { ClassifiedAsset, SourceEntry } from './dataspace-source';

/**
 * What each asset in the data space is.
 *
 * When assets came from an object store, this was derived from the path:
 * `public/{ocean}/{provider}/{file}.json` told you the ocean, the publisher and,
 * through the filename, the dataset type. A data space asset has none of that —
 * only a UUID, a name a provider chose, and a free-text description.
 *
 * So the mapping is an explicit table rather than a parse of the name:
 *
 * - The UUID is stable and ours to rely on. The name is not: a provider may
 *   rename an asset at any time, and several already carry stray whitespace or
 *   inconsistent separators ("muestras_peces_gijon" beside "Recogidas playas
 *   Gijón"). Nothing about a name is a contract.
 * - A misclassification is silent and corrupts indicators. A table makes every
 *   decision reviewable in one place, and a diff shows exactly what changed.
 * - An asset that is not in the table is reported, not guessed at. Discovering
 *   that a provider published something new is useful; quietly inventing a type
 *   for it is not.
 *
 * The heuristic below exists only to *suggest* an entry for a new asset in the
 * sync warnings. It never classifies on its own.
 */

export interface MappedAsset {
  datasetType: DatasetType;
  ocean: Ocean;
  place: string;
  providerFolder: string;
  /** The name the asset had when the entry was written, to make drift visible. */
  name: string;
}

/** Datasets, by asset id. Generated from the live catalogs on 31/08/2026. */
export const ASSET_MAP: Record<string, MappedAsset> = {
  // ---- bcss
  'ede82a3c-2859-47e7-a586-45dff1de2897': {
    datasetType: 'muestras_de_peces_py_gcms',
    ocean: 'mediterraneo',
    place: 'badalona',
    providerFolder: 'bcss',
    name: 'muestras_peces_badalona',
  },
  '6c72fc6a-e233-49e0-8fdb-940c3e6ded21': {
    datasetType: 'muestras_de_peces_py_gcms',
    ocean: 'catambrico',
    place: 'gijon',
    providerFolder: 'bcss',
    name: 'muestras_peces_gijon',
  },
  '3735082f-9ed1-4c07-b96f-518b92234bb0': {
    datasetType: 'muestras_de_peces_py_gcms',
    ocean: 'atlantico',
    place: 'tenerife',
    providerFolder: 'bcss',
    name: 'muestras_peces_tenerife',
  },

  // ---- gijon_surf_hostel
  '7307dff0-10ee-42e2-875b-573031d3833a': {
    datasetType: 'muestras_de_agua_py_gcms',
    ocean: 'catambrico',
    place: 'gijon',
    providerFolder: 'gijon_surf_hostel',
    name: 'muestras_agua_gijon',
  },
  '54c625fb-285c-40dd-be28-75c6806ddd71': {
    datasetType: 'recogidas_playa',
    ocean: 'catambrico',
    place: 'gijon',
    providerFolder: 'gijon_surf_hostel',
    name: 'Recogidas playas Gijón',
  },

  // ---- innoceana
  '0ac35a36-2493-4e0e-a695-229fc559921c': {
    datasetType: 'recogidas_playa',
    ocean: 'mediterraneo',
    place: 'barcelona',
    providerFolder: 'innoceana',
    name: 'Recogidas playas Barcelona ',
  },
  'ddadf21b-0c4d-40c8-97d7-e5cf902a5024': {
    datasetType: 'recogidas_playa',
    ocean: 'atlantico',
    place: 'tenerife',
    providerFolder: 'innoceana',
    name: 'Recogidas playas Tenerife',
  },

  // ---- port_badalona
  '77e49a38-4a28-4779-8021-0671c721f4fc': {
    datasetType: 'boya_biomasa_slx+',
    ocean: 'mediterraneo',
    place: 'badalona',
    providerFolder: 'port_badalona',
    name: 'Boya biomasa Badalona',
  },
  '40d5bbbb-bf2e-4a39-892a-82bd16c893fe': {
    datasetType: 'boya_microplasticos_seabot',
    ocean: 'mediterraneo',
    place: 'badalona',
    providerFolder: 'port_badalona',
    name: 'boya_microplasticos_badalona',
  },

  // ---- universal_plastic
  '32d3ac9f-cf45-4f4f-9e9a-376f49893ee6': {
    datasetType: 'atmosfera_previa_evento',
    ocean: 'mediterraneo',
    place: 'badalona',
    providerFolder: 'universal_plastic',
    name: 'Atmósfera Badalona',
  },
  '6941db2b-cd13-4bfc-9dc9-0590045db0ae': {
    datasetType: 'atmosfera_previa_evento',
    ocean: 'mediterraneo',
    place: 'barcelona',
    providerFolder: 'universal_plastic',
    name: ' Atmósfera Barcelona',
  },
  '373b9d3d-db52-4f86-95b4-d282c975d67c': {
    datasetType: 'atmosfera_previa_evento',
    ocean: 'mediterraneo',
    place: 'blanes',
    providerFolder: 'universal_plastic',
    name: 'Atmósfera Blanes ',
  },
  'fac91e13-a073-43fe-a507-dc70e3948447': {
    datasetType: 'atmosfera_previa_evento',
    ocean: 'catambrico',
    place: 'gijon',
    providerFolder: 'universal_plastic',
    name: 'Atmósfera Gijón',
  },
  '99776ab8-b80e-48d9-a267-1c7edda59b80': {
    datasetType: 'atmosfera_previa_evento',
    ocean: 'atlantico',
    place: 'tenerife',
    providerFolder: 'universal_plastic',
    name: 'Atmósfera Tenerife',
  },
  'e81d27e4-45c6-42a3-9755-dbd7ac494d05': {
    datasetType: 'boya_biomasa_slx+',
    ocean: 'atlantico',
    place: 'cadiz',
    providerFolder: 'universal_plastic',
    name: 'Boya biomasa Cádiz',
  },
  '71034599-0830-44a8-a4bd-5f7aea885536': {
    datasetType: 'boya_biomasa_slx+',
    ocean: 'catambrico',
    place: 'gijon',
    providerFolder: 'universal_plastic',
    name: 'Boya biomasa Gijón',
  },
  '7f99ffc6-5672-4b51-b89f-f1a0b696555c': {
    datasetType: 'boya_microplasticos_seabot',
    ocean: 'atlantico',
    place: 'cadiz',
    providerFolder: 'universal_plastic',
    name: 'Boya microplásticos Cádiz',
  },
  '0209f661-cb47-41d3-8b48-6a880f0d0e4b': {
    datasetType: 'boya_microplasticos_seabot',
    ocean: 'catambrico',
    place: 'gijon',
    providerFolder: 'universal_plastic',
    name: 'Boya microplásticos Gijón',
  },
  '8e0b990d-87d1-4f15-8fcb-f0b13e0b4aa1': {
    datasetType: 'environmental_boya',
    ocean: 'mediterraneo',
    place: 'badalona',
    providerFolder: 'universal_plastic',
    name: 'Contexto ambiental para boya de biomasa Badalona',
  },
  '16e1307c-f9a9-4c2d-8468-2c6cd5dcba7e': {
    datasetType: 'environmental_boya',
    ocean: 'atlantico',
    place: 'cadiz',
    providerFolder: 'universal_plastic',
    name: 'Contexto ambiental para boya de biomasa Cádiz',
  },
  '14b565a1-b566-49b5-a2cc-9e561f9d8cb3': {
    datasetType: 'environmental_boya',
    ocean: 'catambrico',
    place: 'gijon',
    providerFolder: 'universal_plastic',
    name: 'Contexto ambiental para boya de biomasa Gijón',
  },
  '0ff24a0e-0f1d-4377-aebd-f5e9e7c0c8b3': {
    datasetType: 'oceanografia_previa_evento',
    ocean: 'mediterraneo',
    place: 'badalona',
    providerFolder: 'universal_plastic',
    name: 'Oceanografía Badalona',
  },
  '31f505fb-c5af-48e0-9cfb-1e596bd991dd': {
    datasetType: 'oceanografia_previa_evento',
    ocean: 'mediterraneo',
    place: 'barcelona',
    providerFolder: 'universal_plastic',
    name: 'Oceanografía Barcelona',
  },
  '4e05c0dd-9674-4c9e-8806-839587d70f7d': {
    datasetType: 'oceanografia_previa_evento',
    ocean: 'mediterraneo',
    place: 'blanes',
    providerFolder: 'universal_plastic',
    name: 'Oceanografía Blanes',
  },
  '781bb53a-23e0-45a3-919f-bbd4fa50e242': {
    datasetType: 'oceanografia_previa_evento',
    ocean: 'catambrico',
    place: 'gijon',
    providerFolder: 'universal_plastic',
    name: 'Oceanografía Gijón',
  },
  'a446938a-1478-446c-9ccd-c7fadad66749': {
    datasetType: 'oceanografia_previa_evento',
    ocean: 'atlantico',
    place: 'tenerife',
    providerFolder: 'universal_plastic',
    name: 'Oceanografía Tenerife',
  },
  'cca73b3a-398c-4913-b474-ec27d18e5523': {
    datasetType: 'recogidas_playa',
    ocean: 'mediterraneo',
    place: 'badalona',
    providerFolder: 'universal_plastic',
    name: 'Recogidas playas Badalona',
  },
  '949274e2-d829-43ba-9877-940cceed40f0': {
    datasetType: 'recogidas_playa',
    ocean: 'mediterraneo',
    place: 'blanes',
    providerFolder: 'universal_plastic',
    name: 'Recogidas playas Blanes',
  },
};

/**
 * Schema and metadata assets. They are published in the same catalogs as the
 * datasets and are not data: ingesting them would create assets with no
 * observations and no location.
 */
export const NON_DATA_ASSETS: Record<string, string> = {
  'c4d99e61-faf0-4fbe-b167-8b8a8443a3dc':
    'esquema_datos_boya_microplasticos_seabot_v1',
  'fbe3ecf6-6c6b-4337-970e-03cf1ad08995':
    'esquema_datos_muestras de peces_ py_gcms_v1',
  '4d0de6e2-8944-45a4-86c1-093eec1c3f71':
    'esquema_datos_muestras_agua_py_gcms_v1',
  'c958044a-893b-4f5e-b5af-66281a57835e':
    'esquema_datos_recogidas_plastico_app_up_v700_v1',
  'e1e523dd-7577-4174-b761-8bd58fbb4d37': 'metadatos_boya_biomasa_slx+',
};
/** Filename/name fragment → dataset type, for suggesting an entry only. */
const TYPE_HINTS: Array<[RegExp, DatasetType]> = [
  [/^recogidas[\s_]playas?[\s_]/i, 'recogidas_playa'],
  [/^boya[\s_]biomasa/i, 'boya_biomasa_slx+'],
  [/^boya[\s_]microplasticos/i, 'boya_microplasticos_seabot'],
  [
    /^(environmental|contexto[\s_]ambiental|meteorologia)/i,
    'environmental_boya',
  ],
  [/^atmosfera/i, 'atmosfera_previa_evento'],
  [/^oceanografia/i, 'oceanografia_previa_evento'],
  [/^muestras[\s_](de[\s_])?agua/i, 'muestras_de_agua_py_gcms'],
  [/^muestras[\s_](de[\s_])?peces/i, 'muestras_de_peces_py_gcms'],
];

/** Lowercased, accent-stripped, whitespace-collapsed. Provider names are untidy. */
function fold(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export interface Suggestion {
  datasetType: DatasetType | null;
  place: string | null;
}

/** A guess at what an unmapped asset is, for the operator reading the warning. */
export function suggestMapping(name: string): Suggestion {
  const folded = fold(name);
  const datasetType = TYPE_HINTS.find(([re]) => re.test(folded))?.[1] ?? null;
  const place =
    Object.keys(STATIONS).find((slug) => folded.includes(slug)) ?? null;
  return { datasetType, place };
}

export interface ClassificationResult {
  classified: ClassifiedAsset | null;
  /** Set when the asset was deliberately not classified, explaining why. */
  warning: string | null;
  /** True for schema and metadata assets, which are skipped without complaint. */
  skipped: boolean;
}

/**
 * Resolves one catalog entry against the table.
 *
 * Returns a warning rather than a guess for anything unmapped, and reports a
 * name that has drifted from the table so the entry can be reviewed before the
 * name stops being recognisable at all.
 */
export function classifyEntry(entry: SourceEntry): ClassificationResult {
  const id = entry.ref.id;

  if (NON_DATA_ASSETS[id]) {
    return { classified: null, warning: null, skipped: true };
  }

  const mapped = ASSET_MAP[id];
  if (!mapped) {
    const hint = suggestMapping(entry.ref.label);
    const guess =
      hint.datasetType && hint.place
        ? ` It looks like ${hint.datasetType} at ${hint.place}; add it to ASSET_MAP to ingest it.`
        : ' Its name gives no reliable hint; identify it before adding it to ASSET_MAP.';
    return {
      classified: null,
      warning: `${entry.provider} offers an asset this API does not know: "${entry.ref.label}" (${id}).${guess}`,
      skipped: false,
    };
  }

  const station = STATIONS[mapped.place] ?? null;
  const datasetType = canonicalDatasetType(mapped.datasetType);
  const drifted = fold(mapped.name) !== fold(entry.ref.label);

  return {
    classified: {
      ocean: mapped.ocean,
      providerFolder: mapped.providerFolder,
      // Kept for the corrections table and the summaries, which are keyed by it.
      fragment: mapped.name,
      place: mapped.place,
      station,
      datasetType,
      category: datasetType ? CATEGORY_BY_TYPE[datasetType] : null,
    },
    warning: drifted
      ? `asset ${id} is published as "${entry.ref.label}" but ASSET_MAP records "${mapped.name}"; ` +
        `the mapping still holds because it is keyed by id, but the entry should be refreshed`
      : null,
    skipped: false,
  };
}
