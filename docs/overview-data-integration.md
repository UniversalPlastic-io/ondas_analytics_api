# Integrating New Data Sources into `GET /v1/overview`

How to surface a new S3 dataset (from [`dataset-mapping.md`](dataset-mapping.md))
in the Overview endpoint. Today the overview is derived **only** from
`recogidas_playa` (coastal cleanups). This guide shows how to add another
source — biomass buoys, environmental buoys, microplastics buoys, atmospheric /
oceanographic windows, or future water / fish samples.

---

## 1. Data flow (today)

```
GET /v1/overview?period=&campaign=
        │
        ▼
OverviewService.get()                       src/api-v1/overview/overview.service.ts
  resolvePeriod()                           src/api-v1/reports/reports-period.ts
  resolveCampaignScope(campaign)            src/api-v1/reports/reports-campaign-map.ts
        │  → ScopedFile[] (url + siteLabel + city + lat/lon)
        ▼
  fetchRecogidasFiles(scope.urls)           src/api-v1/reports/reports-data.ts
        │  → TaggedFile[]  (parsed JSON + labels, 6h in-memory cache)
        ▼
  aggregateReportData(files, period, …)     src/api-v1/reports/reports-data.ts
        │  → ReportData { kpis, plasticTypes, series, cleanups, sites }
        ▼
  project → OverviewResponse                overview.service.ts
        kpis · series (bucketSeries) · plasticTypes · topLocations
```

Every S3 url lives in one place: **`S3_CATALOGUE`**
([`src/api-v1/analyses/s3-catalogue.ts`](../src/api-v1/analyses/s3-catalogue.ts)),
keyed by `CatalogType`. A request `location` (or campaign site) selects the
nearest entry of a given type by equirectangular distance.

---

## 2. Know the dataset before you wire it

From [`dataset-mapping.md`](dataset-mapping.md) — confirm these for the
source you are adding:

| Property | Why it matters |
|---|---|
| **`datasetType`** | becomes a new `CatalogType`. |
| **Envelope `format`** | `rows` (array under `dataset.records`) vs `columnar` (parallel arrays under `dataset.columns` keyed by `dataset.index`). Different parser. |
| **Date field + format** | most are `YYYY-MM-DD`; **`boya_microplasticos_seabot` is `DD-MM-YYYY`** — normalize before bucketing. |
| **Units** | biomass = Tonnes, env wind = m/s, polymer % sum to 100, etc. Document units in the response. |
| **Coverage / ocean** | which oceans have files; nearest-neighbor fallbacks (e.g. microplastics buoy exists only for Badalona). |
| **Known data-quality issues** | wrong coords (Tenerife/Gijón), positive lon for Gijón, provider-id typos, `dateRange.start > end`. Guard for these. |

> Path gotcha: the Cantábrico prefix is `catambrico/` (typo in the bucket), not
> `cantabrico/`.

---

## 3. Step-by-step

### Step 1 — Add catalogue entries

Add the new type to the union and the files to the array in
[`s3-catalogue.ts`](../src/api-v1/analyses/s3-catalogue.ts):

```ts
export type CatalogType =
  | 'boya_biomasa' | 'recogidas_playa' | 'boya_microplasticos'
  | 'environmental_boya'
  | 'boya_biomasa_overview';            // ← example new type (or reuse 'boya_biomasa')

export const S3_CATALOGUE: CatalogEntry[] = [
  // …existing…
  { type: 'boya_biomasa', lat: 41.43425, lon: 2.24334,
    url: `${BASE}/mediterraneo/port_badalona/boya_biomasa_badalona.json` },
  // add the new source's files with corrected lat/lon (see data-quality table)
];
```

Use the **corrected** coordinates from the mapping (the catalogue already fixes
Tenerife/Gijón/Cádiz). Nearest-neighbor matching depends on these being right.

### Step 2 — Write a parser

Follow the existing parser pattern in
[`analyses-s3.ts`](../src/api-v1/analyses/analyses-s3.ts) (`parseBiomassFile`,
`parseRecogidasFile`, `parseEnvironmentalFile`, `parseMicroplasticosFile`).
A parser is pure: takes the raw JSON, returns a typed summary or `null` on any
shape mismatch (so a bad/absent file never crashes the request).

**rows** example (sum numeric depth columns per day):

```ts
function parseMyRowsFile(json: unknown): { dailySeries: Map<string, number> } | null {
  try {
    const { dataset } = json as { dataset: { records: Record<string, unknown>[] } };
    const byDate = new Map<string, number[]>();
    for (const r of dataset.records) {
      const date = normalizeDate(r['Date'] as string);   // handle DD-MM-YYYY if needed
      if (!date) continue;
      const v = Number(r['My field']);
      if (!Number.isFinite(v)) continue;
      (byDate.get(date) ?? byDate.set(date, []).get(date)!).push(v);
    }
    const dailySeries = new Map<string, number>();
    for (const [d, vals] of byDate) dailySeries.set(d, vals.reduce((a, b) => a + b, 0) / vals.length);
    return dailySeries.size ? { dailySeries } : null;
  } catch { return null; }
}
```

**columnar** example (parallel arrays):

```ts
const { dataset } = json as { dataset: { format: string; columns: Record<string, unknown[]> } };
if (dataset.format !== 'columnar') return null;
const dates = dataset.columns['Date'] as string[] | undefined;
const values = dataset.columns['my_column'] as number[] | undefined;
// zip dates[i] ↔ values[i]; many readings per day → aggregate per day
```

Date normalizer for the one odd source:

```ts
function normalizeDate(raw: string): string {
  if (/^\d{2}-\d{2}-\d{4}$/.test(raw)) {                 // DD-MM-YYYY → YYYY-MM-DD
    const [d, m, y] = raw.split('-'); return `${y}-${m}-${d}`;
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
}
```

### Step 3 — Decide the overview surface

Pick how the new data shows up. Three options, smallest-first:

| Surface | When | Where to change |
|---|---|---|
| **New KPI** (single number) | a headline metric (e.g. mean biomass) | `OverviewKpis` + projection in `OverviewService.get` |
| **New series** (time chart) | a value over time | add `<name>Series: SeriesPoint[]` to `OverviewResponse`, bucket by period |
| **New section** (array of objects) | a list/breakdown | add a typed array to `OverviewResponse` |

### Step 4 — Load it in the service

Load the new source **in parallel** with the cleanup data, keyed off the same
scope location. In [`overview.service.ts`](../src/api-v1/overview/overview.service.ts):

```ts
const [files, extra] = await Promise.all([
  reportsData.fetchRecogidasFiles(scope.urls),
  loadMyDataNearest({ lat: scope.lat, lon: scope.lon }),   // your new loader, catches errors → null
]);
```

Keep the new loader **non-fatal**: on any S3/parse failure it returns `null`
and the overview still responds (the existing code already swallows
`insufficient_data` into a zeroed response). Reuse the nearest-neighbor helper
shape from `s3-fetch.ts` (`findClosest(type, loc)`).

### Step 5 — Project into the response

Extend the types ([`overview.types.ts`](../src/api-v1/overview/overview.types.ts))
and the DTO ([`overview.swagger.dto.ts`](../src/api-v1/overview/overview.swagger.dto.ts)),
then fill the new field in `OverviewService.get`. Reuse `bucketSeries`-style
day/month/year bucketing so granularity follows `period` consistently.

```ts
// overview.types.ts
export interface OverviewResponse {
  // …existing…
  biomass?: { meanTonnes: number; series: SeriesPoint[] };   // example
}
```

Always carry **units** in the response when the metric isn't self-evident.

### Step 6 — Tests

Mirror [`overview.service.spec.ts`](../src/api-v1/overview/overview.service.spec.ts):
spy the new loader, feed a small fixed fixture, assert the projection + series
buckets + the empty/`null` fallback. Add one e2e assertion in
[`test/overview.e2e-spec.ts`](../test/overview.e2e-spec.ts).

---

## 4. Worked example — add fish biomass as a KPI + series

1. **Catalogue:** `boya_biomasa` entries already exist in `S3_CATALOGUE`.
2. **Parser:** reuse `parseBiomassFile` from `s3-fetch.ts` (sums depth layers →
   `dailySeries` of Tonnes, plus `meanDailyTonnes`).
3. **Loader:** `findClosest('boya_biomasa', { lat: scope.lat, lon: scope.lon })`
   → `fetchJson(url)` → `parseBiomassFile`, wrapped in try/catch → `null`.
4. **Project:** add to `OverviewResponse`:
   ```ts
   biomass: { meanTonnes: round(parsed.meanDailyTonnes, 2),
              units: 'Tonnes',
              series: bucketDailySeries(parsed.dailySeries, period) }
   ```
   where `bucketDailySeries` re-buckets a `Map<dateStr, number>` like
   `bucketSeries` does for cleanups.
5. **Fallback:** if `parsed === null` → omit `biomass` (or zero it).
6. **Tests:** fixture with two days of depth readings → assert `meanTonnes` and
   the period buckets.

---

## 5. Dataset → suggested overview surface

| `datasetType` | Format | Key fields | Suggested surface |
|---|---|---|---|
| `recogidas_playa` | rows | kg, participants, distance, polymer % | **already wired** (all KPIs, series, plasticTypes, topLocations) |
| `boya_biomasa_slx+` | rows | biomass by depth (Tonnes) | KPI `meanBiomass` + biomass series |
| `boya_microplasticos_seabot` | rows (`DD-MM-YYYY`) | particle Size/Form/Polymer/Colour | composition breakdown (counts by polymer/size) |
| `environmental_boya` | columnar (hourly) | wind, waves, SST, salinity… | env context series (e.g. wind_speed) |
| `atmosfera_previa_evento` | rows (nested) | per-event 7-day weather window | per-event context, not a continuous series |
| `oceanografia_previa_evento` | rows (nested) | per-event 7-day ocean window | per-event context |
| `muestras_de_agua_py_gcms` | *(no files yet)* | per-polymer µg/L | water composition (when data lands) |
| `muestras_de_peces_py_gcms` | *(no files yet)* | per-polymer µg/g in tissue | fish composition (when data lands) |

---

## 6. Checklist

- [ ] New `CatalogType` + `S3_CATALOGUE` entries with **corrected** lat/lon.
- [ ] Pure parser (`rows` or `columnar`), returns `null` on mismatch.
- [ ] Date normalized (watch `DD-MM-YYYY`).
- [ ] Units captured.
- [ ] Loader is parallel + non-fatal (catch → `null`).
- [ ] `OverviewResponse` + DTO extended; projection added.
- [ ] Series bucketed by `period` (day/month/year).
- [ ] Unit + e2e tests, incl. empty-data fallback.
- [ ] No new required env/credentials (read is public S3 over HTTPS).

---

## 7. Files touched per integration

| File | Change |
|---|---|
| [`src/api-v1/analyses/s3-catalogue.ts`](../src/api-v1/analyses/s3-catalogue.ts) | add type + entries |
| [`src/api-v1/analyses/analyses-s3.ts`](../src/api-v1/analyses/analyses-s3.ts) | add parser (or a new `reports`/`overview` loader module) |
| [`src/api-v1/overview/overview.types.ts`](../src/api-v1/overview/overview.types.ts) | extend `OverviewResponse` |
| [`src/api-v1/overview/overview.swagger.dto.ts`](../src/api-v1/overview/overview.swagger.dto.ts) | mirror the new field |
| [`src/api-v1/overview/overview.service.ts`](../src/api-v1/overview/overview.service.ts) | load + project + bucket |
| `src/api-v1/overview/overview.service.spec.ts` · `test/overview.e2e-spec.ts` | tests |

No changes needed to `reports/` unless the same source should also appear in
the PDF report.
