import { AssetsRepository, UNPLACED_OCEAN } from './assets.repository';

/**
 * Which basin generated output is filed under.
 *
 * The decision used to be made from a hardcoded table of twelve coordinates, with
 * the basin parsed back out of a storage URL and silently defaulting to
 * `mediterraneo`. It is now a read-model lookup: whatever the nearest observed
 * asset says it is.
 */

function repo(nearest: { ocean: string } | null) {
  const spy = jest.fn().mockResolvedValue(nearest);
  const r = Object.create(AssetsRepository.prototype) as AssetsRepository;
  (r as unknown as { nearest: unknown }).nearest = spy;
  return { r, spy };
}

describe('AssetsRepository.oceanFor', () => {
  it('takes the basin from the nearest observed asset', async () => {
    const { r } = repo({ ocean: 'catambrico' });
    expect(await r.oceanFor({ lat: 43.57, lon: -5.72 })).toBe('catambrico');
  });

  it('asks only for observed assets, never a calibration series', async () => {
    // A reference series sits in open water off the Balearics. Letting it answer
    // would file Atlantic output under the Mediterranean.
    const { r, spy } = repo({ ocean: 'mediterraneo' });
    await r.oceanFor({ lat: 36.53, lon: -6.29 });
    expect(spy).toHaveBeenCalledWith({ tier: 'observed' }, { lat: 36.53, lon: -6.29 });
  });

  it('returns null when nothing can place the point', async () => {
    // Not a basin. The caller decides, instead of being handed a default that
    // reads like an answer.
    const { r } = repo(null);
    expect(await r.oceanFor({ lat: 0, lon: 0 })).toBeNull();
  });

  it('offers an unplaced basin that cannot be mistaken for a real one', () => {
    expect(UNPLACED_OCEAN).toBe('sin-ubicar');
    expect(['mediterraneo', 'atlantico', 'catambrico']).not.toContain(UNPLACED_OCEAN);
  });
});
