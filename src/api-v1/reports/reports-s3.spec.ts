import { reportS3Key, reportPublicUrl } from './reports-s3';

/**
 * Choosing the basin used to live here, over a hardcoded copy of the inventory.
 * It is now AssetsRepository.oceanFor, and its tests are in
 * ../dataspace/asset-ocean.spec.ts.
 */

describe('reportS3Key / reportPublicUrl', () => {
  it('builds the reports key', () => {
    expect(reportS3Key('mediterraneo', 'rep_abc')).toBe('public/mediterraneo/universal_plastic/reports/rep_abc.pdf');
  });
  it('builds the public url', () => {
    expect(reportPublicUrl('public/mediterraneo/universal_plastic/reports/rep_abc.pdf'))
      .toBe('https://universalplastic-sedia.s3.eu-central-1.amazonaws.com/public/mediterraneo/universal_plastic/reports/rep_abc.pdf');
  });
});
