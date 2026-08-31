import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ASSET_MAP,
  NON_DATA_ASSETS,
  classifyEntry,
  suggestMapping,
} from './asset-map';
import {
  dataProviders,
  parseCatalog,
  parseParticipants,
} from './dspacer-catalog';
import {
  CATEGORY_BY_TYPE,
  DATASET_TYPES,
  OCEANS,
  STATIONS,
} from '../dataspace.constants';
import { SourceEntry } from './dataspace-source';

function fixture(name: string): any {
  return JSON.parse(
    readFileSync(join(__dirname, '__fixtures__', name), 'utf-8'),
  );
}

const providers = dataProviders(parseParticipants(fixture('bpn-all.json')));

function entriesFrom(file: string, providerName: string): SourceEntry[] {
  const provider = providers.find((p) => p.name === providerName)!;
  return parseCatalog(fixture(file), provider).entries;
}

describe('ASSET_MAP', () => {
  it('only ever names dataset types, oceans and places the system knows', () => {
    for (const [id, m] of Object.entries(ASSET_MAP)) {
      expect(DATASET_TYPES).toContain(m.datasetType);
      expect(OCEANS).toContain(m.ocean);
      expect(Object.keys(STATIONS)).toContain(m.place);
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it('places every asset in the ocean its station actually belongs to', () => {
    // A place/ocean mismatch would put a marker in the wrong basin and skew
    // every per-ocean aggregate, without failing anything.
    for (const m of Object.values(ASSET_MAP)) {
      expect(m.ocean).toBe(STATIONS[m.place].ocean);
    }
  });

  it('never maps the same id twice, nor maps a non-data asset', () => {
    const ids = Object.keys(ASSET_MAP);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(NON_DATA_ASSETS[id]).toBeUndefined();
  });

  it('covers every category the analytics engine reads', () => {
    const covered = new Set(
      Object.values(ASSET_MAP).map((m) => CATEGORY_BY_TYPE[m.datasetType]),
    );
    for (const category of [
      'cleanup',
      'biomass',
      'microplastics',
      'environmental',
      'atmospheric',
      'oceanographic',
      'water_samples',
      'fish_samples',
    ]) {
      expect(covered).toContain(category);
    }
  });
});

describe('classifyEntry against the live catalogs', () => {
  it('classifies every dataset offered by every provider', () => {
    const unresolved: string[] = [];
    let classified = 0;
    let skipped = 0;

    for (const [file, name] of [
      ['catalog-innoceana.json', 'Innoceana'],
      ['catalog-bcss.json', 'BCSS'],
      ['catalog-universal-plastic.json', 'Universal Plastic'],
    ] as const) {
      for (const entry of entriesFrom(file, name)) {
        const res = classifyEntry(entry);
        if (res.skipped) skipped += 1;
        else if (res.classified) classified += 1;
        else unresolved.push(`${entry.provider}/${entry.ref.label}`);
      }
    }

    expect(unresolved).toEqual([]);
    expect(classified).toBeGreaterThan(0);
    expect(skipped).toBeGreaterThan(0);
  });

  it('resolves a third-party dataset to the right type and place', () => {
    const [tenerife] = entriesFrom('catalog-innoceana.json', 'Innoceana');
    const { classified, warning } = classifyEntry(tenerife);
    expect(warning).toBeNull();
    expect(classified).toMatchObject({
      datasetType: 'recogidas_playa',
      category: 'cleanup',
      ocean: 'atlantico',
      place: 'tenerife',
      providerFolder: 'innoceana',
    });
    expect(classified!.station!.name).toBe('Tenerife');
  });

  it('skips schema and metadata assets silently', () => {
    const entries = entriesFrom(
      'catalog-universal-plastic.json',
      'Universal Plastic',
    );
    const schema = entries.find((e) => /esquema|metadatos/i.test(e.ref.label));
    expect(schema).toBeDefined();
    const res = classifyEntry(schema!);
    expect(res.skipped).toBe(true);
    expect(res.classified).toBeNull();
    expect(res.warning).toBeNull();
  });
});

describe('classifyEntry on assets the table does not cover', () => {
  const unknown = (label: string): SourceEntry => ({
    ref: { id: '00000000-0000-4000-8000-000000000000', label },
    provider: 'Innoceana',
    formats: [],
  });

  it('refuses to classify and says which asset, rather than guessing', () => {
    const res = classifyEntry(unknown('Recogidas playas Blanes'));
    expect(res.classified).toBeNull();
    expect(res.skipped).toBe(false);
    expect(res.warning).toContain('does not know');
    expect(res.warning).toContain('Recogidas playas Blanes');
  });

  it('suggests a mapping when the name is recognisable', () => {
    expect(classifyEntry(unknown('Oceanografía Gijón')).warning).toContain(
      'looks like oceanografia_previa_evento at gijon',
    );
  });

  it('says so plainly when the name gives no hint', () => {
    expect(classifyEntry(unknown('Asset 1')).warning).toContain(
      'no reliable hint',
    );
  });

  it('does not suggest a type from a name that only half matches', () => {
    // A type with no place is not actionable, and pretending otherwise invites
    // someone to paste a wrong entry into the table.
    expect(classifyEntry(unknown('Oceanografía')).warning).toContain(
      'no reliable hint',
    );
  });
});

describe('name drift', () => {
  it('classifies by id and warns when the published name has moved on', () => {
    const [id, mapped] = Object.entries(ASSET_MAP)[0];
    const res = classifyEntry({
      ref: { id, label: `${mapped.name} (v2)` },
      provider: mapped.providerFolder,
      formats: [],
    });
    expect(res.classified).not.toBeNull();
    expect(res.warning).toContain('should be refreshed');
  });

  it('tolerates the whitespace and accent noise the real names carry', () => {
    // Real published names include " Atmósfera Barcelona" and "Atmósfera Blanes "
    // — leading and trailing spaces. That is not drift worth a warning.
    const [id, mapped] = Object.entries(ASSET_MAP).find(([, m]) =>
      /Atm/i.test(m.name),
    )!;
    const res = classifyEntry({
      ref: { id, label: `  ${mapped.name.toUpperCase()}  ` },
      provider: mapped.providerFolder,
      formats: [],
    });
    expect(res.warning).toBeNull();
  });
});

describe('suggestMapping', () => {
  it('reads the untidy real names', () => {
    expect(suggestMapping('muestras_peces_gijon')).toEqual({
      datasetType: 'muestras_de_peces_py_gcms',
      place: 'gijon',
    });
    expect(
      suggestMapping('Contexto ambiental para boya de biomasa Cádiz'),
    ).toEqual({
      datasetType: 'environmental_boya',
      place: 'cadiz',
    });
    expect(suggestMapping('Boya microplásticos Gijón')).toEqual({
      datasetType: 'boya_microplasticos_seabot',
      place: 'gijon',
    });
  });

  it('returns nulls rather than a wrong guess', () => {
    expect(suggestMapping('Waste collection TEST')).toEqual({
      datasetType: null,
      place: null,
    });
  });
});
