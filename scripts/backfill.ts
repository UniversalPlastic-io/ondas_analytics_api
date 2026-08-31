import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { SyncService } from '../src/api-v1/dataspace/sync.service';

/**
 * Fills Mongo from the data space catalog.
 *
 * Runs the same scan the API exposes, as an admin actor, so a fresh cluster can
 * be populated before the read endpoints are pointed at it.
 *
 *   npm run backfill                        # every provider the space offers us
 *   npm run backfill -- --dry-run
 *   npm run backfill -- --force --provider innoceana
 */
async function main() {
  const args = process.argv.slice(2);
  const flag = (name: string) => args.includes(`--${name}`);
  const value = (name: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['log', 'warn', 'error'] });
  const sync = app.get(SyncService);

  const summary = await sync.scan({
    provider: value('provider'),
    dryRun: flag('dry-run'),
    force: flag('force'),
    actor: { userId: null, organizationId: null, role: 'admin' },
  });

  console.log('\n=== backfill ===');
  console.log(`run ${summary.runId} — ${summary.status}`);
  console.log('totals:', JSON.stringify(summary.totals));
  for (const w of summary.warnings) console.log(`! ${w}`);
  console.log('');
  for (const r of summary.results) {
    const detail =
      r.action === 'failed'
        ? `  ERROR ${r.error}`
        : `  ${r.observations ?? 0} obs${r.warnings?.length ? `, ${r.warnings.length} warnings` : ''}`;
    console.log(`${r.action.padEnd(10)} ${r.label ?? r.sourceId}${detail}`);
  }
  console.log('');

  await app.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
