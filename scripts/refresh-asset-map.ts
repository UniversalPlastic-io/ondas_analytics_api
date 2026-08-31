import 'dotenv/config';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DspacerClient } from '../src/api-v1/dataspace/source/dspacer.client';
import { DspacerSource } from '../src/api-v1/dataspace/source/dspacer.source';
import {
  ASSET_MAP,
  providerFolderFor,
  suggestMapping,
} from '../src/api-v1/dataspace/source/asset-map';
import { STATIONS } from '../src/api-v1/dataspace/dataspace.constants';
import {
  DSPACER_BASE_URL,
  DSPACER_LOGIN_URL,
  DSPACER_PASSWORD,
  DSPACER_USER,
  dspacerConfigured,
} from '../src/api-v1/dataspace/dataspace.constants';

/**
 * Rewrites ASSET_MAP from what the data space currently offers.
 *
 * Assets are republished under new ids — a platform data-loss incident had every
 * dataset re-uploaded with a `_v1.1` suffix — so the table is generated, never
 * transcribed. What makes it trustworthy is that the result is committed: the
 * diff shows exactly which asset changed identity and how it was classified,
 * and a wrong inference is caught in review rather than in a dashboard.
 *
 *   npm run assets:refresh              # report only
 *   npm run assets:refresh -- --write   # rewrite asset-map.ts
 *
 * Anything the heuristic cannot place is listed and left out. Add those by hand.
 */

const MAP_FILE = join(
  __dirname,
  '..',
  'src',
  'api-v1',
  'dataspace',
  'source',
  'asset-map.ts',
);

interface Row {
  id: string;
  name: string;
  provider: string;
  providerFolder: string;
  datasetType: string;
  ocean: string;
  place: string;
}

function renderMap(rows: Row[], nonData: Array<{ id: string; name: string }>): string {
  const byProvider = new Map<string, Row[]>();
  for (const r of [...rows].sort((a, b) =>
    a.providerFolder === b.providerFolder
      ? a.datasetType === b.datasetType
        ? a.place.localeCompare(b.place)
        : a.datasetType.localeCompare(b.datasetType)
      : a.providerFolder.localeCompare(b.providerFolder),
  )) {
    const list = byProvider.get(r.providerFolder) ?? [];
    list.push(r);
    byProvider.set(r.providerFolder, list);
  }

  const lines: string[] = [
    '/** Datasets, by asset id. Regenerate with `npm run assets:refresh -- --write`. */',
    'export const ASSET_MAP: Record<string, MappedAsset> = {',
  ];
  for (const [folder, list] of byProvider) {
    lines.push('');
    lines.push(`  // ---- ${folder}`);
    for (const r of list) {
      lines.push(
        `  '${r.id}': { datasetType: '${r.datasetType}', ocean: '${r.ocean}', ` +
          `place: '${r.place}', providerFolder: '${r.providerFolder}', name: ${JSON.stringify(r.name)} },`,
      );
    }
  }
  lines.push('};');
  lines.push('');
  lines.push('/**');
  lines.push(' * Schema and metadata assets. They are published in the same catalogs as the');
  lines.push(' * datasets and are not data: ingesting them would create assets with no');
  lines.push(' * observations and no location.');
  lines.push(' */');
  lines.push('export const NON_DATA_ASSETS: Record<string, string> = {');
  for (const n of [...nonData].sort((a, b) => a.name.localeCompare(b.name))) {
    lines.push(`  '${n.id}': ${JSON.stringify(n.name)},`);
  }
  lines.push('};');
  return lines.join('\n');
}

async function main(): Promise<void> {
  if (!dspacerConfigured()) {
    throw new Error(
      'DSPACER_BASE_URL, DSPACER_LOGIN_URL, DSPACER_USER and DSPACER_PASSWORD must be set',
    );
  }
  const write = process.argv.includes('--write');

  const source = new DspacerSource(
    new DspacerClient({
      baseUrl: DSPACER_BASE_URL,
      loginUrl: DSPACER_LOGIN_URL,
      usuario: DSPACER_USER,
      password: DSPACER_PASSWORD,
    }),
  );

  const { entries, warnings } = await source.list();
  for (const w of warnings) console.log(`! ${w}`);
  console.log(`\n${entries.length} assets offered to us\n`);

  const rows: Row[] = [];
  const nonData: Array<{ id: string; name: string }> = [];
  const unresolved: Array<{ id: string; name: string; provider: string }> = [];

  for (const entry of entries) {
    const name = entry.ref.label;
    if (/^(esquema_datos|metadatos)/i.test(name.trim().toLowerCase())) {
      nonData.push({ id: entry.ref.id, name });
      continue;
    }
    const hint = suggestMapping(name);
    if (!hint.datasetType || !hint.place) {
      unresolved.push({ id: entry.ref.id, name, provider: entry.provider });
      continue;
    }
    rows.push({
      id: entry.ref.id,
      name,
      provider: entry.provider,
      providerFolder: providerFolderFor(entry.provider),
      datasetType: hint.datasetType,
      ocean: STATIONS[hint.place].ocean,
      place: hint.place,
    });
  }

  const known = new Set(Object.keys(ASSET_MAP));
  const added = rows.filter((r) => !known.has(r.id));
  const removed = [...known].filter((id) => !rows.some((r) => r.id === id));

  console.log(`resolved ${rows.length}  ·  non-data ${nonData.length}  ·  unresolved ${unresolved.length}`);
  console.log(`new ids ${added.length}  ·  ids no longer offered ${removed.length}\n`);

  for (const r of added) console.log(`  + ${r.datasetType.padEnd(28)} ${r.place.padEnd(10)} ${r.name}`);
  for (const id of removed) console.log(`  - ${ASSET_MAP[id].name} (${id})`);
  for (const u of unresolved) {
    console.log(`  ? ${u.provider}: "${u.name}" (${u.id}) — no reliable hint, add it by hand`);
  }

  if (!write) {
    console.log('\nReport only. Re-run with --write to rewrite asset-map.ts, then review the diff.');
    return;
  }

  const current = await readFile(MAP_FILE, 'utf8');
  const start = current.indexOf('/** Datasets, by asset id.');
  const endMarker = 'export const NON_DATA_ASSETS: Record<string, string> = {';
  const end = current.indexOf('};', current.indexOf(endMarker)) + 2;
  if (start < 0 || end < 2) {
    throw new Error('could not locate the generated block in asset-map.ts; refusing to rewrite');
  }
  await writeFile(
    MAP_FILE,
    current.slice(0, start) + renderMap(rows, nonData) + current.slice(end),
    'utf8',
  );
  console.log(`\nRewrote ${MAP_FILE}. Review the diff, then run the tests.`);

  // Losing an asset silently is the failure this whole table exists to prevent.
  if (unresolved.length) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
