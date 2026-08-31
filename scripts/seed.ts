import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { IdentityService } from '../src/api-v1/identity/identity.service';
import { UserRole } from '../src/api-v1/identity/schemas/user.schema';

/**
 * Creates the data space participants and their users.
 *
 * Idempotent: existing organizations and users are left alone. Passwords are
 * taken from config/portal-connectors.local.json when it exists, otherwise
 * generated and printed once — they are not recoverable afterwards.
 */

interface SeedOrg {
  slug: string;
  name: string;
  type: string;
  territory: string | null;
  providerFolders: string[];
  dataProviderIds: string[];
  legacyUsername: string;
}

const ORGS: SeedOrg[] = [
  {
    slug: 'universal_plastic',
    name: 'Universal Plastic',
    type: 'Company',
    territory: 'Spain',
    providerFolders: ['universal_plastic'],
    // Every spelling found in the live files.
    dataProviderIds: ['universal_plastic', 'universalplastic', 'universal`plastic'],
    legacyUsername: 'user_universalplastic',
  },
  {
    slug: 'innoceana',
    name: 'Innoceana',
    type: 'NGO',
    territory: 'Catalunya & Canary Islands, Spain',
    providerFolders: ['innoceana'],
    dataProviderIds: ['innoceana'],
    legacyUsername: 'user_innoceana',
  },
  {
    slug: 'port_badalona',
    name: 'Port de Badalona',
    type: 'Institution',
    territory: 'Badalona, Catalunya, Spain',
    providerFolders: ['port_badalona'],
    dataProviderIds: ['portbadalona', 'port_badalona'],
    legacyUsername: 'user_portbadalona',
  },
  {
    slug: 'gijon_surf_hostel',
    name: 'Gijón Surf Hostel',
    type: 'Company',
    territory: 'Gijón, Asturias, Spain',
    providerFolders: ['gijon_surf_hostel'],
    dataProviderIds: ['gijonsurfhostel', 'gijon_surf_hostel'],
    legacyUsername: 'user_gijonsurfhostel',
  },
  {
    slug: 'bcss',
    name: 'BCSS',
    type: 'Company',
    territory: 'Spain',
    providerFolders: ['bcss'],
    dataProviderIds: ['bcss'],
    legacyUsername: 'user_bcss',
  },
];

function connectorPasswords(): Map<string, string> {
  const rel = (process.env.PORTAL_CONNECTORS_FILE ?? 'config/portal-connectors.local.json').trim();
  const path = join(process.cwd(), rel);
  const out = new Map<string, string>();
  if (!existsSync(path)) return out;
  try {
    const file = JSON.parse(readFileSync(path, 'utf8')) as { users?: Array<{ username: string; password: string }> };
    for (const u of file.users ?? []) {
      if (u.username && u.password && u.password !== 'CHANGE_ME') out.set(u.username, u.password);
    }
  } catch {
    // A malformed legacy file just means every password is generated.
  }
  return out;
}

function generatePassword(): string {
  return randomBytes(15).toString('base64url');
}

async function main() {
  const logger = new Logger('seed');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['warn', 'error'] });
  const identity = app.get(IdentityService);
  const emailDomain = process.env.SEED_EMAIL_DOMAIN?.trim() || 'participants.universalplastic.io';
  const legacy = connectorPasswords();
  const created: Array<{ email: string; role: UserRole; password: string; org: string }> = [];

  for (const org of ORGS) {
    const existing = await identity.findOrganizationBySlug(org.slug);
    if (existing) {
      logger.log(`organization ${org.slug} already exists — skipped`);
    } else {
      await identity.createOrganization({
        slug: org.slug,
        name: org.name,
        type: org.type,
        territory: org.territory,
        dataProviderIds: org.dataProviderIds,
        providerFolders: org.providerFolders,
      });
      logger.log(`organization ${org.slug} created`);
    }

    const email = `${org.slug.replace(/_/g, '-')}@${emailDomain}`;
    if (await identity.findByLogin(email)) {
      logger.log(`user ${email} already exists — skipped`);
      continue;
    }
    const password = legacy.get(org.legacyUsername) ?? generatePassword();
    await identity.createUser({
      email,
      password,
      name: org.name,
      role: 'provider',
      organizationSlug: org.slug,
      legacyUsername: org.legacyUsername,
    });
    created.push({ email, role: 'provider', password, org: org.slug });
  }

  const adminEmail = process.env.SEED_ADMIN_EMAIL?.trim() || 'admin@universalplastic.io';
  if (await identity.findByLogin(adminEmail)) {
    logger.log(`admin ${adminEmail} already exists — skipped`);
  } else {
    const password = process.env.SEED_ADMIN_PASSWORD?.trim() || generatePassword();
    await identity.createUser({
      email: adminEmail,
      password,
      name: 'ONDAs Administrator',
      role: 'admin',
    });
    created.push({ email: adminEmail, role: 'admin', password, org: '—' });
  }

  if (created.length) {
    console.log('\nCredentials created. They are shown once — store them now.\n');
    console.log('role      organization        email'.padEnd(70) + 'password');
    console.log('-'.repeat(110));
    for (const c of created) {
      console.log(
        `${c.role.padEnd(9)} ${c.org.padEnd(19)} ${c.email.padEnd(40)} ${c.password}`,
      );
    }
    console.log('');
  } else {
    console.log('\nNothing to create — every organization and user already existed.\n');
  }

  await app.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
