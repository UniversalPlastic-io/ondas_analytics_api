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

    for (const [file, name] of [
      ['catalog-innoceana.json', 'Innoceana'],
      ['catalog-bcss.json', 'BCSS'],
      ['catalog-universal-plastic.json', 'Universal Plastic'],
    ] as const) {
      for (const entry of entriesFrom(file, name)) {
        const res = classifyEntry(entry);
        if (res.skipped) continue;
        if (res.classified) classified += 1;
        else unresolved.push(`${entry.provider}/${entry.ref.label}`);
      }
    }

    // UP publishes five calibration series with no place in their name — they
    // are not measurements of anywhere — so the table cannot key them by
    // station. They are the only assets allowed to go unresolved; anything else
    // appearing here is a dataset the read model would silently drop.
    expect(unresolved.map((u) => u.replace(/^.*\//, '').trim()).sort()).toEqual(
      [
        'Boya_biomasa_referencia',
        'Boya_microplasticos_referencia.',
        'Environmental_referencia',
        'Recogidas_playas_referencia',
        'muestras_de_agua_referencia',
      ].sort(),
    );
    expect(classified).toBeGreaterThan(0);
  });

  it('resolves a third-party dataset to the right type and place', () => {
    const tenerife = entriesFrom('catalog-innoceana.json', 'Innoceana').find(
      (e) => /recogidas playas tenerife/i.test(e.ref.label),
    )!;
    expect(tenerife).toBeDefined();
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
    // The `_v1.1` republication round did not restore the schema assets, so the
    // live catalogs currently hold none. The rule still has to hold: they were
    // there before and will be again, and ingesting one would create an asset
    // with no observations and no location.
    for (const label of [
      'esquema_datos_recogidas_plastico_app_up_v700_v1',
      'metadatos_boya_biomasa_slx+',
    ]) {
      const res = classifyEntry({
        ref: { id: '00000000-0000-4000-8000-00000000000e', label },
        provider: 'Universal Plastic',
        formats: [],
      });
      expect(res.skipped).toBe(true);
      expect(res.classified).toBeNull();
      expect(res.warning).toBeNull();
    }

    const offered = entriesFrom(
      'catalog-universal-plastic.json',
      'Universal Plastic',
    );
    expect(
      offered.filter((e) => /esquema|metadatos/i.test(e.ref.label)),
    ).toEqual([]);
  });
});

describe('classifyEntry on assets the table does not cover', () => {
  const unknown = (label: string): SourceEntry => ({
    ref: { id: '00000000-0000-4000-8000-000000000000', label },
    provider: 'Innoceana',
    formats: [],
  });

  it('classifies from the name and flags it, rather than dropping the asset', () => {
    // Providers republish assets under new ids — a platform data-loss incident
    // had every dataset re-uploaded as `_v1.1` — so refusing anything absent
    // from the table would empty the read model on every such round.
    const res = classifyEntry(unknown('Recogidas playas Blanes'));
    expect(res.classified).toMatchObject({
      datasetType: 'recogidas_playa',
      place: 'blanes',
      ocean: 'mediterraneo',
    });
    expect(res.inferred).toBe(true);
    expect(res.warning).toContain('not in ASSET_MAP');
    expect(res.warning).toContain('Recogidas playas Blanes');
  });

  it('names the inferred type in the warning, so it can be reviewed', () => {
    const res = classifyEntry(unknown('Oceanografía Gijón'));
    expect(res.warning).toContain(
      'classified from its name as oceanografia_previa_evento at gijon',
    );
    expect(res.inferred).toBe(true);
  });

  it('classifies a republished asset despite its version suffix', () => {
    // Seen live as both `_v1.1` and `_v.1.1`, with stray double spaces.
    for (const label of [
      'Boya microplásticos  Cádiz_v1.1',
      'Boya microplásticos Gijón_v.1.1',
      'Recogidas playas Blanes v2',
    ]) {
      const res = classifyEntry(unknown(label));
      expect(res.classified).not.toBeNull();
      expect(res.classified!.datasetType).not.toBeNull();
    }
  });

  it('marks a republished asset as unchanged in kind, not as a new dataset type', () => {
    const base = classifyEntry(
      unknown('Boya microplásticos Cádiz'),
    ).classified!;
    const republished = classifyEntry(
      unknown('Boya microplásticos  Cádiz_v1.1'),
    ).classified!;
    expect(republished.datasetType).toBe(base.datasetType);
    expect(republished.place).toBe(base.place);
    expect(republished.ocean).toBe(base.ocean);
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
