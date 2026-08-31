import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DspacerClient } from '../src/api-v1/dataspace/source/dspacer.client';
import { dataProviders } from '../src/api-v1/dataspace/source/dspacer-catalog';
import {
  DSPACER_BASE_URL,
  DSPACER_LOGIN_URL,
  DSPACER_PASSWORD,
  DSPACER_USER,
  dspacerConfigured,
} from '../src/api-v1/dataspace/dataspace.constants';

/**
 * Recaptures the catalog fixtures the source specs run against.
 *
 *   npm run fixtures:refresh
 *
 * The specs assert against real responses rather than hand-written ones, so a
 * republication round leaves them describing a catalog that no longer exists.
 * This recaptures them, with two substitutions: every participant's BPN becomes
 * a sequential placeholder, and every connector endpoint becomes
 * `provider-N-controlplane.example`. Nothing else is altered — the whole value
 * of a fixture is that it is what the connector actually said.
 *
 * Asset and policy ids are kept: they are the same ids `ASSET_MAP` records, and
 * a fixture with invented ids could not catch a mapping that has gone stale.
 */

const DIR = join(
  __dirname,
  '..',
  'src',
  'api-v1',
  'dataspace',
  'source',
  '__fixtures__',
);

const slug = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

function main(): Promise<void> {
  if (!dspacerConfigured()) {
    throw new Error(
      'DSPACER_BASE_URL, DSPACER_LOGIN_URL, DSPACER_USER and DSPACER_PASSWORD must be set',
    );
  }
  return run();
}

async function run(): Promise<void> {
  const client = new DspacerClient({
    baseUrl: DSPACER_BASE_URL,
    loginUrl: DSPACER_LOGIN_URL,
    usuario: DSPACER_USER,
    password: DSPACER_PASSWORD,
  });

  const participants = await client.participants();
  const providers = dataProviders(participants);

  // Substitutions, built once so every file gets the same pseudonym.
  const subs = new Map<string, string>();
  participants.forEach((p, i) => {
    const n = String(i + 1).padStart(15, '0');
    subs.set(p.bpn, `${p.bpn.slice(0, 4)}${n}`);
  });
  providers.forEach((p, i) => {
    const host = new URL(p.direction).host;
    subs.set(host, `provider-${i + 1}-controlplane.example`);
  });

  const sanitize = (value: unknown): string => {
    let text = JSON.stringify(value, null, 2);
    for (const [from, to] of subs) text = text.split(from).join(to);
    return `${text}\n`;
  };

  const bpnPath = join(DIR, 'bpn-all.json');
  writeFileSync(bpnPath, sanitize({ participants }), 'utf8');
  console.log(`${bpnPath}  (${participants.length} participants)`);

  for (const provider of providers) {
    const catalog = await client.catalog(provider, { limit: 200 });
    const datasets = (catalog as Record<string, unknown>)['dcat:dataset'];
    const count = Array.isArray(datasets) ? datasets.length : datasets ? 1 : 0;
    const path = join(DIR, `catalog-${slug(provider.name)}.json`);
    writeFileSync(path, sanitize(catalog), 'utf8');
    console.log(`${path}  (${count} datasets)`);
  }

  console.log(
    '\nReview the diff: an unexpected id change is the thing this is for.',
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
