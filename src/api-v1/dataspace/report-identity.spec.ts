import { KEY_FIELD, reportIdentity, reportKeyDigest } from './report-identity';

/**
 * The name is what a person reads in a catalog listing and the description is
 * what tells two analyses of the same point apart. Getting either wrong is not
 * a cosmetic fault: a name that collides makes two different results look like
 * one, and a description with no key makes them indistinguishable.
 */

const BASE = {
  location: { lat: 43.5721, lon: -5.7212 },
  area: { type: 'radius_km', value: 25 },
  dateRange: { start: '2025-01-01', end: '2025-01-30' },
  aggregation: 'raw',
  analyses: ['basic_contamination', 'eco_risk'],
  coast: 'catambrico',
  cacheKey: 'analyses|{"a":1}',
  generatedAt: new Date('2026-08-31T10:15:00.000Z'),
};

describe('reportIdentity', () => {
  it('names a report by its point and the day it was generated', () => {
    expect(reportIdentity(BASE).name).toBe('report_43.5721_-5.7212_2026-08-31');
  });

  it('rounds coordinates to four decimals, the same as the cache key', () => {
    // Anything finer would name two points the cache treats as one.
    const name = reportIdentity({
      ...BASE,
      location: { lat: 43.57214999, lon: -5.72123 },
    }).name;
    expect(name).toBe('report_43.5721_-5.7212_2026-08-31');
  });

  it('breaks a tie the same way the cache key does', () => {
    // `computeCacheKey` rounds with Math.round, which sends a half up — towards
    // positive infinity, so a negative coordinate goes towards zero. Matching it
    // matters more than the direction: a name and a key that disagreed about
    // which point this is would be worse than either choice.
    const name = reportIdentity({
      ...BASE,
      location: { lat: 43.57215, lon: -5.72115 },
    }).name;
    expect(name).toBe('report_43.5722_-5.7211_2026-08-31');
  });

  it('keeps four decimals even when they are zeros', () => {
    // Fixed width, so a listing can be scanned and prefix-filtered.
    expect(
      reportIdentity({ ...BASE, location: { lat: 43.5, lon: -5 } }).name,
    ).toBe('report_43.5000_-5.0000_2026-08-31');
  });

  it('never writes a negative zero', () => {
    // A point just west of Greenwich rounds to -0, which prints as "-0.0000".
    expect(
      reportIdentity({ ...BASE, location: { lat: 39.4, lon: -0.00001 } }).name,
    ).toBe('report_39.4000_0.0000_2026-08-31');
  });

  it('takes the day in UTC', () => {
    // A local day would name the same analysis differently depending on where
    // the process runs, and two servers would disagree about which day it is.
    expect(
      reportIdentity({
        ...BASE,
        generatedAt: new Date('2026-08-31T23:59:59.000Z'),
      }).name,
    ).toContain('2026-08-31');
    expect(
      reportIdentity({
        ...BASE,
        generatedAt: new Date('2026-09-01T00:00:01.000Z'),
      }).name,
    ).toContain('2026-09-01');
  });

  it('refuses a coordinate that is not a number', () => {
    expect(() =>
      reportIdentity({ ...BASE, location: { lat: NaN, lon: -5.7212 } }),
    ).toThrow(/finite/);
  });

  it('describes what the name cannot hold', () => {
    const { description } = reportIdentity(BASE);
    expect(description).toContain('catambrico');
    expect(description).toContain('radio 25 km');
    expect(description).toContain('2025-01-01→2025-01-30');
    expect(description).toContain('raw');
    expect(description).toContain('basic_contamination+eco_risk');
    expect(description).toContain(KEY_FIELD);
  });

  it('lists the analyses in a fixed order', () => {
    // Same analyses, different request order: one description, not two.
    const a = reportIdentity({
      ...BASE,
      analyses: ['eco_risk', 'basic_contamination'],
    });
    const b = reportIdentity({
      ...BASE,
      analyses: ['basic_contamination', 'eco_risk'],
    });
    expect(a.description).toBe(b.description);
  });

  it('says so when no analysis ran', () => {
    expect(reportIdentity({ ...BASE, analyses: [] }).description).toContain(
      'ninguno',
    );
  });

  it('carries a digest of the cache key, not the key itself', () => {
    // The key is the whole normalized request, a few hundred characters of JSON.
    // The full key is inside the published document, at meta.cache.cacheKey.
    const { description, digest } = reportIdentity(BASE);
    expect(description).toContain(`${KEY_FIELD}${digest}`);
    expect(description).not.toContain(BASE.cacheKey);
    expect(digest).toMatch(/^[0-9a-f]{16}$/);
  });

  it('gives two requests that differ only by radius different digests', () => {
    // The whole reason the digest exists: same point, same day, same name.
    const a = reportIdentity({ ...BASE, cacheKey: 'analyses|{"radius":25}' });
    const b = reportIdentity({ ...BASE, cacheKey: 'analyses|{"radius":50}' });
    expect(a.name).toBe(b.name);
    expect(a.digest).not.toBe(b.digest);
  });
});

describe('reportKeyDigest', () => {
  it('is stable across calls', () => {
    expect(reportKeyDigest('abc')).toBe(reportKeyDigest('abc'));
  });

  it('is not the truncated input', () => {
    expect(reportKeyDigest('abc')).not.toContain('abc');
  });
});
