import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { ApiV1Module } from '../src/api-v1/api-v1.module';
import { MetricsModule } from '../src/metrics/metrics.module';
import { Asset } from '../src/api-v1/dataspace/schemas/asset.schema';
import { Observation } from '../src/api-v1/dataspace/schemas/observation.schema';
import { SyncRun } from '../src/api-v1/dataspace/schemas/sync-run.schema';
import { Organization } from '../src/api-v1/identity/schemas/organization.schema';
import { User } from '../src/api-v1/identity/schemas/user.schema';

/**
 * Writes docs/openapi.json from the decorators on the controllers.
 *
 *   npm run openapi:generate
 *
 * The Mongoose models are replaced with inert stubs, so the specification can be
 * regenerated without a database and in CI. The document only depends on the
 * decorators, never on data.
 *
 * Deliberately does not reproduce main.ts's `addServer` calls, which depend on
 * PUBLIC_API_BASE_PATH: the committed specification would otherwise change
 * according to whose environment generated it.
 */

const OUT = join(__dirname, '..', 'docs', 'openapi.json');

const inertModel = () => ({
  find: () => ({ exec: async () => [] }),
  findOne: () => ({ exec: async () => null }),
  findById: () => ({ exec: async () => null }),
  countDocuments: () => ({ exec: async () => 0 }),
  aggregate: () => ({ exec: async () => [] }),
});

async function main(): Promise<void> {
  const builder = Test.createTestingModule({
    imports: [MetricsModule, ApiV1Module],
  });
  for (const schema of [Asset, Observation, SyncRun, Organization, User]) {
    builder.overrideProvider(getModelToken(schema.name)).useValue(inertModel());
  }

  const testingModule = await builder.compile();
  const app = testingModule.createNestApplication({ logger: false });
  await app.init();

  const config = new DocumentBuilder()
    .setTitle('Analytics API of ONDAs DataSpace')
    .setDescription(
      'Documentación del API de analíticas. Los nombres de los campos se mantienen en inglés. ' +
        'POST /v1/auth/login devuelve JWT; usar cabecera Authorization: Bearer (token) en POST /v1/analyses/run.',
    )
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Token de POST /v1/auth/login',
      },
      'portal-jwt',
    )
    .addServer('/')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  await writeFile(OUT, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  await app.close();

  const paths = Object.keys(document.paths ?? {});
  const operations = paths.reduce(
    (total, path) =>
      total +
      Object.keys((document.paths as Record<string, object>)[path]).length,
    0,
  );
  console.log(`${OUT}\n${paths.length} paths, ${operations} operations`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
