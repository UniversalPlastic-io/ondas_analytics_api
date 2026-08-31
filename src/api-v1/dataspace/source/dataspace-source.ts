import { DatasetType, Category, Ocean, Station } from '../dataspace.constants';

/**
 * Where the read model gets its data.
 *
 * The two implementations differ more than a transport swap suggests: an object
 * store is addressed by a path that encodes what the asset is, while a data space
 * is addressed by an opaque UUID whose access is granted by a contract. The port
 * is deliberately narrow so that difference stays inside the implementations.
 *
 * Note what is NOT here: a `head` operation. Object storage answers "did this
 * change?" from an ETag; a data space catalog carries no version, date or
 * checksum, so the only honest answer is to fetch and compare. Modelling a cheap
 * head here would be a lie in one of the two implementations.
 */

/** Identity of an asset within its source, plus whatever the source needs to fetch it. */
export interface SourceRef {
  /** Stable, unique within the source. Stored on the asset and used for reconciliation. */
  id: string;
  /** Human-readable, for logs, warnings and sync results. */
  label: string;
  /** Opaque to every caller; only the source that produced it may interpret it. */
  payload?: unknown;
}

/** One asset as the source advertises it, before anything is fetched. */
export interface SourceEntry {
  ref: SourceRef;
  /** The publishing participant, as the source names them. */
  provider: string;
  /** Formats the source offers, when it says. Empty when it does not. */
  formats: string[];
}

/** An asset's content, once fetched. */
export interface FetchedAsset {
  ref: SourceRef;
  json: unknown;
  /** SHA-256 of the exact bytes received. The only change detector that works for both sources. */
  checksum: string;
  sizeBytes: number;
  /** Where the content came from, for the record. Not every source has a URL. */
  url: string | null;
  /** Present only when the source exposes one; never required. */
  etag?: string | null;
  lastModified?: Date | null;
}

/** Everything derivable about an asset before opening it. */
export interface ClassifiedAsset {
  ocean: Ocean;
  providerFolder: string;
  fragment: string;
  place: string | null;
  station: Station | null;
  datasetType: DatasetType | null;
  category: Category | null;
}

export interface SourceListing {
  entries: SourceEntry[];
  /** Non-fatal problems: a provider that failed, an asset that could not be classified. */
  warnings: string[];
}

export class AssetNotFoundError extends Error {
  constructor(ref: string) {
    super(`asset not available from the source: ${ref}`);
    this.name = 'AssetNotFoundError';
  }
}

/**
 * Raised when the source is reachable but refuses the asset.
 *
 * Distinct from AssetNotFoundError on purpose. In a bucket a 403 and a 404 are
 * both "you get nothing", and the old reader conflated them; in a data space a
 * refusal means the contract is missing or expired, which is a governance event,
 * not a deleted file. Marking such an asset `missing` would delete observations
 * that are perfectly valid and merely became unreadable for a while.
 */
export class AssetForbiddenError extends Error {
  constructor(
    ref: string,
    readonly reason: string,
  ) {
    super(`access to ${ref} was refused by the source: ${reason}`);
    this.name = 'AssetForbiddenError';
  }
}

export interface DataspaceSource {
  /** Which implementation this is. Recorded on every asset it ingests. */
  readonly kind: 's3' | 'dspacer';

  /** Every asset the source currently offers. */
  list(): Promise<SourceListing>;

  /** Fetches one asset's content. Throws AssetNotFoundError / AssetForbiddenError. */
  get(ref: SourceRef): Promise<FetchedAsset>;

  /** What the asset is. Null when the source cannot tell, which the caller must report. */
  classify(entry: SourceEntry): ClassifiedAsset | null;
}

export const DATASPACE_SOURCE = Symbol('DATASPACE_SOURCE');
