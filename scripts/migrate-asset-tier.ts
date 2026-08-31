import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { AppModule } from '../src/app.module';
import { Asset } from '../src/api-v1/dataspace/schemas/asset.schema';
import { REFERENCE_PROVIDER_FOLDER } from '../src/api-v1/dataspace/dataspace.constants';

/**
 * Backfills `tier` and `providerFolder` on assets ingested before those fields
 * existed.
 *
 * Until this runs, those documents have no tier. That is not a cosmetic gap:
 * every read that answers "what was measured" now filters on `tier: 'observed'`,
 * so an un-migrated asset is invisible to the map, the dashboard and the
 * analytics lookup — it does not error, it just stops being there. Run this once
 * against each environment, immediately after deploying the schema change.
 *
 * Idempotent: re-running it changes nothing. Pass --dry-run to see the counts
 * without writing.
 *
 *   npx ts-node -r tsconfig-paths/register scripts/migrate-asset-tier.ts [--dry-run]
 */

/** `public/{ocean}/{providerFolder}/{file}.json` → the provider folder. */
function providerFolderOfKey(key: string): string | null {
  const segments = key.split('/');
  return segments.length >= 3 ? segments[2] : null;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const assets = app.get<Model<Asset>>(getModelToken(Asset.name));

  const pending = await assets
    .find({
      $or: [
        { tier: { $exists: false } },
        { providerFolder: { $exists: false } },
      ],
    })
    .select('key tier providerFolder')
    .lean()
    .exec();

  if (!pending.length) {
    console.log(
      'nothing to migrate — every asset already carries tier and providerFolder',
    );
    await app.close();
    return;
  }

  let observed = 0;
  let reference = 0;
  let unresolved = 0;

  for (const asset of pending) {
    const folder = providerFolderOfKey(asset.key);
    const tier =
      folder === REFERENCE_PROVIDER_FOLDER ? 'reference' : 'observed';
    if (!folder) unresolved += 1;
    if (tier === 'reference') reference += 1;
    else observed += 1;

    if (!dryRun) {
      await assets
        .updateOne(
          { _id: asset._id },
          { $set: { tier, providerFolder: folder } },
        )
        .exec();
    }
    console.log(
      `${dryRun ? 'would set' : 'set'} ${tier.padEnd(9)} ${folder ?? '(no folder)'}  ${asset.key}`,
    );
  }

  console.log(
    `\n${dryRun ? 'dry run: ' : ''}${pending.length} assets — ${observed} observed, ${reference} reference` +
      (unresolved
        ? `, ${unresolved} with no resolvable provider folder (defaulted to observed)`
        : ''),
  );

  // A key that no longer parses is a real signal, not noise: it means an asset
  // arrived by a route this migration does not understand, and its tier is a
  // guess. Say so loudly rather than reporting a clean run.
  if (unresolved) {
    console.warn(
      `\nWARNING: ${unresolved} asset(s) had no provider folder in their key. They were defaulted to 'observed'. ` +
        `Verify them before trusting the map or the dashboard.`,
    );
  }

  await app.close();
  process.exit(unresolved ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
