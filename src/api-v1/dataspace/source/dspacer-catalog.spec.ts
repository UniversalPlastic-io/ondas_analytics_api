import {
  buildCatalogRequest,
  buildContractRequest,
  dataProviders,
  explainTransferFailure,
  parseCatalog,
  parseParticipants,
  parseUploadedAsset,
  PULL_FORMAT,
  DspacerRefPayload,
} from './dspacer-catalog';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Read from disk rather than imported, so enabling resolveJsonModule is not a
 * prerequisite for running the tests and no fixture can reach the build output. */
function fixture<T = any>(name: string): T {
  return JSON.parse(
    readFileSync(join(__dirname, '__fixtures__', name), 'utf-8'),
  ) as T;
}

const bpnAll = fixture('bpn-all.json');
const innoceana = fixture('catalog-innoceana.json');
const universalPlastic = fixture('catalog-universal-plastic.json');
const bcss = fixture('catalog-bcss.json');
const transferErrors = fixture('transfer-errors.json');

/**
 * The fixtures are real responses from the deployed connector, captured
 * 31/08/2026, with BPNs and internal addresses replaced by structurally
 * identical placeholders. Asserting against them is the difference between
 * testing the connector's actual contract and testing an invented one.
 */

const providers = dataProviders(parseParticipants(bpnAll));
const innoceanaProvider = providers.find((p) => p.name === 'Innoceana')!;

describe('parseParticipants', () => {
  it('reads every participant from a live /bpn/all response', () => {
    const parsed = parseParticipants(bpnAll);
    expect(parsed).toHaveLength(5);
    expect(parsed.map((p) => p.name)).toEqual(
      expect.arrayContaining([
        'Universal Plastic',
        'Innoceana',
        'BCSS',
        'Port Badalona',
        'Gijon Surf Hostel',
      ]),
    );
  });

  it('keeps `direction`, which is what a catalog request needs as counterPartyAddress', () => {
    for (const p of parseParticipants(bpnAll)) {
      expect(p.direction).toMatch(/^https?:\/\/.+/);
    }
  });

  it('accepts a site BPN, not only a legal-entity one', () => {
    // Port Badalona is registered as BPNS…, not BPNL…. Validating the prefix
    // would have dropped a real provider.
    const badalona = parseParticipants(bpnAll).find(
      (p) => p.name === 'Port Badalona',
    )!;
    expect(badalona.bpn).toMatch(/^BPNS/);
  });

  it('survives a malformed or absent payload instead of throwing', () => {
    expect(parseParticipants(null)).toEqual([]);
    expect(parseParticipants({})).toEqual([]);
    expect(parseParticipants({ participants: 'nope' })).toEqual([]);
    expect(
      parseParticipants({
        participants: [{ name: 'no bpn' }, { bpn: 'B', direction: 'http://x' }],
      }),
    ).toHaveLength(1);
  });

  it('falls back to the BPN when a participant has no name', () => {
    const [p] = parseParticipants({
      participants: [{ bpn: 'BPNL1', direction: 'http://x' }],
    });
    expect(p.name).toBe('BPNL1');
  });
});

describe('dataProviders', () => {
  it('keeps only participants that provide data', () => {
    expect(dataProviders(parseParticipants(bpnAll))).toHaveLength(5);
    expect(
      dataProviders([
        { bpn: 'a', name: 'a', direction: 'http://a', type: 'Dataprovider' },
        { bpn: 'b', name: 'b', direction: 'http://b', type: 'Dataconsumer' },
      ]),
    ).toHaveLength(1);
  });
});

describe('parseCatalog superseding', () => {
  const provider = {
    bpn: 'BPNL1',
    name: 'Universal Plastic',
    direction: 'http://p/dsp',
    type: 'Dataprovider',
  };
  const dataset = (id: string, name: string) => ({
    '@id': id,
    name,
    'odrl:hasPolicy': { '@id': 'offer', 'odrl:permission': {} },
  });

  it('ignores an asset a later version of itself supersedes', () => {
    // The failure: both sit at the same station coordinates, so `nearest()`
    // picks between them by distance and the tie is arbitrary. The older one is
    // the one the incident emptied, so a category would find an asset with no
    // observations about half the time, fall through to calibration, and report
    // a substituted figure with a good asset next to it.
    const { entries, warnings } = parseCatalog(
      {
        'dcat:dataset': [
          dataset('old', 'Oceanografía Barcelona'),
          dataset('new', 'Oceanografía Barcelona_v1.1'),
        ],
      },
      provider,
    );
    expect(entries.map((e) => e.ref.id)).toEqual(['new']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/still offers "Oceanografía Barcelona"/);
    expect(warnings[0]).toMatch(/Unpublish it/);
  });

  it('keeps the later version whichever order the catalog lists them in', () => {
    for (const order of [
      ['Recogidas playas Blanes_v1.1', 'Recogidas playas Blanes'],
      ['Recogidas playas Blanes', 'Recogidas playas Blanes_v1.1'],
    ]) {
      const { entries } = parseCatalog(
        { 'dcat:dataset': order.map((n, i) => dataset(String(i), n)) },
        provider,
      );
      expect(entries).toHaveLength(1);
      expect(entries[0].ref.label).toBe('Recogidas playas Blanes_v1.1');
    }
  });

  it('compares versions as numbers, so v1.10 beats v1.9', () => {
    const { entries } = parseCatalog(
      {
        'dcat:dataset': [
          dataset('a', 'Atmósfera Gijón_v1.9'),
          dataset('b', 'Atmósfera Gijón_v1.10'),
        ],
      },
      provider,
    );
    expect(entries[0].ref.label).toBe('Atmósfera Gijón_v1.10');
  });

  it('leaves distinct datasets alone, and the whitespace variants of one name', () => {
    const { entries, warnings } = parseCatalog(
      {
        'dcat:dataset': [
          dataset('a', 'Atmósfera Gijón_v1.1'),
          dataset('b', 'Oceanografía Gijón_v1.1'),
          dataset('c', 'Boya biomasa Gijón_v1.1'),
        ],
      },
      provider,
    );
    expect(entries).toHaveLength(3);
    expect(warnings).toEqual([]);
  });

  it('does not resolve a clash between two providers', () => {
    // Two participants offering a same-named dataset may be an upload error, but
    // it is not ours to silently resolve: dropping one discards a participant's
    // data, and the two catalogs are read separately anyway.
    const a = parseCatalog(
      { 'dcat:dataset': [dataset('a', 'Recogidas playas Barcelona_v1.1')] },
      provider,
    );
    const b = parseCatalog(
      { 'dcat:dataset': [dataset('b', 'Recogidas playas Barcelona_v1.1')] },
      { ...provider, name: 'Innoceana', bpn: 'BPNL2' },
    );
    expect(a.entries).toHaveLength(1);
    expect(b.entries).toHaveLength(1);
    expect([...a.warnings, ...b.warnings]).toEqual([]);
  });
});

describe('parseCatalog', () => {
  it('reads a real provider catalog', () => {
    // Asserted by shape, not by a list of names: providers republish, and a
    // fixture recaptured after a republication round would fail a literal list
    // without anything being wrong.
    const { entries, warnings } = parseCatalog(innoceana, innoceanaProvider);
    // Innoceana still offers the pre-incident `Recogidas playas Barcelona`
    // alongside its `_v1.1`, so one supersede warning is the correct outcome
    // here. Anything else would be a parse problem.
    for (const w of warnings) expect(w).toMatch(/superseded by/);
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e.ref.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(e.ref.label.trim()).not.toBe('');
      expect(e.provider).toBe('Innoceana');
    }
    expect(entries.some((e) => /tenerife/i.test(e.ref.label))).toBe(true);
  });

  it('carries the offer and the provider address needed to transfer', () => {
    const [entry] = parseCatalog(innoceana, innoceanaProvider).entries;
    const payload = entry.ref.payload as DspacerRefPayload;
    expect(payload.providerBpn).toBe(innoceanaProvider.bpn);
    expect(payload.counterPartyAddress).toBe(innoceanaProvider.direction);
    expect(typeof payload.offer['@id']).toBe('string');
    expect(payload.offer['odrl:permission']).toBeDefined();
  });

  it('records the distributions the provider offers, PULL among them', () => {
    const [entry] = parseCatalog(innoceana, innoceanaProvider).entries;
    expect(entry.formats).toContain(PULL_FORMAT);
    expect(entry.formats).toEqual([...entry.formats].sort());
  });

  it('reads catalogs from every provider in the space', () => {
    for (const [body, name] of [
      [universalPlastic, 'Universal Plastic'],
      [bcss, 'BCSS'],
    ] as const) {
      const provider = providers.find((p) => p.name === name)!;
      const { entries } = parseCatalog(body, provider);
      expect(entries.length).toBeGreaterThan(0);
      for (const e of entries) expect(e.ref.id).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it('skips a dataset with no offer and says which one', () => {
    const { entries, warnings } = parseCatalog(
      { 'dcat:dataset': [{ '@id': 'x', name: 'unofferred' }] },
      innoceanaProvider,
    );
    expect(entries).toEqual([]);
    expect(warnings).toEqual([
      'Innoceana/unofferred has no contract offer; skipped',
    ]);
  });

  it('skips a dataset offering no PULL distribution and says which one', () => {
    const { entries, warnings } = parseCatalog(
      {
        'dcat:dataset': [
          {
            '@id': 'x',
            name: 'push only',
            'odrl:hasPolicy': { '@id': 'offer-1' },
            'dcat:distribution': [{ 'dct:format': { '@id': 'AmazonS3-PUSH' } }],
          },
        ],
      },
      innoceanaProvider,
    );
    expect(entries).toEqual([]);
    expect(warnings[0]).toContain('offers no HttpData-PULL distribution');
  });

  it('warns rather than guessing when a dataset carries several offers', () => {
    const { entries, warnings } = parseCatalog(
      {
        'dcat:dataset': [
          {
            '@id': 'x',
            name: 'two policies',
            'odrl:hasPolicy': [{ '@id': 'first' }, { '@id': 'second' }],
          },
        ],
      },
      innoceanaProvider,
    );
    expect(entries).toHaveLength(1);
    expect(warnings[0]).toContain('offers 2 policies');
    expect((entries[0].ref.payload as DspacerRefPayload).offer['@id']).toBe(
      'first',
    );
  });

  it('accepts a single dataset that is not wrapped in an array', () => {
    // JSON-LD collapses a one-element list to the bare object.
    const { entries } = parseCatalog(
      {
        'dcat:dataset': {
          '@id': 'solo',
          name: 'Solo',
          'odrl:hasPolicy': { '@id': 'o' },
        },
      },
      innoceanaProvider,
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].ref.id).toBe('solo');
  });

  it('reports an empty catalog instead of returning silently', () => {
    const { entries, warnings } = parseCatalog(
      { 'dcat:dataset': [] },
      innoceanaProvider,
    );
    expect(entries).toEqual([]);
    expect(warnings).toEqual(['Innoceana published an empty catalog']);
  });
});

describe('buildCatalogRequest', () => {
  it('matches the shape the connector expects', () => {
    expect(buildCatalogRequest(innoceanaProvider, { limit: 200 })).toEqual({
      '@context': { '@vocab': 'https://w3id.org/edc/v0.0.1/ns/' },
      '@type': 'CatalogRequest',
      counterPartyAddress: innoceanaProvider.direction,
      counterPartyId: innoceanaProvider.bpn,
      protocol: 'dataspace-protocol-http',
      querySpec: { offset: 0, limit: 200 },
    });
  });
});

describe('buildContractRequest', () => {
  it('echoes the catalog offer back verbatim', () => {
    const [entry] = parseCatalog(innoceana, innoceanaProvider).entries;
    const payload = entry.ref.payload as DspacerRefPayload;
    const body = buildContractRequest(entry.ref) as Record<string, any>;

    expect(body['@type']).toBe('ContractRequest');
    expect(body.protocol).toBe('dataspace-protocol-http');
    expect(body.counterPartyAddress).toBe(payload.counterPartyAddress);
    expect(body.policy['@id']).toBe(payload.offer['@id']);
    expect(body.policy.target).toBe(entry.ref.id);
    expect(body.policy.assigner).toBe(payload.providerBpn);
    // The connector matches the request against the published offer, so the
    // permission must be the same object, not a normalised copy.
    expect(body.policy['odrl:permission']).toEqual(
      payload.offer['odrl:permission'],
    );
  });

  it('defaults the empty ODRL blocks the connector still expects', () => {
    const body = buildContractRequest({
      id: 'a',
      label: 'a',
      payload: {
        providerBpn: 'BPNL1',
        providerName: 'p',
        counterPartyAddress: 'http://p',
        offer: { '@id': 'o' },
      },
    }) as Record<string, any>;
    expect(body.policy['odrl:prohibition']).toEqual([]);
    expect(body.policy['odrl:obligation']).toEqual([]);
  });

  it('refuses to build a request from a ref with no offer, naming the reason', () => {
    // The failure mode this guards against is a ref rebuilt from the database
    // instead of from a fresh catalog read. The offer id embeds the asset name,
    // so a stored one silently stops matching.
    expect(() => buildContractRequest({ id: 'a', label: 'a' })).toThrow(
      /catalog offer is missing/,
    );
    expect(() => buildContractRequest({ id: 'a', label: 'a' })).toThrow(
      /not valid across runs/,
    );
  });
});

describe('explainTransferFailure', () => {
  it('names the missing-EDR failure as a negotiation problem, not a missing asset', () => {
    const msg = explainTransferFailure(transferErrors.edr_never_materialised);
    expect(msg).toContain('no endpoint data reference');
    expect(msg).toContain('not a missing asset');
  });

  it('names the 404 failure as an asset published without a resolvable data address', () => {
    const msg = explainTransferFailure(transferErrors.provider_data_404);
    expect(msg).toContain("provider's data plane returned 404");
    expect(msg).toContain('without a resolvable data address');
  });

  it('degrades gracefully on a shape it has never seen', () => {
    expect(explainTransferFailure(null)).toBe(
      'the connector returned an unrecognised error',
    );
    expect(explainTransferFailure({ detail: 'plain string' })).toBe(
      'plain string',
    );
    expect(
      explainTransferFailure({
        detail: { message: 'boom', downstream_status: 502 },
      }),
    ).toContain('downstream 502');
  });
});

describe('parseUploadedAsset', () => {
  /**
   * The middleware declares the response of every write operation as
   * `schema: {}`, so none of these field names are documented. The shape read
   * here is the one `POST /data/all` returns for an existing asset, and the
   * tolerance is deliberate: the alternative to accepting several spellings is
   * an upload that succeeded and a publication that reports failure.
   */

  it('reads the id from the JSON-LD identifier', () => {
    expect(
      parseUploadedAsset({
        '@id': 'asset-1',
        properties: { name: 'report_x', id: 'asset-1' },
      }),
    ).toEqual({ id: 'asset-1', name: 'report_x', dataAddressBaseUrl: null });
  });

  it('falls back to the id inside properties', () => {
    expect(parseUploadedAsset({ properties: { id: 'asset-2' } })?.id).toBe(
      'asset-2',
    );
  });

  it('reads an EDC-namespaced property', () => {
    const ns = 'https://w3id.org/edc/v0.0.1/ns/';
    expect(
      parseUploadedAsset({
        '@id': 'asset-3',
        properties: { [`${ns}name`]: 'report_y' },
        dataAddress: { [`${ns}baseUrl`]: 'urn:uuid:abc' },
      }),
    ).toEqual({
      id: 'asset-3',
      name: 'report_y',
      dataAddressBaseUrl: 'urn:uuid:abc',
    });
  });

  it('looks inside a wrapper rather than assuming the top level', () => {
    expect(parseUploadedAsset({ asset: { '@id': 'asset-4' } })?.id).toBe(
      'asset-4',
    );
    expect(parseUploadedAsset({ data: { '@id': 'asset-5' } })?.id).toBe(
      'asset-5',
    );
  });

  it('returns null when nothing in the answer identifies an asset', () => {
    // The caller turns this into a failure. Guessing an id would create a
    // contract pointing at nothing.
    expect(parseUploadedAsset({ ok: true })).toBeNull();
    expect(parseUploadedAsset(null)).toBeNull();
    expect(parseUploadedAsset('stored')).toBeNull();
    expect(parseUploadedAsset({ '@id': '   ' })).toBeNull();
  });
});
