import { createHash } from 'node:crypto';
import { Logger } from '@nestjs/common';
import {
  AssetForbiddenError,
  AssetNotFoundError,
  ClassifiedAsset,
  DataspaceSource,
  FetchedAsset,
  SourceEntry,
  SourceListing,
  SourceRef,
} from './dataspace-source';
import { DspacerClient, DspacerRequestError } from './dspacer.client';
import {
  DspacerRefPayload,
  isEdrTimeout,
  parseCatalog,
} from './dspacer-catalog';
import { classifyEntry } from './asset-map';

/**
 * The data space as a source for the read model.
 *
 * Listing is one catalog request per provider, so a provider that fails is
 * isolated: the rest of the space still syncs and the failure is reported as a
 * warning on the run. Losing every asset because one connector was restarting
 * would be a worse outcome than an incomplete run that says so.
 */
export class DspacerSource implements DataspaceSource {
  readonly kind = 'dspacer' as const;
  private readonly logger = new Logger(DspacerSource.name);

  constructor(
    private readonly client: DspacerClient,
    private readonly opts: {
      catalogPageSize?: number;
      /**
       * Extra attempts for a transfer whose endpoint data reference never
       * arrived. Four attempts total by default, which is what the measurement
       * of 2026-08-31 needed to recover six of seven: one asset came back on the
       * second attempt, one on the third, one on the fourth.
       */
      transferRetries?: number;
    } = {},
  ) {}

  async list(): Promise<SourceListing> {
    const warnings: string[] = [];
    const participants = await this.client.participants();
    const providers = participants.filter((p) => /provider/i.test(p.type));

    if (!providers.length) {
      return { entries: [], warnings: ['the space reports no data providers'] };
    }

    const entries: SourceEntry[] = [];
    const seen = new Map<string, string>();

    for (const provider of providers) {
      let body: unknown;
      try {
        body = await this.client.catalog(provider, {
          limit: this.opts.catalogPageSize ?? 200,
        });
      } catch (e) {
        // One unreachable provider must not empty the read model.
        warnings.push(
          `could not read the catalog of ${provider.name}: ${(e as Error).message}`,
        );
        this.logger.warn(
          `catalog request failed for ${provider.name}: ${(e as Error).message}`,
        );
        continue;
      }

      const parsed = parseCatalog(body, provider);
      warnings.push(...parsed.warnings);

      for (const entry of parsed.entries) {
        // The same asset can appear in two catalogs when a provider republishes
        // another's data. First one wins, and the collision is reported.
        const previous = seen.get(entry.ref.id);
        if (previous) {
          warnings.push(
            `asset ${entry.ref.id} is offered by both ${previous} and ${provider.name}; ${previous} was used`,
          );
          continue;
        }
        seen.set(entry.ref.id, provider.name);
        entries.push(entry);
      }
    }

    return { entries, warnings };
  }

  /**
   * Negotiates the contract for one asset and returns its content.
   *
   * There is no cheap "has this changed?" call to make first: the catalog
   * carries no version, date or checksum, so the checksum computed here is the
   * only change detector available and it necessarily comes after the transfer.
   */
  /**
   * Fetches one asset, retrying the negotiation that timed out.
   *
   * A transfer either resolves in about five seconds or fails at eighteen, and
   * the eighteen is the connector giving up on polling for the endpoint data
   * reference — not the provider refusing and not the asset being empty. That
   * was read as a permanent failure for months, and it is why the read model
   * could not be populated.
   *
   * No backoff between attempts: the failure already cost eighteen seconds of
   * waiting, which is more delay than any backoff would add, and the next
   * negotiation is independent of the one that timed out.
   */
  async get(ref: SourceRef): Promise<FetchedAsset> {
    const attempts = Math.max(1, (this.opts.transferRetries ?? 3) + 1);
    let payload: unknown;

    for (let attempt = 1; ; attempt += 1) {
      try {
        payload = await this.client.transfer(ref);
        break;
      } catch (e) {
        const translated = this.translate(ref, e);
        const retryable =
          e instanceof DspacerRequestError && isEdrTimeout(e.message);
        if (!retryable || attempt >= attempts) throw translated;
        this.logger.warn(
          `${ref.label}: no endpoint data reference after ${attempt} of ${attempts} attempts; retrying`,
        );
      }
    }

    // The connector returns the asset's content as parsed JSON. Re-serialising it
    // canonically is what makes the checksum reproducible: a checksum over bytes
    // whose key order the transport may vary would report a change on every run.
    const canonical = JSON.stringify(payload);
    return {
      ref,
      json: payload,
      checksum: createHash('sha256').update(canonical).digest('hex'),
      sizeBytes: Buffer.byteLength(canonical),
      url: null,
      etag: null,
      lastModified: null,
    };
  }

  /**
   * Maps a connector failure onto the source's vocabulary.
   *
   * The distinction that matters is refused versus absent. An expired or revoked
   * contract makes an asset unreadable without making it gone, and treating it as
   * gone would mark it missing and drop observations that are still valid.
   */
  private translate(ref: SourceRef, e: unknown): Error {
    if (!(e instanceof DspacerRequestError)) return e as Error;
    const provider =
      (ref.payload as DspacerRefPayload | undefined)?.providerName ??
      'the provider';

    if (e.status === 403) {
      return new AssetForbiddenError(
        ref.label,
        `${provider} has no active contract for this asset`,
      );
    }
    if (e.status === 404) {
      return new AssetNotFoundError(ref.label);
    }
    if (/without a resolvable data address/.test(e.message)) {
      // The contract is fine and the negotiation succeeded; the provider simply
      // publishes no data behind the asset. Not a missing asset on our side.
      return new AssetForbiddenError(
        ref.label,
        `${provider} publishes this asset without a resolvable data address (the transfer was authorised, the data plane returned 404)`,
      );
    }
    return e;
  }

  classify(entry: SourceEntry): ClassifiedAsset | null {
    return classifyEntry(entry).classified;
  }

  /** Classification with the reason, for the sync to report. */
  classifyWithReason(entry: SourceEntry): ReturnType<typeof classifyEntry> {
    return classifyEntry(entry);
  }

  /** Whether the connector is answering, checked before a scan. */
  healthy(): Promise<boolean> {
    return this.client.healthy();
  }
}
