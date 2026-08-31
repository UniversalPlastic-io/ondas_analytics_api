import { BadRequestException } from '@nestjs/common';
import { ReportsService } from './reports.service';
import * as reportsS3 from './reports-s3';
import { AssetsRepository } from '../dataspace/assets.repository';
import {
  CleanupObservationRow,
  ObservationsRepository,
} from '../dataspace/observations.repository';

const NOW = new Date('2026-06-18T10:00:00.000Z');

const ROW: CleanupObservationRow = {
  date: '2026-06-07',
  assetId: 'a1',
  location: 'Badalona',
  city: 'Badalona',
  lat: 41.437,
  lon: 2.244,
  kg: 1.0,
  volunteers: 3,
  km: 1.2,
  durationSeconds: 2700,
  evidence: 2,
  polymers: {
    pct_pet: 50,
    pct_hdpe: 20,
    pct_ldpe: 10,
    pct_pp: 10,
    pct_ps: 0,
    pct_pvc: 0,
    pct_others: 0,
  },
};

describe('ReportsService.generate', () => {
  let svc: ReportsService;
  let cleanupRows: jest.Mock;
  let oceanFor: jest.Mock;
  let upload: jest.SpyInstance;

  beforeEach(() => {
    cleanupRows = jest.fn().mockResolvedValue([ROW]);
    oceanFor = jest.fn().mockResolvedValue('mediterraneo');
    const assets = {
      findByPlaces: jest.fn().mockResolvedValue([{ _id: 'a1' }]),
      oceanFor,
    } as unknown as AssetsRepository;
    const observations = { cleanupRows } as unknown as ObservationsRepository;
    svc = new ReportsService(assets, observations);
    upload = jest.spyOn(reportsS3, 'uploadReportToS3').mockResolvedValue({
      downloadUrl:
        'https://universalplastic-sedia.s3.eu-central-1.amazonaws.com/public/mediterraneo/universal_plastic/reports/rep_x.pdf',
      s3Key: 'public/mediterraneo/universal_plastic/reports/rep_x.pdf',
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it('files the report under the basin the read model reports', async () => {
    // The basin used to come from a hardcoded table of coordinates parsed out of
    // a storage URL. It comes from the observed assets now.
    oceanFor.mockResolvedValue('catambrico');
    await svc.generate({ type: 'monthly', period: { preset: 'month' } }, NOW);
    expect(oceanFor).toHaveBeenCalledWith({
      lat: expect.any(Number),
      lon: expect.any(Number),
    });
    expect(upload).toHaveBeenCalledWith(
      expect.objectContaining({ ocean: 'catambrico' }),
    );
  });

  it('files output it cannot place under a basin that is obviously not one', async () => {
    // Better an unplaced folder than a plausible wrong one: a report filed under
    // a real basin it does not belong to is indistinguishable from correct output.
    oceanFor.mockResolvedValue(null);
    await svc.generate({ type: 'monthly', period: { preset: 'month' } }, NOW);
    expect(upload).toHaveBeenCalledWith(
      expect.objectContaining({ ocean: 'sin-ubicar' }),
    );
  });

  it('returns a ready response with an https downloadUrl', async () => {
    const res = await svc.generate(
      { type: 'monthly', period: { preset: 'month' } },
      NOW,
    );
    expect(res.status).toBe('ready');
    expect(res.type).toBe('monthly');
    expect(res.period).toBe('June 2026');
    expect(res.format).toBe('pdf');
    expect(res.downloadUrl).toMatch(/^https:\/\/universalplastic-sedia\.s3\./);
    expect(res.requestId).toMatch(/^rep_/);
    expect(res.name).toContain('Monthly cleanup report');
  });

  it('asks the database for the report period only', async () => {
    await svc.generate({ type: 'monthly', period: { preset: 'month' } }, NOW);
    expect(cleanupRows).toHaveBeenCalledWith(
      expect.objectContaining({ start: '2026-06-01', end: '2026-06-30' }),
    );
  });

  it('coerces xlsx to pdf', async () => {
    const res = await svc.generate(
      { type: 'monthly', period: { preset: 'month' }, format: 'xlsx' },
      NOW,
    );
    expect(res.format).toBe('pdf');
  });

  it('rejects a campaign report without an id', async () => {
    await expect(
      svc.generate({ type: 'campaign', period: { preset: 'month' } }, NOW),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a custom report without a date range', async () => {
    await expect(svc.generate({ type: 'custom' }, NOW)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('maps an empty period to 422', async () => {
    cleanupRows.mockResolvedValue([]);
    await expect(
      svc.generate({ type: 'monthly', period: { preset: 'month' } }, NOW),
    ).rejects.toMatchObject({
      status: 422,
    });
  });
});
