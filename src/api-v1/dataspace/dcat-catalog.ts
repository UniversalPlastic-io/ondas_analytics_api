import { Logger } from '@nestjs/common';
import { DatasetType } from './dataspace.constants';
import { SpaceDcatLoader } from './validate-dcat';
import { DataspaceSource, SourceEntry } from './source/dataspace-source';
import { dcatAssetIdsByType } from './source/asset-map';

/**
 * The DCAT documents the providers publish, read from the space.
 *
 * Each provider publishes one schema document per dataset alongside the dataset
 * itself. Those documents are the authority on what columns a dataset declares,
 * and until now the validator could not read them: it used the copies bundled in
 * `metadata/DCAT/`, which are a snapshot that can drift, and which do not exist
 * at all for `atmosfera_previa_evento` or `oceanografia_previa_evento` — whose
 * columns have therefore never been checked against anything.
 *
 * **Scoped to one sync run, deliberately.** It is built from the listing the run
 * already fetched, so it costs no extra catalog call, and it is thrown away with
 * the run. That is what makes a newly published schema visible on the next sync
 * without any cache invalidation: there is nothing to invalidate. Within a run
 * each document is fetched at most once, which is the scope where re-fetching
 * would be pure waste — a scan validates thirty assets across eight types.
 *
 * Failure is never fatal. A document that cannot be fetched leaves the bundled
 * copy to answer, and the reason is collected in `warnings()` for the run record
 * rather than raised: a schema this validator could not read is not a reason to
 * refuse a dataset that is otherwise fine.
 */
export class SpaceDcatCatalog {
  private readonly logger = new Logger(SpaceDcatCatalog.name);

  /** Fetched documents, and the nulls, so a failure is not retried per asset. */
  private readonly documents = new Map<
    DatasetType,
    { id: string; raw: unknown } | null
  >();

  private readonly problems: string[] = [];

  private readonly byType: Partial<Record<DatasetType, string>>;

  constructor(
    private readonly source: DataspaceSource,
    private readonly entries: SourceEntry[],
  ) {
    this.byType = dcatAssetIdsByType();
  }

  /** The loader shape `validateAgainstDcat` takes. */
  loader(): SpaceDcatLoader {
    return (datasetType) => this.rawFor(datasetType);
  }

  /**
   * The published DCAT for a type, or null when the space has none to give.
   *
   * Null covers four different situations — no mapped asset, the asset not
   * offered to us, the transfer refused, the document unusable — and they are
   * told apart in `warnings()`, not in the return value, because every one of
   * them means the same thing to the caller: fall back to the bundled copy.
   */
  async rawFor(
    datasetType: DatasetType,
  ): Promise<{ id: string; raw: unknown } | null> {
    const cached = this.documents.get(datasetType);
    if (cached !== undefined) return cached;

    const result = await this.read(datasetType);
    this.documents.set(datasetType, result);
    return result;
  }

  private async read(
    datasetType: DatasetType,
  ): Promise<{ id: string; raw: unknown } | null> {
    const assetId = this.byType[datasetType];
    if (!assetId) {
      // Not a problem worth reporting on every run: several types have no
      // schema published yet, and the bundled copy covers six of the eight.
      return null;
    }

    const entry = this.entries.find((e) => e.ref.id === assetId);
    if (!entry) {
      this.note(
        `the DCAT mapped for "${datasetType}" (${assetId}) is not offered to us; ` +
          `it may have been unpublished or republished under a new id. ` +
          `Run \`npm run assets:refresh\` to see.`,
      );
      return null;
    }

    let json: unknown;
    try {
      json = (await this.source.get(entry.ref)).json;
    } catch (e) {
      this.note(
        `could not fetch the published DCAT for "${datasetType}" ` +
          `("${entry.ref.label}"): ${(e as Error).message}`,
      );
      return null;
    }

    if (!json || typeof json !== 'object') {
      this.note(
        `the published DCAT for "${datasetType}" ("${entry.ref.label}") is not a JSON object`,
      );
      return null;
    }

    return { id: entry.ref.label, raw: json };
  }

  /** Types whose schema this catalog can serve, as far as the table says. */
  mappedTypes(): DatasetType[] {
    return Object.keys(this.byType) as DatasetType[];
  }

  /** What went wrong, once per type rather than once per asset. */
  warnings(): string[] {
    return [...this.problems];
  }

  private note(message: string): void {
    this.problems.push(message);
    this.logger.warn(message);
  }
}
