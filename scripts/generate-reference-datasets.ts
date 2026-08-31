/**
 * Writes the reference datasets to disk.
 *
 *   npm run reference:generate
 *   npm run reference:generate -- --start 2024-01-01 --end 2026-12-31
 *
 * Generation is deterministic, so running it twice produces identical files.
 * Publishing them is a separate, deliberate act: upload each file as an asset in
 * the data space under the Universal Plastic connector, give it a policy and a
 * contract, then ingest it like any other asset:
 *
 *   POST /v1/sync/scan
 *   POST /v1/sync/assets   ({ "sourceId": "<asset id from the catalog>" })
 */

import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  buildReferenceDatasets,
  REFERENCE_RANGE,
  ReferenceRange,
} from '../src/api-v1/dataspace/reference-datasets';

function flag(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return null;
  const value = process.argv[i + 1];
  return value && !value.startsWith('--') ? value : '';
}

function parseRange(): ReferenceRange {
  const start = flag('start') || REFERENCE_RANGE.start;
  const end = flag('end') || REFERENCE_RANGE.end;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    throw new Error(`--start/--end must be YYYY-MM-DD (got ${start} / ${end})`);
  }
  if (start > end) throw new Error(`--start ${start} is after --end ${end}`);
  return { start, end };
}

async function main(): Promise<void> {
  const range = parseRange();
  const outDir = flag('out') || join(process.cwd(), 'output', 'reference');

  const files = buildReferenceDatasets(range);
  console.log(`Reference datasets for ${range.start} → ${range.end}\n`);

  for (const file of files) {
    const body = `${JSON.stringify(file.body, null, 2)}\n`;
    const path = join(outDir, file.filename);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body, 'utf8');
    const records = (file.body.metadata as { recordCount: number }).recordCount;
    console.log(`  ${file.filename}  ${records} records, ${(body.length / 1024).toFixed(0)} KB`);
    console.log(`    → ${path}`);
  }

  console.log(
    `\nWritten to ${outDir}. Publish each file as an asset in the data space, ` +
      `then ingest it with POST /v1/sync/scan.`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
