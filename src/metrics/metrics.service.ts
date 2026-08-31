import { Injectable } from '@nestjs/common';
import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';

/**
 * Prometheus registry for the API.
 *
 * Every label used here is drawn from a bounded set — route templates, HTTP
 * methods, status codes, analysis ids, sync outcomes. Nothing derived from user
 * input reaches a label: a single free-form label (a raw path with an id, a
 * bucket key) would create one time series per distinct value and eventually
 * take Prometheus down.
 */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  /** Latency and count of every request that reached a controller. */
  readonly httpDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duración de las peticiones HTTP atendidas por un controlador',
    labelNames: ['method', 'route', 'status'] as const,
    // Report generation and plot rendering are seconds-scale, so the tail
    // buckets go well beyond the usual web defaults.
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
    registers: [this.registry],
  });

  /** Ingest runs, split by kind and outcome. */
  readonly syncRuns = new Counter({
    name: 'ondas_sync_runs_total',
    help: 'Ejecuciones de sincronización del espacio de datos',
    labelNames: ['kind', 'status'] as const,
    registers: [this.registry],
  });

  /** Observations written by the ingest — the volume actually materialized. */
  readonly syncObservations = new Counter({
    name: 'ondas_sync_observations_total',
    help: 'Observaciones escritas en el modelo de lectura',
    registers: [this.registry],
  });

  /** Warnings raised by validation, per sync run. */
  readonly syncWarnings = new Counter({
    name: 'ondas_sync_warnings_total',
    help: 'Avisos de validación acumulados por las ejecuciones de sincronización',
    registers: [this.registry],
  });

  /** One increment per analysis actually executed, not per request. */
  readonly analysesRuns = new Counter({
    name: 'ondas_analyses_runs_total',
    help: 'Analíticas ejecutadas, contadas una por análisis',
    labelNames: ['analysis'] as const,
    registers: [this.registry],
  });

  /**
   * Analyses published back into the space, by outcome.
   *
   * `status` is the only label, and deliberately: the interesting dimensions —
   * which point, which cache key — are exactly the ones that would create a new
   * time series per report and eventually take Prometheus down.
   */
  readonly reportsPublished = new Counter({
    name: 'ondas_reports_published_total',
    help: 'Análisis publicados como activo en el catálogo del espacio de datos',
    labelNames: ['status'] as const,
    registers: [this.registry],
  });

  /** How long publishing took. Three connector calls, so seconds-scale. */
  readonly reportPublishDuration = new Histogram({
    name: 'ondas_report_publish_duration_seconds',
    help: 'Duración de la publicación de un análisis en el espacio de datos',
    buckets: [0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
    registers: [this.registry],
  });

  /** Supplies the active-asset count; set by whoever owns the read model. */
  private activeAssetsSource: (() => Promise<number>) | null = null;

  /** Active assets in the read model. Refreshed on scrape, not on a timer. */
  readonly activeAssets = new Gauge({
    name: 'ondas_assets_active',
    help: 'Activos del espacio de datos vigentes en el modelo de lectura',
    registers: [this.registry],
    collect: async () => {
      if (!this.activeAssetsSource) return;
      try {
        this.activeAssets.set(await this.activeAssetsSource());
      } catch {
        // A scrape must never be the thing that reports the database is down:
        // the previous value ships and the rest of the metrics still render.
      }
    },
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry, prefix: 'ondas_' });
  }

  recordSyncRun(run: {
    kind: string;
    status: string;
    totals?: Record<string, number>;
    warnings?: unknown[];
  }): void {
    this.syncRuns.inc({ kind: run.kind, status: run.status });
    const observations = run.totals?.observations ?? 0;
    if (observations > 0) this.syncObservations.inc(observations);
    const warnings = run.warnings?.length ?? 0;
    if (warnings > 0) this.syncWarnings.inc(warnings);
  }

  recordAnalyses(analyses: readonly string[]): void {
    for (const analysis of analyses) this.analysesRuns.inc({ analysis });
  }

  /**
   * One publication outcome.
   *
   * The duration is only observed when the connector was actually called: a
   * report skipped because publishing is off took no time, and recording it as a
   * fast publication would make the histogram describe something else.
   */
  recordReportPublished(status: string, seconds?: number): void {
    this.reportsPublished.inc({ status });
    if (typeof seconds === 'number' && Number.isFinite(seconds)) {
      this.reportPublishDuration.observe(seconds);
    }
  }

  /**
   * Lets the owner of the read model publish the gauge without this module
   * depending on Mongo. The callback runs on every scrape; if it throws, the
   * scrape still succeeds with the previous value rather than failing outright.
   */
  bindActiveAssets(count: () => Promise<number>): void {
    this.activeAssetsSource = count;
  }

  metrics(): Promise<string> {
    return this.registry.metrics();
  }
}
