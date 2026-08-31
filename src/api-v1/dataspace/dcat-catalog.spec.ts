import { Logger } from '@nestjs/common';
import { SpaceDcatCatalog } from './dcat-catalog';
import { NON_DATA_ASSETS } from './source/asset-map';
import {
  AssetForbiddenError,
  DataspaceSource,
  FetchedAsset,
  SourceEntry,
  SourceRef,
} from './source/dataspace-source';

/**
 * Reading a provider's own schema instead of the copy bundled in the repo.
 *
 * The properties that matter are all about not making things worse: a schema
 * that cannot be fetched must leave the bundled copy to answer, must be
 * complained about once rather than once per asset, and must never be fetched
 * twice within a run.
 */

const SCHEMA_ID = 'dcat-recogidas';
const SCHEMA = {
  'schema:variableMeasured': [
    { 'schema:name': 'fecha', 'schema:description': 'unit=ISO-8601' },
  ],
};

function entry(id: string, label: string): SourceEntry {
  return { ref: { id, label }, provider: 'Universal Plastic', formats: [] };
}

function harness(
  opts: {
    get?: (ref: SourceRef) => Promise<FetchedAsset>;
    entries?: SourceEntry[];
  } = {},
) {
  const get = jest.fn(
    opts.get ??
      (async (ref: SourceRef): Promise<FetchedAsset> => ({
        ref,
        json: SCHEMA,
        checksum: 'sha',
        sizeBytes: 1,
        url: null,
      })),
  );
  const source = {
    kind: 'dspacer',
    list: jest.fn(),
    get,
    classify: jest.fn(),
  } as unknown as DataspaceSource;
  const entries = opts.entries ?? [
    entry(SCHEMA_ID, 'esquema_datos_recogidas_playa'),
  ];
  return { catalog: new SpaceDcatCatalog(source, entries), get };
}

describe('SpaceDcatCatalog', () => {
  const originalTable = { ...NON_DATA_ASSETS };

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    // The live table is empty until the catalog is scanned. These tests are
    // about the mechanism, so they supply their own mapping.
    for (const key of Object.keys(NON_DATA_ASSETS)) delete NON_DATA_ASSETS[key];
    NON_DATA_ASSETS[SCHEMA_ID] = {
      name: 'esquema_datos_recogidas_playa',
      dcatFor: 'recogidas_playa',
    };
    NON_DATA_ASSETS['not-a-schema'] = {
      name: 'metadatos generales',
      dcatFor: null,
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
    for (const key of Object.keys(NON_DATA_ASSETS)) delete NON_DATA_ASSETS[key];
    Object.assign(NON_DATA_ASSETS, originalTable);
  });

  it('fetches the document mapped for a type', async () => {
    const h = harness();
    const got = await h.catalog.rawFor('recogidas_playa');
    expect(got).toEqual({ id: 'esquema_datos_recogidas_playa', raw: SCHEMA });
    expect(h.get).toHaveBeenCalledTimes(1);
    expect(h.get.mock.calls[0][0].id).toBe(SCHEMA_ID);
  });

  it('fetches each document once, however many assets ask for it', async () => {
    // A scan validates thirty assets across eight types. One contract
    // negotiation per asset would make the schema cost more than the data.
    const h = harness();
    await h.catalog.rawFor('recogidas_playa');
    await h.catalog.rawFor('recogidas_playa');
    await h.catalog.rawFor('recogidas_playa');
    expect(h.get).toHaveBeenCalledTimes(1);
  });

  it('does not retry a type it already failed to read', async () => {
    const h = harness({
      get: async () => {
        throw new AssetForbiddenError(SCHEMA_ID, 'no contract');
      },
    });
    expect(await h.catalog.rawFor('recogidas_playa')).toBeNull();
    expect(await h.catalog.rawFor('recogidas_playa')).toBeNull();
    expect(h.get).toHaveBeenCalledTimes(1);
  });

  it('complains once per type, not once per asset', async () => {
    const h = harness({
      get: async () => {
        throw new Error('transfer failed');
      },
    });
    await h.catalog.rawFor('recogidas_playa');
    await h.catalog.rawFor('recogidas_playa');
    expect(h.catalog.warnings()).toHaveLength(1);
    expect(h.catalog.warnings()[0]).toMatch(/transfer failed/);
  });

  it('says nothing about a type that simply has no schema mapped', async () => {
    // Six of the eight types have a bundled copy, and several have no published
    // schema yet. That is the normal state, not a problem to report every run.
    const h = harness();
    expect(await h.catalog.rawFor('muestras_de_peces_py_gcms')).toBeNull();
    expect(h.catalog.warnings()).toEqual([]);
    expect(h.get).not.toHaveBeenCalled();
  });

  it('reports a mapped schema the space no longer offers', async () => {
    // Providers republish under new ids. A schema that vanished is worth saying
    // out loud, because the table is what has to be refreshed.
    const h = harness({ entries: [] });
    expect(await h.catalog.rawFor('recogidas_playa')).toBeNull();
    expect(h.catalog.warnings()[0]).toMatch(/not offered to us/);
    expect(h.catalog.warnings()[0]).toMatch(/assets:refresh/);
  });

  it('refuses a document that is not a JSON object', async () => {
    const h = harness({
      get: async (ref) => ({
        ref,
        json: 'not a schema',
        checksum: 'sha',
        sizeBytes: 1,
        url: null,
      }),
    });
    expect(await h.catalog.rawFor('recogidas_playa')).toBeNull();
    expect(h.catalog.warnings()[0]).toMatch(/not a JSON object/);
  });

  it('lists only the types it could serve', () => {
    // `metadatos generales` is in the table and declares no type, so it must
    // not appear as a schema for anything.
    expect(harness().catalog.mappedTypes()).toEqual(['recogidas_playa']);
  });

  it('exposes a loader that validateAgainstDcat can call', async () => {
    const h = harness();
    expect(await h.catalog.loader()('recogidas_playa')).toEqual({
      id: 'esquema_datos_recogidas_playa',
      raw: SCHEMA,
    });
  });
});
