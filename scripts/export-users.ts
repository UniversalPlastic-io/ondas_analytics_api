import 'dotenv/config';
import * as fs from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { IdentityService } from '../src/api-v1/identity/identity.service';

/**
 * Exports the user and organization roster.
 *
 * Passwords are NOT included and cannot be: only bcrypt hashes are stored, and
 * a hash cannot be reversed. To give someone a working password, reset it —
 *   npm run users:reset -- --email someone@example.org
 * — which prints the new one once.
 *
 *   npm run users:export                 # table on stdout
 *   npm run users:export -- --csv out.csv
 */
async function main() {
  const args = process.argv.slice(2);
  const csvPath = args.includes('--csv') ? args[args.indexOf('--csv') + 1] : null;

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const identity = app.get(IdentityService);

  const orgs = await identity.listOrganizations();
  const orgById = new Map(orgs.map((o) => [String(o._id), o]));
  const users = await identity.listUsers();

  const rows = users.map((u) => {
    const org = u.organizationId ? orgById.get(String(u.organizationId)) : null;
    return {
      email: u.email,
      name: u.name,
      role: u.role,
      organization: org?.slug ?? '',
      organizationName: org?.name ?? '',
      active: String(u.active),
      lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : '',
    };
  });

  console.log('\nROLE      ORGANIZATION        EMAIL                                               LAST LOGIN');
  console.log('-'.repeat(110));
  for (const r of rows) {
    console.log(
      `${r.role.padEnd(9)} ${r.organization.padEnd(19)} ${r.email.padEnd(51)} ${r.lastLoginAt || 'never'}`,
    );
  }
  console.log(`\n${rows.length} users across ${orgs.length} organizations.`);
  console.log('Passwords are bcrypt hashes and cannot be exported. Use "npm run users:reset" to issue a new one.\n');

  if (csvPath) {
    const header = Object.keys(rows[0] ?? { email: '' }).join(',');
    const body = rows.map((r) => Object.values(r).map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));
    fs.writeFileSync(csvPath, [header, ...body].join('\n') + '\n');
    console.log(`CSV written to ${csvPath}\n`);
  }

  await app.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
