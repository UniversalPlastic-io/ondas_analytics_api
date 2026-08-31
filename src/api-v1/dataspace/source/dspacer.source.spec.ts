import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DspacerSource } from './dspacer.source';
import { DspacerClient, DspacerRequestError } from './dspacer.client';
import {
  AssetForbiddenError,
  AssetNotFoundError,
  SourceRef,
} from './dataspace-source';
import { Participant } from './dspacer-catalog';

function fixture(name: string): any {
  return JSON.parse(
    readFileSync(join(__dirname, '__fixtures__', name), 'utf-8'),
  );
}

const PARTICIPANTS: Participant[] = fixture('bpn-all.json').participants;
const CATALOGS: Record<string, unknown> = {
  Innoceana: fixture('catalog-innoceana.json'),
  BCSS: fixture('catalog-bcss.json'),
  'Universal Plastic': fixture('catalog-universal-plastic.json'),
};

function source(
  overrides: Partial<{
    participants: Participant[];
    catalog: (p: Participant) => Promise<unknown>;
    transfer: (ref: SourceRef) => Promise<unknown>;
  }> = {},
) {
  const client = {
    participants: async () => overrides.participants ?? PARTICIPANTS,
    catalog:
      overrides.catalog ??
      (async (p: Participant) => CATALOGS[p.name] ?? { 'dcat:dataset': [] }),
    transfer:
      overrides.transfer ??
      (async () => ({ metadata: {}, dataset: { records: [] } })),
    healthy: async () => true,
  } as unknown as DspacerClient;
  return new DspacerSource(client);
}

describe('DspacerSource.list', () => {
  it('collects the assets of every provider in one listing', async () => {
    const { entries, warnings } = await source().list();
    expect(entries.length).toBeGreaterThan(5);
    expect(new Set(entries.map((e) => e.provider)).size).toBeGreaterThan(1);
    expect(warnings.filter((w) => /could not read/.test(w))).toEqual([]);
  });

  it('keeps the rest of the space when one provider fails', async () => {
    const source_ = source({
      catalog: async (p) => {
        if (p.name === 'Innoceana')
          throw new DspacerRequestError(500, 'catalog', 'connector restarting');
        return CATALOGS[p.name] ?? { 'dcat:dataset': [] };
      },
    });
    const { entries, warnings } = await source_.list();

    expect(entries.length).toBeGreaterThan(0);
    expect(entries.some((e) => e.provider === 'Innoceana')).toBe(false);
    expect(warnings).toContainEqual(
      expect.stringContaining('could not read the catalog of Innoceana'),
    );
  });

  it('reports an asset offered by two providers instead of ingesting it twice', async () => {
    const duplicated = CATALOGS['Innoceana'];
    const source_ = source({ catalog: async () => duplicated });
    const { entries, warnings } = await source_.list();

    const ids = entries.map((e) => e.ref.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(warnings.some((w) => /is offered by both/.test(w))).toBe(true);
  });

  it('says so when the space has no providers rather than returning an empty listing', async () => {
    const { entries, warnings } = await source({ participants: [] }).list();
    expect(entries).toEqual([]);
    expect(warnings).toEqual(['the space reports no data providers']);
  });

  it('passes the parser warnings through to the run', async () => {
    const source_ = source({
      catalog: async () => ({
        'dcat:dataset': [{ '@id': 'x', name: 'no offer' }],
      }),
    });
    const { warnings } = await source_.list();
    expect(warnings.some((w) => /has no contract offer/.test(w))).toBe(true);
  });
});

describe('DspacerSource.get', () => {
  const ref: SourceRef = {
    id: 'ddadf21b-0c4d-40c8-97d7-e5cf902a5024',
    label: 'Recogidas playas Tenerife',
    payload: {
      providerBpn: 'BPNL1',
      providerName: 'Innoceana',
      counterPartyAddress: 'http://p/dsp',
      offer: { '@id': 'o' },
    },
  };

  it('returns the payload with a checksum over its canonical form', async () => {
    const payload = {
      metadata: { datasetType: 'recogidas_playa' },
      dataset: { records: [1, 2] },
    };
    const fetched = await source({ transfer: async () => payload }).get(ref);

    expect(fetched.json).toEqual(payload);
    expect(fetched.checksum).toBe(
      createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
    );
    expect(fetched.sizeBytes).toBe(Buffer.byteLength(JSON.stringify(payload)));
  });

  it('gives the same checksum for the same content across calls', async () => {
    // The checksum is the only change detector available, because the catalog
    // carries no version or date. If it were unstable every scan would rewrite
    // every asset.
    const payload = { dataset: { records: [{ a: 1, b: 2 }] } };
    const src = source({
      transfer: async () => JSON.parse(JSON.stringify(payload)),
    });
    const first = await src.get(ref);
    const second = await src.get(ref);
    expect(second.checksum).toBe(first.checksum);
  });

  it('reports no url or etag, because the source has neither', async () => {
    const fetched = await source().get(ref);
    expect(fetched.url).toBeNull();
    expect(fetched.etag).toBeNull();
    expect(fetched.lastModified).toBeNull();
  });

  it('treats a refused contract as forbidden, never as a missing asset', async () => {
    // Marking it missing would drop observations that are still valid; an expired
    // contract is a governance event, not a deleted dataset.
    const src = source({
      transfer: async () => {
        throw new DspacerRequestError(403, 'transfer', 'no contract');
      },
    });
    await expect(src.get(ref)).rejects.toThrow(AssetForbiddenError);
    await expect(src.get(ref)).rejects.toThrow(
      /Innoceana has no active contract/,
    );
  });

  it('treats an asset published without a data address as forbidden, not missing', async () => {
    // This is the live failure today: the negotiation succeeds and the provider's
    // data plane 404s. The asset exists and is contracted; it just serves nothing.
    const src = source({
      transfer: async () => {
        throw new DspacerRequestError(
          500,
          'transfer',
          "transfer failed: the provider's data plane returned 404, which means the asset is published without a resolvable data address",
        );
      },
    });
    await expect(src.get(ref)).rejects.toThrow(AssetForbiddenError);
    await expect(src.get(ref)).rejects.toThrow(
      /without a resolvable data address/,
    );
  });

  it('treats a 404 from the connector itself as a missing asset', async () => {
    const src = source({
      transfer: async () => {
        throw new DspacerRequestError(404, 'transfer', 'unknown asset');
      },
    });
    await expect(src.get(ref)).rejects.toThrow(AssetNotFoundError);
  });

  it('lets an unrecognised failure through unchanged', async () => {
    const boom = new Error('kernel panic');
    const src = source({
      transfer: async () => {
        throw boom;
      },
    });
    await expect(src.get(ref)).rejects.toBe(boom);
  });
});

describe('DspacerSource.classify', () => {
  it('classifies a real catalog entry', async () => {
    const { entries } = await source().list();
    const tenerife = entries.find(
      (e) => e.ref.id === 'ddadf21b-0c4d-40c8-97d7-e5cf902a5024',
    )!;
    expect(source().classify(tenerife)).toMatchObject({
      datasetType: 'recogidas_playa',
      ocean: 'atlantico',
      place: 'tenerife',
    });
  });

  it('returns null with a reason for an asset outside the map', () => {
    const entry = {
      ref: { id: 'unknown-id', label: 'Waste collection TEST' },
      provider: 'UP',
      formats: [],
    };
    expect(source().classify(entry)).toBeNull();
    expect(source().classifyWithReason(entry).warning).toContain(
      'does not know',
    );
  });

  it('identifies the source it is, for the record on each asset', () => {
    expect(source().kind).toBe('dspacer');
  });
});
