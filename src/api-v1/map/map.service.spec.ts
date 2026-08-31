import { MapService } from './map.service';
import { AssetsRepository } from '../dataspace/assets.repository';
import { ObservationsRepository } from '../dataspace/observations.repository';

const ASSET = (over: Record<string, unknown> = {}) => ({
  _id: 'a1',
  sourceId: '40d5bbbb-bf2e-4a39-892a-82bd16c893fe',
  providerFolder: 'port_badalona',
  url: 'https://bucket/public/mediterraneo/port_badalona/boya_biomasa_badalona.json',
  datasetType: 'boya_biomasa_slx+',
  category: 'biomass',
  dataProviderIdRaw: 'portbadalona',
  ocean: 'mediterraneo',
  place: 'badalona',
  placeName: 'Badalona',
  city: 'Badalona',
  location: { type: 'Point', coordinates: [2.2433, 41.4342] },
  format: 'rows',
  units: { 'Biomass depth -3_-5 m': 'Tonnes', b: 'x', c: 'y', d: 'z' },
  recordCount: 3611,
  observationCount: 3611,
  dateRange: { start: '2025-12-06', end: '2026-05-11' },
  summary: { meanTonnes: 18.24, maxTonnes: 41.2 },
  warnings: [],
  status: 'active',
  currentIngestId: 'g1',
  dcatSchemaRef: 'https://bucket/public/metadatos/boya_biomasa_slx+_v1.jsonld',
  ...over,
});

function service(assetsList: unknown[], cleanupRows: unknown[] = []) {
  const assets = { find: jest.fn().mockResolvedValue(assetsList) } as unknown as AssetsRepository;
  const observations = { cleanupRows: jest.fn().mockResolvedValue(cleanupRows) } as unknown as ObservationsRepository;
  return { svc: new MapService(assets, observations), assets, observations };
}

describe('MapService.getPoints', () => {
  it('builds a marker from the asset document alone', async () => {
    const { svc, observations } = service([ASSET()]);
    const res = await svc.getPoints();
    expect(res.count).toBe(1);
    expect(res.points[0]).toMatchObject({
      id: '40d5bbbb-bf2e-4a39-892a-82bd16c893fe',
      name: 'Badalona — Fish biomass buoy',
      datasetType: 'boya_biomasa_slx+',
      category: 'biomass',
      color: '#16a34a',
      provider: 'portbadalona',
      lat: 41.4342,
      lng: 2.2433,
      records: 3611,
      summary: { meanTonnes: 18.24, maxTonnes: 41.2 },
    });
    // Non-cleanup markers never read observations.
    expect(observations.cleanupRows).not.toHaveBeenCalled();
  });

  it('samples at most three units into the marker', async () => {
    const { svc } = service([ASSET()]);
    const res = await svc.getPoints();
    expect(Object.keys(res.points[0].units ?? {})).toHaveLength(3);
  });

  it('attaches the per-event list to cleanup markers', async () => {
    const cleanup = ASSET({
      sourceId: 'ddadf21b-0c4d-40c8-97d7-e5cf902a5024',
      providerFolder: 'innoceana',
      category: 'cleanup',
      datasetType: 'recogidas_playa',
      placeName: 'Tenerife',
    });
    const { svc } = service(
      [cleanup],
      [{ date: '2025-04-10', kg: 17.29, volunteers: 4, km: 1.2, durationSeconds: 1718, evidence: 2 }],
    );
    const res = await svc.getPoints();
    expect(res.points[0].cleanupsList).toEqual([
      { date: '2025-04-10', kg: 17.29, volunteers: 4, km: 1.2, duration: '0:28:38', evidence: 2 },
    ]);
  });

  it('computes bounds across markers', async () => {
    const { svc } = service([
      ASSET(),
      ASSET({ _id: 'a2', sourceId: '71034599-0830-44a8-a4bd-5f7aea885536', location: { type: 'Point', coordinates: [-5.7212, 43.5721] } }),
    ]);
    const res = await svc.getPoints();
    expect(res.bounds).toEqual([[41.4342, -5.7212], [43.5721, 2.2433]]);
  });

  it('hides assets that never completed an ingest', async () => {
    const { svc } = service([ASSET({ currentIngestId: null }), ASSET({ _id: 'a3', status: 'failed' })]);
    const res = await svc.getPoints();
    expect(res.count).toBe(0);
    expect(res.bounds).toBeNull();
  });

  it('still serves an asset whose source object disappeared, with a warning', async () => {
    const { svc } = service([ASSET({ status: 'missing' })]);
    const res = await svc.getPoints();
    expect(res.count).toBe(1);
    expect(res.points[0].warnings.some((w) => /no longer in the bucket/.test(w))).toBe(true);
  });

  it('passes the filters down to the repository', async () => {
    const { svc, assets } = service([]);
    await svc.getPoints({ ocean: 'atlantico', datasetType: 'recogidas_playa', provider: 'innoceana', organizationId: 'org1' });
    expect(assets.find).toHaveBeenCalledWith(
      expect.objectContaining({
        ocean: 'atlantico',
        datasetType: 'recogidas_playa',
        provider: 'innoceana',
        organizationId: 'org1',
      }),
    );
  });
});
