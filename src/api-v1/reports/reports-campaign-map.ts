export interface CampaignScope {
  campaignId: string;
  campaignName: string;
  siteLabel: string;
  city: string;
  lat: number;
  lon: number;
  /**
   * Places whose cleanup assets are in scope, resolved to assets — and therefore
   * to observations — at query time.
   *
   * A campaign is a place. This used to be a list of storage filename fragments
   * matched by regex against the object key, which tied the report scope to a
   * naming convention in a bucket; `place` is a field on the asset.
   */
  places: string[];
}

// Per-file site/city labels (recogidas_playa carries no place name of its own).
const SITE_LABELS: Array<{
  place: string;
  site: string;
  city: string;
  lat: number;
  lon: number;
}> = [
  {
    place: 'barcelona',
    site: 'Barcelona',
    city: 'Barcelona',
    lat: 41.6701792,
    lon: 2.7895005,
  },
  {
    place: 'badalona',
    site: 'Badalona',
    city: 'Badalona',
    lat: 41.4377479,
    lon: 2.2442404,
  },
  {
    place: 'blanes',
    site: 'Blanes',
    city: 'Costa Brava',
    lat: 41.676,
    lon: 2.795,
  },
  {
    place: 'tenerife',
    site: 'Tenerife',
    city: 'Canary Islands',
    lat: 28.1876084,
    lon: -16.6595858,
  },
  {
    place: 'gijon',
    site: 'Gijón',
    city: 'Asturias',
    lat: 43.5721291,
    lon: -5.7212135,
  },
];

const CAMPAIGN_MAP: Record<string, { name: string; place: string }> = {
  c1: { name: 'Costa Brava Spring Clean 2025', place: 'blanes' },
  c2: { name: 'Mediterranean Blue 2024', place: 'badalona' },
  c3: { name: 'Barceloneta Urban Impact', place: 'barcelona' },
  c4: { name: 'Corporate Wave Q1 2025', place: 'tenerife' },
};

function allScope(campaignId: string): CampaignScope {
  return {
    campaignId,
    campaignName: 'All campaigns',
    siteLabel: 'All sites',
    city: 'Spain',
    lat: 41.4377,
    lon: 2.2442, // Mediterráneo representative (Badalona)
    places: SITE_LABELS.map((l) => l.place),
  };
}

export function resolveCampaignScope(
  campaignId: string | undefined,
): CampaignScope {
  if (!campaignId || campaignId === 'all') return allScope('all');
  const mapped = CAMPAIGN_MAP[campaignId];
  if (!mapped) return allScope(campaignId);
  const label = SITE_LABELS.find((l) => l.place === mapped.place);
  return {
    campaignId,
    campaignName: mapped.name,
    siteLabel: label?.site ?? mapped.place,
    city: label?.city ?? 'Spain',
    lat: label?.lat ?? 41.4377,
    lon: label?.lon ?? 2.2442,
    places: [mapped.place],
  };
}
