import { AssetsRepository, UNPLACED_OCEAN } from './assets.repository';

/**
 * Which basin generated output is filed under.
 *
 * Decided twice before this: first from a hardcoded table of twelve coordinates
 * with the basin parsed back out of a storage URL and silently defaulting to
 * `mediterraneo`, then from whichever observed asset happened to be nearest.
 * The second was no better than the first — an unbounded nearest-neighbour
 * search meant the folder an analysis was archived under depended on what the
 * participants had published that week, not on where the request was.
 *
 * It is now the coastline: a property of the point, and of nothing else.
 */

function repo(): { r: AssetsRepository; nearest: jest.Mock } {
  const nearest = jest.fn();
  const r = Object.create(AssetsRepository.prototype) as AssetsRepository;
  (r as unknown as { nearest: unknown }).nearest = nearest;
  return { r, nearest };
}

describe('AssetsRepository.oceanFor', () => {
  it('takes the basin from the coast the point is on', async () => {
    const { r } = repo();
    expect(await r.oceanFor({ lat: 43.57, lon: -5.72 })).toBe('catambrico');
    expect(await r.oceanFor({ lat: 41.43, lon: 2.24 })).toBe('mediterraneo');
    expect(await r.oceanFor({ lat: 36.53, lon: -6.29 })).toBe('atlantico');
    expect(await r.oceanFor({ lat: 28.19, lon: -16.66 })).toBe('atlantico');
  });

  it('does not consult the read model at all', async () => {
    // Which sea a point is in is not something the inventory gets a vote on. A
    // calibration series sits in open water off the Balearics, and while it was
    // a nearest-asset lookup it could file Atlantic output as Mediterranean.
    const { r, nearest } = repo();
    await r.oceanFor({ lat: 36.53, lon: -6.29 });
    expect(nearest).not.toHaveBeenCalled();
  });

  it('returns null when the point is on no covered coast', async () => {
    // Not a basin. The caller decides, instead of being handed a default that
    // reads like an answer.
    const { r } = repo();
    expect(await r.oceanFor({ lat: 0, lon: 0 })).toBeNull();
    expect(await r.oceanFor({ lat: 40.4168, lon: -3.7038 })).toBeNull(); // Madrid
  });

  it('offers an unplaced basin that cannot be mistaken for a real one', () => {
    expect(UNPLACED_OCEAN).toBe('sin-ubicar');
    expect(['mediterraneo', 'atlantico', 'catambrico']).not.toContain(
      UNPLACED_OCEAN,
    );
  });
});
