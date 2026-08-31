import { assetQuery } from './assets.repository';

describe('assetQuery', () => {
  it('defaults to active assets', () => {
    expect(assetQuery()).toEqual({ status: 'active' });
    expect(assetQuery({ status: 'any' })).toEqual({});
  });

  it('matches a provider by its declared id or by the participant it came from', () => {
    // Both are stored fields. Matching used to include a regex over the object
    // key, which stopped working the moment an asset had no path.
    expect(assetQuery({ provider: 'innoceana' }).$or).toEqual([
      { dataProviderIdRaw: 'innoceana' },
      { providerFolder: 'innoceana' },
    ]);
  });

  it('never queries a field derived from an identifier', () => {
    const q = JSON.stringify(
      assetQuery({
        provider: 'innoceana',
        excludeProvider: 'bcss',
        tier: 'observed',
      }),
    );
    expect(q).not.toContain('$regex');
    expect(q).not.toContain('"key"');
    expect(q).not.toContain('bucket');
  });

  it('excludes a provider with $nor, so it composes with an include', () => {
    const q = assetQuery({ provider: 'innoceana', excludeProvider: 'bcss' });
    expect(q.$or).toEqual([
      { dataProviderIdRaw: 'innoceana' },
      { providerFolder: 'innoceana' },
    ]);
    expect(q.$nor).toEqual([
      { dataProviderIdRaw: 'bcss' },
      { providerFolder: 'bcss' },
    ]);
  });

  it('selects the tier by a stored field, never by the object key', () => {
    // The reference series are published under the universal_plastic
    // organization, so provider identity cannot distinguish them. It used to be
    // the folder in the key that did, which meant an asset with no key — one
    // that came from a catalog rather than a bucket — silently lost its tier and
    // appeared as something a participant measured. The tier is stored now.
    expect(assetQuery({ tier: 'observed' })).toEqual({
      status: 'active',
      tier: 'observed',
    });
    expect(assetQuery({ tier: 'reference' }).tier).toBe('reference');
    const q = JSON.stringify(assetQuery({ tier: 'observed' }));
    expect(q).not.toContain('$regex');
    expect(q).not.toContain('key');
  });

  it('composes the tier with a provider include and an exclude', () => {
    const q = assetQuery({
      tier: 'observed',
      provider: 'innoceana',
      excludeProvider: 'bcss',
    });
    expect(q.tier).toBe('observed');
    expect(q.$or).toBeDefined();
    expect(q.$nor).toBeDefined();
  });

  it('keeps the other filters untouched', () => {
    expect(
      assetQuery({
        category: 'biomass',
        ocean: 'mediterraneo',
        excludeProvider: 'x',
      }),
    ).toEqual({
      status: 'active',
      category: 'biomass',
      ocean: 'mediterraneo',
      $nor: [{ dataProviderIdRaw: 'x' }, { providerFolder: 'x' }],
    });
  });
});
