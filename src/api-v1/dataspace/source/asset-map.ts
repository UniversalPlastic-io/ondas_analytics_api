import {
  CATEGORY_BY_TYPE,
  DATASET_TYPES,
  DATASET_TYPE_ALIASES,
  DatasetType,
  Ocean,
  REFERENCE_PROVIDER_FOLDER,
  STATIONS,
  canonicalDatasetType,
} from '../dataspace.constants';
import { REFERENCE_OCEAN } from '../reference-datasets';
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

export interface NonDataAsset {
  /** The name it had when the entry was written, to make drift visible. */
  name: string;
  /** The dataset type this document is the DCAT schema of, when it is one. */
  dcatFor: DatasetType | null;
}

/**
 * Asset id of the DCAT schema for each dataset type, derived from the table.
 *
 * Derived rather than a second table so the two cannot disagree. When more than
 * one provider publishes a DCAT for the same type the first in table order wins:
 * the document describes the type, not the provider, so any of them answers the
 * same question — but the choice has to be the same on every run.
 */
export function dcatIndexOf(
  table: Record<string, NonDataAsset>,
): Partial<Record<DatasetType, string>> {
  const out: Partial<Record<DatasetType, string>> = {};
  for (const [id, entry] of Object.entries(table)) {
    if (entry.dcatFor && !out[entry.dcatFor]) out[entry.dcatFor] = id;
  }
  return out;
}

export function dcatAssetIdsByType(): Partial<Record<DatasetType, string>> {
  return dcatIndexOf(NON_DATA_ASSETS);
}

/** Datasets, by asset id. Regenerate with `npm run assets:refresh -- --write`. */
export const ASSET_MAP: Record<string, MappedAsset> = {
  // ---- bcss
  '9c4e7965-4d14-4118-99d3-309126bd0bc7': {
    datasetType: 'muestras_de_peces_py_gcms',
    ocean: 'mediterraneo',
    place: 'badalona',
    providerFolder: 'bcss',
    name: 'Muestras de peces Badalona_v1.1',
  },
  'a3a71799-312f-43dd-8216-10977dfc006d': {
    datasetType: 'muestras_de_peces_py_gcms',
    ocean: 'catambrico',
    place: 'gijon',
    providerFolder: 'bcss',
    name: 'Muestras de peces Gijón_v1.1',
  },
  '3899d574-db64-42de-a58f-4a282a487b95': {
    datasetType: 'muestras_de_peces_py_gcms',
    ocean: 'atlantico',
    place: 'tenerife',
    providerFolder: 'bcss',
    name: 'Muestras de peces Tenerife_v1.1',
  },

  // ---- gijon_surf_hostel
  '61dbcb02-3b44-410f-a26b-5a8f52d69f14': {
    datasetType: 'muestras_de_agua_py_gcms',
    ocean: 'catambrico',
    place: 'gijon',
    providerFolder: 'gijon_surf_hostel',
    name: 'Muestras agua Gijón_v1.1',
  },
  '7fe0e5fb-c19b-4e6f-b414-8d05e26b661b': {
    datasetType: 'recogidas_playa',
    ocean: 'catambrico',
    place: 'gijon',
    providerFolder: 'gijon_surf_hostel',
    name: 'Recogidas playas Gijón_v1.1',
  },

  // ---- innoceana
  'b91d0d36-d8db-4427-9b04-36a1f7a367e2': {
    datasetType: 'recogidas_playa',
    ocean: 'mediterraneo',
    place: 'barcelona',
    providerFolder: 'innoceana',
    name: 'Recogidas playas Barcelona_v1.1',
  },
  'f2aec864-8a58-42d9-9231-19cad86968fc': {
    datasetType: 'recogidas_playa',
    ocean: 'atlantico',
    place: 'tenerife',
    providerFolder: 'innoceana',
    name: 'Recogidas playas Tenerife_v1.1 ',
  },

  // ---- port_badalona
  '8e1dd22c-f922-4a0a-b31d-3c00ad060cf0': {
    datasetType: 'boya_biomasa_slx+',
    ocean: 'mediterraneo',
    place: 'badalona',
    providerFolder: 'port_badalona',
    name: 'Boya biomasa Badalona_v1.1',
  },
  '16bd8652-058f-4198-adf8-31dc86ff5527': {
    datasetType: 'boya_microplasticos_seabot',
    ocean: 'mediterraneo',
    place: 'badalona',
    providerFolder: 'port_badalona',
    name: 'Boya microplásticos Badalona_v1.1',
  },

  // ---- universal_plastic
  'ec760bbd-d719-4389-ac93-1413cc7a160a': {
    datasetType: 'atmosfera_previa_evento',
    ocean: 'mediterraneo',
    place: 'badalona',
    providerFolder: 'universal_plastic',
    name: 'Atmósfera Badalona_v1.1',
  },
  'ec33f3e1-70d2-4992-9442-796eeee58e89': {
    datasetType: 'atmosfera_previa_evento',
    ocean: 'mediterraneo',
    place: 'barcelona',
    providerFolder: 'universal_plastic',
    name: 'Atmósfera Barcelona_v1.1',
  },
  'ecd40fc6-158c-4839-b7d8-173e03a41563': {
    datasetType: 'atmosfera_previa_evento',
    ocean: 'mediterraneo',
    place: 'blanes',
    providerFolder: 'universal_plastic',
    name: 'Atmósfera Blanes_v1.1',
  },
  '584ff479-aa7b-4645-a841-eb7ff50895ea': {
    datasetType: 'atmosfera_previa_evento',
    ocean: 'catambrico',
    place: 'gijon',
    providerFolder: 'universal_plastic',
    name: 'Atmósfera Gijón_v1.1',
  },
  'd84307ea-31fb-4862-8648-930cd9011ab6': {
    datasetType: 'atmosfera_previa_evento',
    ocean: 'atlantico',
    place: 'tenerife',
    providerFolder: 'universal_plastic',
    name: ' Atmósfera Tenerife_v1.1',
  },
  'fa52faf0-8c2e-4797-81a3-5b2166d48253': {
    datasetType: 'boya_biomasa_slx+',
    ocean: 'atlantico',
    place: 'cadiz',
    providerFolder: 'universal_plastic',
    name: 'Boya biomasa Cadiz_v1.1',
  },
  'c8ef3fe3-c966-4e63-a003-f3615ad94c71': {
    datasetType: 'boya_biomasa_slx+',
    ocean: 'catambrico',
    place: 'gijon',
    providerFolder: 'universal_plastic',
    name: 'Boya biomasa Gijón_v1.1',
  },
  '42201660-011d-44c1-9c3d-8114fbf55f39': {
    datasetType: 'boya_microplasticos_seabot',
    ocean: 'atlantico',
    place: 'cadiz',
    providerFolder: 'universal_plastic',
    name: 'Boya microplásticos  Cádiz_v1.1',
  },
  '1ae34dab-5dd9-4c5f-8910-fed007781df0': {
    datasetType: 'boya_microplasticos_seabot',
    ocean: 'catambrico',
    place: 'gijon',
    providerFolder: 'universal_plastic',
    name: 'Boya microplásticos Gijón_v.1.1',
  },
  '1bb20528-06a4-4c15-afee-547279f6870e': {
    datasetType: 'environmental_boya',
    ocean: 'mediterraneo',
    place: 'badalona',
    providerFolder: 'universal_plastic',
    name: 'Contexto ambiental para boya de biomasa Badalona_V1.1',
  },
  '019ee791-f585-46c6-a21b-72e6d35957b4': {
    datasetType: 'environmental_boya',
    ocean: 'atlantico',
    place: 'cadiz',
    providerFolder: 'universal_plastic',
    name: 'Contexto ambiental para boya de biomasa Cádiz_v1.1',
  },
  '3d8d2868-87e0-45da-a526-6362fcc20a99': {
    datasetType: 'environmental_boya',
    ocean: 'catambrico',
    place: 'gijon',
    providerFolder: 'universal_plastic',
    name: 'Contexto ambiental para boya de biomasa Gijón_v1.1',
  },
  'ae3fad45-6a7a-475d-a283-9eadaa0cf8cb': {
    datasetType: 'muestras_de_agua_py_gcms',
    ocean: 'mediterraneo',
    place: 'badalona',
    providerFolder: 'universal_plastic',
    name: 'Muestras agua Badalona_v1.1',
  },
  '22748ef0-9b87-4aa6-9352-77a445c4d129': {
    datasetType: 'muestras_de_agua_py_gcms',
    ocean: 'atlantico',
    place: 'tenerife',
    providerFolder: 'universal_plastic',
    name: 'Muestras agua Tenerife_v1.1',
  },
  'da6a3168-acf3-4c36-a0a3-be806658ddf7': {
    datasetType: 'oceanografia_previa_evento',
    ocean: 'mediterraneo',
    place: 'badalona',
    providerFolder: 'universal_plastic',
    name: 'Oceanografía Badalona_v1.1',
  },
  '36346baf-a6aa-451e-a464-f8cc7b3e6458': {
    datasetType: 'oceanografia_previa_evento',
    ocean: 'mediterraneo',
    place: 'barcelona',
    providerFolder: 'universal_plastic',
    name: 'Oceanografía Barcelona_v1.1',
  },
  '0ba413bc-a382-4b64-901c-b1409680d276': {
    datasetType: 'oceanografia_previa_evento',
    ocean: 'mediterraneo',
    place: 'blanes',
    providerFolder: 'universal_plastic',
    name: 'Oceanografía Blanes_v1.1',
  },
  'bc8910ff-face-45be-8e76-540fddeb1a45': {
    datasetType: 'oceanografia_previa_evento',
    ocean: 'catambrico',
    place: 'gijon',
    providerFolder: 'universal_plastic',
    name: 'Oceanografía Gijón_v1.1',
  },
  'bd458468-ba6f-46ea-88b1-6a61ce7d187b': {
    datasetType: 'oceanografia_previa_evento',
    ocean: 'atlantico',
    place: 'tenerife',
    providerFolder: 'universal_plastic',
    name: 'Oceanografía Tenerife_v1.1',
  },
  '4ea47a2b-f881-450e-b462-e3d61308af61': {
    datasetType: 'recogidas_playa',
    ocean: 'mediterraneo',
    place: 'badalona',
    providerFolder: 'universal_plastic',
    name: 'Recogidas playas Badalona_v1.1',
  },
  '0aee0640-546a-436d-8dd8-23f02a9b3823': {
    datasetType: 'recogidas_playa',
    ocean: 'mediterraneo',
    place: 'blanes',
    providerFolder: 'universal_plastic',
    name: 'Recogidas playas Blanes_v1.1',
  },
};

/**
 * Schema and metadata assets. They are published in the same catalogs as the
 * datasets and are not data: ingesting them would create assets with no
 * observations and no location.
 *
 * They are not merely skipped, though. Each provider publishes one DCAT document
 * per dataset, and that document is the schema the dataset is validated against
 * — until now read from the bundled copies in `metadata/DCAT/`, which can drift
 * from what the provider actually published and which do not exist at all for
 * `atmosfera_previa_evento` and `oceanografia_previa_evento`. So the table
 * records **which type each one describes**, and the validator prefers the
 * published document over the bundled one.
 *
 * `dcatFor` is null for a metadata document that is not a per-type DCAT: still
 * skipped, but nothing claims to know what it validates.
 */
export const NON_DATA_ASSETS: Record<string, NonDataAsset> = {};

/**
 * The calibration series, by asset id. Regenerate with
 * `npm run assets:refresh -- --write`.
 *
 * They are not measurements of anywhere: one file per category, generated by
 * `reference-datasets.ts` and published by UP so the engine has something to
 * fall back on when a request lands where no participant has published. So they
 * carry no place and no station, and their coordinates are open water in the
 * Balearic Sea, far from every station.
 *
 * Kept apart from ASSET_MAP for one reason above the rest: UP publishes them, so
 * classifying them by their participant would give them `universal_plastic` and
 * land them in the **observed** tier — a synthetic series in the middle of the
 * sea would then reach the map, the dashboard KPIs, the reports and the basin
 * that archives every analysis. Forcing `ondas_reference` here is what keeps
 * them out, since the tier is derived from the provider folder.
 */
export const REFERENCE_ASSETS: Record<string, DatasetType> = {
  'e22252f6-8099-4714-8666-fbc541818a3a': 'boya_biomasa_slx+', // Boya_biomasa_referencia
  'c1c71785-6da1-4d8f-a796-df566b8e4f9d': 'boya_microplasticos_seabot', // Boya_microplasticos_referencia.
  '85add085-d1fb-4774-b8c6-d2de5bea3c1f': 'environmental_boya', // Environmental_referencia
  'a69dc135-4dbc-4285-bb71-5fad09793ccf': 'muestras_de_agua_py_gcms', // muestras_de_agua_referencia
  'fdd003f7-0ff5-402f-ba01-e7712f36f985': 'recogidas_playa', // Recogidas_playas_referencia
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

/**
 * Version suffixes providers append when they republish an asset.
 *
 * Seen in the wild as `_v1.1`, `_v.1.1` and ` v1.1` on the same upload round, so
 * the shape is matched loosely rather than exactly. The version is not part of
 * what an asset *is*: "Boya microplásticos Cádiz_v1.1" is the same measurement
 * series as "Boya microplásticos Cádiz", republished.
 */
const VERSION_SUFFIX = /[\s_-]*v\.?\s*\d+(?:[._]\d+)*\s*$/i;

/**
 * The version an asset's name declares, as comparable numbers.
 *
 * `[]` when the name carries no suffix, which sorts below every version: an
 * asset republished as `_v1.1` supersedes the one published without a suffix.
 */
export function versionOf(name: string): number[] {
  const match = VERSION_SUFFIX.exec(name.trim());
  if (!match) return [];
  return (match[0].match(/\d+/g) ?? []).map(Number);
}

/** Compares two version lists. Positive when `a` is the later one. */
export function compareVersions(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Lowercased, accent-stripped, whitespace-collapsed, version-stripped. */
export function fold(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(VERSION_SUFFIX, '')
    .trim();
}

/**
 * Names that mark an asset as a schema or metadata document rather than data.
 *
 * Matched anywhere in the name, not only as a prefix. The providers publish one
 * DCAT document per dataset, and the two rounds seen so far named them by prefix
 * (`esquema_datos_…`, `metadatos_…`) — but a suffix form like
 * "Boya biomasa Gijón_metadatos" would otherwise match the biomass type hint and
 * be classified as a biomass dataset at Gijón. Container validation would still
 * reject it, since a DCAT document has no `dataset` block, but as a *failed*
 * asset that turns the whole sync run `partial` rather than as one cleanly
 * skipped.
 *
 * Separators are alternatives to a word boundary because `\b` does not fire
 * between an underscore and a letter.
 */
const NON_DATA_NAME =
  /(^|[\s_-])(esquemas?([\s_-]de)?([\s_-]datos?)?|metadatos?|dcat|json-?ld)([\s_-]|$)/i;

/** True for a schema or metadata document, by its published name. */
export function isNonDataName(label: string): boolean {
  return NON_DATA_NAME.test(fold(label));
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

/** Separator runs collapsed to one underscore, so substrings match either style. */
function slug(name: string): string {
  return fold(name).replace(/[\s_-]+/g, '_');
}

/**
 * Every spelling of a dataset type id, longest first.
 *
 * Longest first because the ids overlap: a document naming
 * `muestras_de_agua_py_gcms` also contains nothing of `muestras_de_peces_py_gcms`,
 * but a shorter id that is a prefix of a longer one would otherwise win.
 */
const TYPE_ID_SLUGS: Array<[string, DatasetType]> = [
  ...DATASET_TYPES.map((t) => [slug(t), t] as [string, DatasetType]),
  ...Object.entries(DATASET_TYPE_ALIASES).map(
    ([alias, t]) => [slug(alias), t] as [string, DatasetType],
  ),
].sort((a, b) => b[0].length - a[0].length);

/** The marker words themselves, so the type hints can read what is left. */
const NON_DATA_WORDS =
  /(esquemas?([\s_-]de)?([\s_-]datos?)?|metadatos?|dcat|json-?ld)/gi;

/**
 * Which dataset type a published schema document describes, from its name.
 *
 * Only ever consulted for a name that is already a schema or metadata document,
 * so a dataset can never be mistaken for its own schema.
 *
 * Two rounds of names have been seen. The providers' own convention states the
 * type id (`esquema_datos_recogidas_playa`), which is matched directly. A name
 * that instead states the dataset (`metadatos Boya biomasa Gijón`) needs the
 * marker removed first, because the type hints are anchored at the start of the
 * name.
 *
 * Used to *suggest* an entry for `NON_DATA_ASSETS`, never to classify on its
 * own: as everywhere else in this file, a name is not a contract.
 */
export function dcatTypeFromName(label: string): DatasetType | null {
  if (!isNonDataName(label)) return null;
  const asSlug = slug(label);
  const byId = TYPE_ID_SLUGS.find(([id]) => asSlug.includes(id));
  if (byId) return byId[1];
  const stripped = fold(label)
    .replace(NON_DATA_WORDS, ' ')
    .replace(/[\s_-]+/g, ' ')
    .trim();
  return suggestMapping(stripped).datasetType;
}

export interface ClassificationResult {
  classified: ClassifiedAsset | null;
  /** Why the asset was skipped, inferred, or refused. */
  warning: string | null;
  /** True when the classification came from the name, not the table. */
  inferred: boolean;
  /** True for schema and metadata assets, which are skipped without complaint. */
  skipped: boolean;
}

/** Participant display name → the provider folder the organizations are keyed by. */
const PROVIDER_FOLDERS: Record<string, string> = {
  'universal plastic': 'universal_plastic',
  innoceana: 'innoceana',
  bcss: 'bcss',
  'port badalona': 'port_badalona',
  'gijon surf hostel': 'gijon_surf_hostel',
};

export function providerFolderFor(providerName: string): string {
  const folded = fold(providerName);
  return PROVIDER_FOLDERS[folded] ?? folded.replace(/\s+/g, '_');
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

  if (NON_DATA_ASSETS[id] || isNonDataName(entry.ref.label)) {
    return { classified: null, warning: null, inferred: false, skipped: true };
  }

  const reference = REFERENCE_ASSETS[id];
  if (reference) {
    return {
      classified: {
        ocean: REFERENCE_OCEAN,
        providerFolder: REFERENCE_PROVIDER_FOLDER,
        fragment: entry.ref.label,
        place: null,
        station: null,
        datasetType: reference,
        category: CATEGORY_BY_TYPE[reference],
      },
      warning: null,
      inferred: false,
      skipped: false,
    };
  }

  const mapped = ASSET_MAP[id];
  if (!mapped) {
    // Providers republish assets under new ids — a data loss incident on the
    // platform had every dataset re-uploaded as `_v1.1` — so refusing anything
    // absent from the table would empty the read model on every such round.
    // Classifying from the name and saying so loudly loses less than skipping,
    // and the warning names the asset so the table can be refreshed.
    const hint = suggestMapping(entry.ref.label);
    if (hint.datasetType && hint.place) {
      const station = STATIONS[hint.place];
      const datasetType = canonicalDatasetType(hint.datasetType);
      return {
        classified: {
          ocean: station.ocean,
          providerFolder: providerFolderFor(entry.provider),
          fragment: entry.ref.label,
          place: hint.place,
          station,
          datasetType,
          category: datasetType ? CATEGORY_BY_TYPE[datasetType] : null,
        },
        warning:
          `${entry.provider} offers "${entry.ref.label}" (${id}), which is not in ASSET_MAP. ` +
          `It was classified from its name as ${hint.datasetType} at ${hint.place}. ` +
          `Run \`npm run assets:refresh\` to review and record it.`,
        inferred: true,
        skipped: false,
      };
    }
    return {
      classified: null,
      warning:
        `${entry.provider} offers an asset this API does not know: "${entry.ref.label}" (${id}), ` +
        `and its name gives no reliable hint. Identify it and add it to ASSET_MAP.`,
      inferred: false,
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
    inferred: false,
    skipped: false,
  };
}
