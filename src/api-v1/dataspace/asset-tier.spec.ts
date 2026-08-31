import {
  REFERENCE_PROVIDER_FOLDER,
  tierForProviderFolder,
} from './dataspace.constants';

describe('tierForProviderFolder', () => {
  it('marks the reference provider folder as the calibration tier', () => {
    expect(tierForProviderFolder(REFERENCE_PROVIDER_FOLDER)).toBe('reference');
  });

  it('marks every real participant as observed', () => {
    for (const folder of [
      'universal_plastic',
      'innoceana',
      'port_badalona',
      'gijon_surf_hostel',
      'bcss',
    ]) {
      expect(tierForProviderFolder(folder)).toBe('observed');
    }
  });

  it('defaults an unknown or absent provider to observed', () => {
    // An asset whose provider cannot be resolved is data until proven otherwise.
    // Defaulting the other way would silently drop it out of every read that
    // asks for observed data, which is the failure this field exists to prevent.
    expect(tierForProviderFolder(null)).toBe('observed');
    expect(tierForProviderFolder(undefined)).toBe('observed');
    expect(tierForProviderFolder('')).toBe('observed');
  });

  it('does not treat the reference publisher as the tier marker', () => {
    // The reference series declare dataProviderId 'universal_plastic' so the
    // ingest can attach them to an organization. Publisher and tier are
    // deliberately independent.
    expect(tierForProviderFolder('universal_plastic')).toBe('observed');
  });
});
