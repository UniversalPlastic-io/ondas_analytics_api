import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import type { Model, Types } from 'mongoose';
import { AppModule } from '../src/app.module';
import { AnalysesService } from '../src/api-v1/analyses/analyses.service';
import { Asset } from '../src/api-v1/dataspace/schemas/asset.schema';
import { Observation } from '../src/api-v1/dataspace/schemas/observation.schema';
import { publicUrlForKey } from '../src/api-v1/dataspace/dataspace.constants';
import type { AnalysesRunResponse } from '../src/api-v1/analyses/analyses.types';

/**
 * Produces the figures published in docs/validacion-precision.md.
 *
 *   npm run validate:precision
 *   npm run validate:precision -- --json informe.json
 *
 * What this measures, and what it deliberately does not
 * -----------------------------------------------------
 * There is no ground truth of plastic contamination at an arbitrary point of the
 * Mediterranean, so "accuracy against reality" is not a quantity this or any
 * other script can produce. What is measurable, and what this script reports:
 *
 *   1. Ingest fidelity   — does every published record reach the read model intact?
 *   2. Aggregation exactness — do the statistics the API reports match the series
 *      it reports them from, recomputed independently here?
 *   3. Reproducibility   — same request, same answer.
 *   4. Query coverage    — how much of a query grid is answered from observed data
 *      rather than falling back to the calibration series.
 *   5. Cross-source concordance — agreement between two independent analytical
 *      workflows measuring related quantities. Reported as context, not as a score.
 *
 * Metric 2 validates the statistical layer, not dataset selection; metric 1 is
 * what covers the path from the published file to the read model.
 */

/** The API publishes its scalars rounded; comparing beyond that is meaningless. */
const round = (x: number, decimals: number) => Number(x.toFixed(decimals));

/** Query points over the areas where participants publish. */
const GRID: Array<{ name: string; lat: number; lon: number }> = [
  { name: 'Badalona', lat: 41.4469, lon: 2.2475 },
  { name: 'Barcelona', lat: 41.3874, lon: 2.1686 },
  { name: 'Tenerife', lat: 28.1876, lon: -16.6596 },
  { name: 'Gijón', lat: 43.5322, lon: -5.6611 },
  { name: 'Mediterráneo abierto', lat: 40.5, lon: 2.5 },
  { name: 'Costa Brava', lat: 41.9, lon: 3.16 },
];

const RANGE = { start: '2025-01-01', end: '2025-12-31' };
const AREA = { type: 'radius_km' as const, value: 25 };

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * Sample standard deviation (n-1), which is the convention the API uses.
 *
 * Getting this wrong is not academic: with the population form (n) the check
 * disagreed with the API in the third decimal on some points and looked like a
 * defect in the API rather than in the check.
 */
function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

/** True when the API value equals the recomputed one at the precision it publishes. */
const matches = (reported: number, recomputed: number, decimals: number) =>
  Number.isFinite(reported) &&
  Number.isFinite(recomputed) &&
  reported === round(recomputed, decimals);

/**
 * Observations a published container should yield.
 *
 * Not simply the record count: the pre-event datasets nest a window inside each
 * event (`{ dateRange, recordCount, records }`), and the ingest writes one
 * document per day of that window. Counting top-level records there would
 * report an eightfold loss that is not happening.
 */
function expectedObservations(dataset: unknown): number | null {
  const d = dataset as {
    records?: Record<string, unknown>[];
    columns?: Record<string, unknown[]>;
  };

  if (Array.isArray(d?.records)) {
    let total = 0;
    for (const record of d.records) {
      const nested = Object.values(record).find(
        (v): v is { records?: unknown[] } =>
          !!v &&
          typeof v === 'object' &&
          !Array.isArray(v) &&
          Array.isArray((v as { records?: unknown[] }).records),
      );
      total += nested?.records?.length ?? 1;
    }
    return total;
  }

  if (d?.columns && typeof d.columns === 'object') {
    const first = Object.values(d.columns).find(Array.isArray) as
      | unknown[]
      | undefined;
    return first ? first.length : null;
  }
  return null;
}

/** Records the ingest reports as deliberately skipped, with the reason recorded. */
function skippedWithWarning(warnings: string[] | undefined): number {
  let total = 0;
  for (const w of warnings ?? []) {
    const m = /(\d+)\s+records?\s+skipped/i.exec(w);
    if (m) total += Number(m[1]);
  }
  return total;
}

type Check = { name: string; passed: boolean; detail: string };

async function main() {
  const args = process.argv.slice(2);
  const jsonAt = args.indexOf('--json');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  const assets = app.get<Model<Asset>>(getModelToken(Asset.name));
  const observations = app.get<Model<Observation>>(
    getModelToken(Observation.name),
  );
  const analyses = app.get(AnalysesService);

  const report: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    range: RANGE,
  };

  // ---------------------------------------------------------------- 1. Ingesta
  const active = await assets
    .find({ status: 'active', tier: 'observed' })
    .lean()
    .exec();

  const fidelity: Array<{
    key: string;
    expected: number | null;
    stored: number;
    skipped: number;
    ok: boolean;
  }> = [];

  for (const asset of active) {
    const a = asset as unknown as {
      key: string;
      currentIngestId?: Types.ObjectId;
      _id: Types.ObjectId;
      warnings?: string[];
    };
    let expected: number | null = null;
    try {
      const res = await fetch(publicUrlForKey(a.key));
      if (res.ok)
        expected = expectedObservations(
          ((await res.json()) as { dataset?: unknown }).dataset,
        );
    } catch {
      expected = null;
    }
    const stored = await observations.countDocuments({
      assetId: a._id,
      ingestId: a.currentIngestId,
    });
    const skipped = skippedWithWarning(a.warnings);

    // Fidelity is about *unexplained* loss. A record the ingest refused and said
    // so about — an unparseable date, say — is the system working, and the defect
    // is in the published file, not here.
    fidelity.push({
      key: a.key,
      expected,
      stored,
      skipped,
      ok: expected !== null && stored + skipped === expected,
    });
  }

  const comparable = fidelity.filter((f) => f.expected !== null);
  const intact = comparable.filter((f) => f.ok);
  report.ingestFidelity = {
    assets: fidelity.length,
    comparable: comparable.length,
    intact: intact.length,
    percent: comparable.length
      ? (100 * intact.length) / comparable.length
      : null,
    skippedWithWarning: comparable.reduce((a, f) => a + f.skipped, 0),
    mismatches: comparable.filter((f) => !f.ok),
  };

  // --------------------------------------------- 2, 3, 4, 5. Sobre la analítica
  const checks: Check[] = [];
  const coverage: Array<{
    name: string;
    datasetsUsed: Record<string, number>;
    observed: boolean;
  }> = [];
  const concordance: Array<{
    name: string;
    buoyVsWater: number | null;
    waterVsFish: number | null;
  }> = [];

  for (const point of GRID) {
    const run = (await analyses.run({
      location: { lat: point.lat, lon: point.lon },
      area: AREA,
      analyses: ['all'],
      dateRange: RANGE,
      options: { dataFormattedForPlots: true, cache: { mode: 'bypass' } },
    })) as AnalysesRunResponse;

    const plots = run.dataFormattedForPlots?.plots;

    // 2. The statistics the API reports must match the series it reports them from.
    const series = plots?.['2_microplasticsOverTime']?.mpPerL ?? [];
    const summary = plots?.['11_basicContaminationSummary'];
    if (series.length > 0 && summary) {
      const expectedMean = mean(series);
      const expectedStd = std(series);
      const expectedCv = expectedStd / expectedMean;
      checks.push({
        name: `${point.name} · media de mp/L`,
        passed: matches(summary.meanMpPerL, expectedMean, 3),
        detail: `API ${summary.meanMpPerL} · recalculado ${round(expectedMean, 3)}`,
      });
      checks.push({
        name: `${point.name} · desviación de mp/L`,
        passed: matches(summary.stdMpPerL, expectedStd, 3),
        detail: `API ${summary.stdMpPerL} · recalculado ${round(expectedStd, 3)}`,
      });
      checks.push({
        name: `${point.name} · coeficiente de variación`,
        passed: matches(summary.cvMpPerL, expectedCv, 4),
        detail: `API ${summary.cvMpPerL} · recalculado ${round(expectedCv, 4)}`,
      });
    }

    // 2b. Jaccard reported by the API against the same set operation done here.
    const conc = plots?.['12_buoyVsWaterConcordance'];
    if (conc) {
      const a = new Set(conc.buoyPolymers);
      const b = new Set(conc.waterPolymers);
      const inter = [...a].filter((x) => b.has(x)).length;
      const union = new Set([...a, ...b]).size;
      const expected = union === 0 ? 0 : (100 * inter) / union;
      checks.push({
        name: `${point.name} · índice de Jaccard boya/agua`,
        passed: matches(conc.overlapPercent, expected, 1),
        detail: `API ${conc.overlapPercent}% · recalculado ${round(expected, 1)}%`,
      });
    }

    // 3. Reproducibility: same request, same answer, caching out of the way.
    const again = (await analyses.run({
      location: { lat: point.lat, lon: point.lon },
      area: AREA,
      analyses: ['all'],
      dateRange: RANGE,
      options: { dataFormattedForPlots: true, cache: { mode: 'bypass' } },
    })) as AnalysesRunResponse;
    checks.push({
      name: `${point.name} · reproducibilidad`,
      passed: JSON.stringify(again.results) === JSON.stringify(run.results),
      detail: 'dos ejecuciones consecutivas con caché desactivada',
    });

    // 4. Coverage: answered from observed data, or from the calibration series?
    const used =
      (run.meta as { datasetsUsed?: Record<string, number> }).datasetsUsed ??
      {};
    coverage.push({
      name: point.name,
      datasetsUsed: used,
      observed: Object.values(used).some((n) => n > 0),
    });

    // 5. Cross-source agreement, reported as-is.
    concordance.push({
      name: point.name,
      buoyVsWater: conc?.overlapPercent ?? null,
      waterVsFish:
        plots?.['13_waterVsFishPolymerSimilarity']?.pearson_r ?? null,
    });
  }

  report.checks = checks;
  report.coverage = coverage;
  report.concordance = concordance;

  // ------------------------------------------------------------------- Salida
  const passed = checks.filter((c) => c.passed).length;
  const pct = (n: number, d: number) => (d ? ((100 * n) / d).toFixed(2) : '—');

  console.log('\n=== 1. Fidelidad de ingesta ===');
  console.log(
    `${intact.length}/${comparable.length} activos íntegros (${pct(intact.length, comparable.length)} %)`,
  );
  for (const m of comparable.filter((f) => !f.ok)) {
    console.log(
      `  ! ${m.key}: esperado ${m.expected}, almacenado ${m.stored}, descartado con aviso ${m.skipped}`,
    );
  }
  const explained = comparable.filter((f) => f.skipped > 0);
  for (const e of explained) {
    console.log(
      `  · ${e.key}: ${e.skipped} registro(s) descartados por la ingesta, con aviso registrado`,
    );
  }
  const unreachable = fidelity.length - comparable.length;
  if (unreachable > 0)
    console.log(
      `  (${unreachable} activos no descargables, excluidos del cálculo)`,
    );

  console.log('\n=== 2-3. Exactitud de agregación y reproducibilidad ===');
  console.log(
    `${passed}/${checks.length} comprobaciones superadas (${pct(passed, checks.length)} %)`,
  );
  for (const c of checks.filter((c) => !c.passed))
    console.log(`  ! ${c.name}: ${c.detail}`);

  console.log('\n=== 4. Cobertura de consulta ===');
  const observed = coverage.filter((c) => c.observed).length;
  console.log(
    `${observed}/${coverage.length} puntos con dato observado (${pct(observed, coverage.length)} %)`,
  );
  for (const c of coverage) {
    console.log(
      `  ${c.observed ? '·' : '!'} ${c.name}: ${JSON.stringify(c.datasetsUsed)}`,
    );
  }

  console.log('\n=== 5. Concordancia entre fuentes independientes ===');
  for (const c of concordance) {
    console.log(
      `  ${c.name}: boya/agua ${c.buoyVsWater ?? '—'}% · agua/peces r=${c.waterVsFish ?? '—'}`,
    );
  }
  console.log('');

  if (jsonAt >= 0 && args[jsonAt + 1]) {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(args[jsonAt + 1], JSON.stringify(report, null, 2));
    console.log(`Informe en ${args[jsonAt + 1]}\n`);
  }

  await app.close();
  // A failed check is a real regression: make it visible to CI.
  process.exit(
    passed === checks.length && intact.length === comparable.length ? 0 : 1,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
