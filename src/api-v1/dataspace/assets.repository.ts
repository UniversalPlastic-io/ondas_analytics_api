import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, QueryFilter, Types } from 'mongoose';
import { Asset, AssetDocument, AssetTier } from './schemas/asset.schema';

export interface AssetFilter {
  /**
   * Observed data or the calibration series. Reads that answer "what was
   * measured" pass 'observed'; the analytics fallback is the only caller that
   * asks for 'reference'. Omit to include both.
   */
  tier?: AssetTier;
  ocean?: string;
  datasetType?: string;
  category?: string;
  /** Matches the raw provider id in the file or the S3 provider folder in the key. */
  provider?: string;
  /**
   * Excludes a provider, matched the same two ways as `provider`. Used to keep
   * the reference datasets out of the reads that answer "what was measured".
   */
  excludeProvider?: string;
  organizationId?: string | null;
  /** Defaults to 'active'. Pass 'any' to include missing/failed assets. */
  status?: 'active' | 'missing' | 'failed' | 'any';
}

/**
 * Matches a provider by the id it declares in its data or by the participant it
 * was published under.
 *
 * Both are stored fields. Neither is derived from an identifier at query time,
 * which is what a third clause here used to do — a regex over the object key —
 * and what made provider matching silently stop working for any asset that had no
 * path.
 */
function providerClauses(provider: string): Array<QueryFilter<Asset>> {
  return [{ dataProviderIdRaw: provider }, { providerFolder: provider }];
}

/**
 * The Mongo query one filter describes. Exported so the filter semantics can be
 * asserted without a database.
 */
export function assetQuery(filter: AssetFilter = {}): QueryFilter<Asset> {
  const q: QueryFilter<Asset> = {};
  if (filter.status !== 'any') q.status = filter.status ?? 'active';
  if (filter.tier) q.tier = filter.tier;
  if (filter.ocean) q.ocean = filter.ocean;
  if (filter.datasetType) q.datasetType = filter.datasetType;
  if (filter.category) q.category = filter.category;
  if (filter.organizationId)
    q.organizationId = new Types.ObjectId(filter.organizationId);
  if (filter.provider) {
    q.$or = providerClauses(filter.provider);
  }
  if (filter.excludeProvider) {
    // $nor, not a negated $or: `provider` may already own $or on this query.
    q.$nor = providerClauses(filter.excludeProvider);
  }
  return q;
}

/**
 * Ocean recorded for output that could not be placed.
 *
 * Generated artefacts are filed under the basin they describe. When the read
 * model cannot place a point — an empty database, or a request far from any
 * observed asset — the artefact goes here rather than into a real basin. A
 * wrong-but-plausible folder is worse than an obviously unplaced one: it is
 * indistinguishable from correct output.
 */
export const UNPLACED_OCEAN = 'sin-ubicar';

/** Reads the asset inventory. */
@Injectable()
export class AssetsRepository {
  constructor(@InjectModel(Asset.name) private readonly assets: Model<Asset>) {}

  private queryOf(filter: AssetFilter = {}): QueryFilter<Asset> {
    return assetQuery(filter);
  }

  find(filter: AssetFilter = {}): Promise<AssetDocument[]> {
    return this.assets
      .find(this.queryOf(filter))
      .sort({ ocean: 1, category: 1, place: 1 })
      .exec();
  }

  count(filter: AssetFilter = {}): Promise<number> {
    return this.assets.countDocuments(this.queryOf(filter)).exec();
  }

  /** Assets whose key contains any of these fragments (campaign → files mapping). */
  /**
   * Assets at any of the given places.
   *
   * Replaces a regex over the object key with a match on an indexed field. The
   * old form tied a report's scope to a filename convention in a bucket, so a
   * renamed file silently emptied a campaign.
   */
  findByPlaces(
    places: string[],
    filter: AssetFilter = {},
  ): Promise<AssetDocument[]> {
    if (!places.length) return Promise.resolve([]);
    return this.assets
      .find({ ...this.queryOf(filter), place: { $in: places } })
      .exec();
  }

  /** One asset by the id its provider's connector assigned. */
  findBySourceId(sourceId: string): Promise<AssetDocument | null> {
    return this.assets.findOne({ sourceId }).exec();
  }

  findById(id: string): Promise<AssetDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.assets.findById(id).exec();
  }

  /**
   * The ocean basin a point belongs to, taken from the nearest observed asset.
   *
   * This used to be decided by a table of twelve coordinates with the basin
   * parsed back out of a hardcoded storage URL, which meant generated output was
   * filed according to a copy of the inventory that nothing kept in step with
   * the real one. The read model already knows where every asset is.
   *
   * Returns null when nothing can place the point, so the caller decides what to
   * do rather than being handed a default that looks like an answer.
   */
  async oceanFor(loc: { lat: number; lon: number }): Promise<string | null> {
    const nearest = await this.nearest({ tier: 'observed' }, loc);
    return nearest?.ocean ?? null;
  }

  /**
   * Closest active asset of a type to a point, by real spherical distance.
   * This is the DB-side replacement for the in-process nearest-neighbour scan
   * the old S3 loader ran over a hardcoded catalogue.
   */
  async nearest(
    filter: AssetFilter,
    loc: { lat: number; lon: number },
  ): Promise<AssetDocument | null> {
    const [nearest] = await this.assets
      .find({
        ...this.queryOf(filter),
        location: {
          $near: {
            $geometry: { type: 'Point', coordinates: [loc.lon, loc.lat] },
          },
        },
      })
      .limit(1)
      .exec();
    return nearest ?? null;
  }

  /** Bounding box over a set of assets: [[minLat,minLng],[maxLat,maxLng]]. */
  static bounds(
    assets: AssetDocument[],
  ): [[number, number], [number, number]] | null {
    if (!assets.length) return null;
    let minLat = Infinity;
    let minLng = Infinity;
    let maxLat = -Infinity;
    let maxLng = -Infinity;
    for (const a of assets) {
      const [lng, lat] = a.location.coordinates;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    }
    return [
      [minLat, minLng],
      [maxLat, maxLng],
    ];
  }
}
