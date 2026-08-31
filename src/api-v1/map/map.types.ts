export type MapCategory =
  | 'cleanup' | 'biomass' | 'microplastics' | 'environmental' | 'atmospheric' | 'oceanographic'
  | 'water_samples' | 'fish_samples';

export interface DateRange { start: string; end: string }

export interface CleanupEvent {
  date: string; kg: number; volunteers: number; km: number; duration: string | null; evidence: number;
}

export interface MapPoint {
  id: string;
  /** The asset id in the data space. Same value as `id`; kept explicit. */
  sourceId: string;
  name: string;
  datasetType: string;
  label: string;
  category: MapCategory;
  color: string;
  provider: string;
  ocean: string;
  lat: number;
  lng: number;
  records: number | null;
  dateRange: DateRange | null;
  format: string;
  units?: Record<string, string>;
  /**
   * Address of the underlying content, when one exists.
   *
   * Always null for data space assets: an asset is reached by negotiating a
   * contract, not by dereferencing a URL. Kept so existing clients do not break
   * on a missing field.
   */
  url: string | null;
  metadataSchemaRef: string | null;
  warnings: string[];
  // headline numbers for the popup (shape depends on category)
  summary?: Record<string, unknown>;
  // cleanup only: per-event rows
  cleanupsList?: CleanupEvent[];
}

export interface MapResponse {
  count: number;
  bounds: [[number, number], [number, number]] | null; // [[minLat,minLng],[maxLat,maxLng]]
  points: MapPoint[];
}

export interface MapFilter {
  ocean?: string;
  datasetType?: string;
  provider?: string;
  /** Set when the caller asked to see only their own organization's datasets. */
  organizationId?: string | null;
}
