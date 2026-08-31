import { resolveCampaignScope } from './reports-campaign-map';

describe('resolveCampaignScope', () => {
  it('maps c3 → Barcelona, one place with site/city', () => {
    const s = resolveCampaignScope('c3');
    expect(s.campaignId).toBe('c3');
    expect(s.campaignName).toMatch(/Barceloneta/i);
    expect(s.places).toEqual(['barcelona']);
    expect(s.siteLabel).toBe('Barcelona');
    expect(s.city).toBe('Barcelona');
  });

  it('maps c1 → Blanes / Costa Brava', () => {
    const s = resolveCampaignScope('c1');
    expect(s.places).toEqual(['blanes']);
    expect(s.city).toBe('Costa Brava');
  });

  it('all → every cleanup place', () => {
    const s = resolveCampaignScope('all');
    expect(s.campaignId).toBe('all');
    expect(s.places).toHaveLength(5);
    expect(s.places).toContain('tenerife');
  });

  it('undefined behaves like all', () => {
    expect(resolveCampaignScope(undefined).places).toHaveLength(5);
  });

  it('an unknown campaign id falls back to all', () => {
    expect(resolveCampaignScope('nope').places).toHaveLength(5);
  });

  it('names places that exist as station slugs, not filename fragments', () => {
    // The scope is resolved against Asset.place, so a value that is not a station
    // slug would match no asset and empty the campaign in silence.
    for (const id of ['all', 'c1', 'c2', 'c3', 'c4']) {
      for (const place of resolveCampaignScope(id).places) {
        expect(place).toMatch(/^[a-z]+$/);
      }
    }
  });

  it('carries coordinates for the report ocean lookup', () => {
    const s = resolveCampaignScope('c4');
    expect(s.lat).toBeCloseTo(28.1876, 3);
    expect(s.lon).toBeCloseTo(-16.6596, 3);
  });
});
