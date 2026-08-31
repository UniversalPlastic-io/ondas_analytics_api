# Blue Resilience — Report Endpoint Design

**Date:** 2026-06-18
**Endpoint:** `POST /v1/reports/request`
**Module:** `src/api-v1/reports/` (new), wired into `src/api-v1/api-v1.module.ts`

Generates a per-type cleanup report PDF from real `recogidas_playa` (coastal
cleanup) data in the `universalplastic-sedia` S3 bucket, uploads it to S3, and
returns the public HTTPS download URL. Mirrors the existing `analyses/` module
patterns (S3 fetch, pdf-lib generation, S3 upload).

---

## 1. Scope & Decisions

| Decision | Choice |
|---|---|
| Data source | Real `recogidas_playa` files from the S3 catalogue. |
| Scope resolution | `scope.campaign` id (`c1`–`c4`) maps to a specific S3 recogidas file; `"all"` aggregates all 5. |
| Report types | Per-type page layouts (6 types share one `ReportData`, differ in page composition). |
| Auth | **No guard** — endpoint is public (consistent with recent "disable authentication" commit). |
| Upload target | Data bucket: `universalplastic-sedia/public/{ocean}/universal_plastic/reports/{reportId}.pdf`. |
| Response | Synchronous — returns `status:"ready"` with `downloadUrl` (https). No polling. |
| Format | PDF implemented. `format:"xlsx"` is **silently coerced to PDF** (no xlsx lib). |
| **Visual design** | **Match the design team's HTML template** (`docs/report-template.html`, rendered preview `docs/Monthly Cleanup Report — Blue Resilience.pdf`): light theme, cover page + content pages, numbered section badges, KPI cards (cyan top-border), horizontal plastic-type bars, monthly-trend line chart, cleanup-events table with status pills, gradient impact-index gauge, location-overview placeholder. |
| **Rendering** | **SVG → sharp → pdf-lib.** Each A4 page is composed as an SVG string (porting the template's exact CSS tokens and inline chart SVGs), rasterized to PNG with `sharp` (already a dep), embedded full-page in a pdf-lib A4 page. No headless browser. |
| **Branding** | The **Universal Plastic** white horizontal logo SVG (embedded verbatim in the template) is inlined as a code constant on the navy cover — no external asset. |
| **Fonts** | SVG text uses `font-family: 'Inter', Arial, Helvetica, sans-serif`. The template uses Inter; on the server, `sharp`/librsvg falls back to a system sans if Inter is not installed (accepted ~95% fidelity). Installing Inter on the host improves match. |
| **Location / city** | recogidas_playa has no place name; each source file is tagged with a **site label + city** (per-file map). Every cleanup row shows that label. |
| **Status** | recogidas_playa has no status; all rows render as **`verified`**. |
| **CO₂eq** | Derived: `co2eqTonnes = kg × 0.01` (10 kg CO₂e avoided per kg plastic; 1240 kg → 12.4 t, matching the reference). |

Out of scope: polling, report history (`GET /reports`), XLSX output, persistence
of report metadata beyond the S3 object, per-row real location names / real
verification status / interactive map (placeholder box only), i18n (English copy
only — `language` accepted but not yet applied).

---

## 2. File Layout

```
src/api-v1/reports/
├── reports.controller.ts      POST /v1/reports/request + swagger examples
├── reports.service.ts         orchestration: validate → aggregate → PDF → upload → respond
├── reports.types.ts           request/response TypeScript types
├── reports.swagger.dto.ts     Swagger DTOs + per-type example bodies
├── reports-campaign-map.ts    campaign id → S3 recogidas entry/entries + metadata
├── reports-data.ts            fetch recogidas_playa JSON, filter by period, aggregate ReportData
├── reports-svg.ts             SVG page builders (cover, KPIs, charts, table, gauge, map) + primitives
├── reports-pdf.ts             rasterize page SVGs with sharp, assemble A4 pdf-lib document
└── reports-s3.ts              upload PDF to data bucket, return public https URL
```

`api-v1.module.ts` adds `ReportsController` to `controllers` and `ReportsService`
to `providers`.

---

## 3. Request Type (`reports.types.ts`)

Based on §17 of the Blue Resilience OS data reference (`docs/blueresilience-api.md`,
since removed from this repository: it documented a different frontend).

```ts
type ReportType = 'monthly' | 'annual' | 'campaign' | 'location' | 'evidence' | 'custom';

interface ReportRequest {
  type: ReportType;                      // required, default 'monthly'
  period: {
    preset?: 'month' | 'year' | '2024' | 'all';
    start?: string;                      // 'YYYY-MM-DD'
    end?: string;                        // 'YYYY-MM-DD'
  };
  scope?: {
    campaign?: 'all' | string;           // 'all' | 'c1'..'c4'   default 'all'
    entity?: string;                     // 'auto' (ignored — resolved server-side)
  };
  detail?: 'summary' | 'standard' | 'detailed';   // default 'standard'
  language?: 'en' | 'es' | 'fr';                  // default 'en'
  format?: 'pdf' | 'xlsx';                        // default 'pdf'; xlsx coerced to pdf
  include?: {
    kpis?: boolean; map?: boolean; charts?: boolean; cleanupsList?: boolean;
    evidence?: boolean; plasticTypes?: boolean; ondas?: boolean; impactIndex?: boolean;
  };
}
```

`include` defaults (when omitted): `kpis,map,charts,cleanupsList,evidence,plasticTypes,impactIndex = true`, `ondas = false`.

### Period resolution → `{start,end}`

| preset | range |
|---|---|
| `month` | first→last day of current month (2026-06-01 → 2026-06-30) |
| `year` | current year Jan 1 → Dec 31 |
| `2024` | 2024-01-01 → 2024-12-31 |
| `all` | no bound (min→max date in the data) |

If `type === 'custom'`, `period.start`/`period.end` are required and used
verbatim. For other types, explicit `start`/`end` (if present) override the preset.

---

## 4. Campaign → Location Map (`reports-campaign-map.ts`)

Provisional (will be refactored later). Maps Blue Resilience mock campaigns
(§6) to S3 `recogidas_playa` files via `S3_CATALOGUE`.

| Campaign id | Name (from §6) | S3 recogidas file |
|---|---|---|
| `c1` | Costa Brava Spring Clean 2025 | `recogidas_playas_blanes` |
| `c2` | Mediterranean Blue 2024 | `recogidas_playas_badalona` |
| `c3` | Barceloneta Urban Impact | `recogidas_playas_barcelona` |
| `c4` | Corporate Wave Q1 2025 | `recogidas_playa_tenerife` |
| `all` | — | all 5 recogidas files |

Each map entry carries display metadata (campaign name, **site label, city**,
lat/lon) used for the campaign header card and for the per-row Location/City
columns in the cleanup-events table. For `"all"`, each of the 5 source files is
tagged with its own site/city via a per-file label map (fragment → `{site,
city, lat, lon}`):

| File fragment | site | city |
|---|---|---|
| `recogidas_playas_barcelona` | Barcelona | Barcelona |
| `recogidas_playas_badalona` | Badalona | Badalona |
| `recogidas_playas_blanes` | Blanes | Costa Brava |
| `recogidas_playa_tenerife` | Tenerife | Canary Islands |
| `recogidas_playas_gijon` | Gijón | Asturias |

`resolveCampaignScope` returns `urls: Array<{ url; siteLabel; city; lat; lon }>`.

Ocean for the upload path is resolved by nearest-neighbor (reusing the
`resolveOcean`-style logic in `analyses-s3.ts`) on the dominant scope location;
`"all"` defaults to the Mediterráneo basin.

---

## 5. Data Aggregation (`reports-data.ts`)

Fetches the selected recogidas file(s) from S3 (HTTP `fetch` with a small
in-memory TTL cache, same shape as `s3-fetch.ts`), filters records by the
resolved period, and aggregates a single `ReportData` object consumed by every
layout.

### recogidas_playa field mapping

| Report value | Source field | Aggregation |
|---|---|---|
| `kg` | `Plastic waste collected` (kg) | sum |
| `cleanups` | record | count |
| `volunteers` | `Number of participants` | sum |
| `km` | `Walking distance` (km) | sum |
| `durationHours` | `Cleanup duration` (HH:MM:SS) | parse → sum hours |
| `avgKg` | — | `kg / cleanups` |
| `plasticTypes[]` | `… (%)` polymer columns | mean per polymer across records |
| `evidenceCount` | `Collected waste image` | sum of pipe-split URL counts |
| `sites[]` | per-file site label | group rows by source file; per-site kg/cleanups |
| `series[]` | `Date` + kg | points `{label, kg}` (daily for month/custom, monthly for annual) |
| `co2eqTonnes` | derived | `kg × 0.01` (10 kg CO₂e/kg plastic; 1240 kg → 12.4 t) |
| `impactIndex` | derived | 0–100: `round(100·(0.6·densityScore + 0.4·participationScore))`, density = clamp(kg/max(km,0.1)/50, 0,1), participation = clamp(volunteers/max(cleanups,1)/10, 0,1) |
| `impactRating` | derived | from `impactIndex`: ≥76 `Excellent`, 51–75 `Good`, 26–50 `Fair`, ≤25 `Low` |

Each cleanup row also carries `location` + `city` (from the per-file site/city
map) and `status: 'verified'` (recogidas_playa has no status field).

`ReportData` shape (sketch):

```ts
interface ReportData {
  period: { start: string; end: string; label: string };
  scopeLabel: string;                 // 'All campaigns' | campaign name
  kpis: { kg; co2eqTonnes; cleanups; volunteers; km; durationHours; locations;
          avgKg; evidenceCount; impactIndex; impactRating };
  plasticTypes: Array<{ type: string; pct: number; color: string }>;
  series: Array<{ label: string; kg: number }>;
  cleanups: Array<{ date; location; city; kg; volunteers; km; duration; evidence; status }>;
  sites: Array<{ name; lat; lon; kg; cleanups }>;
}
```

If aggregation yields zero records in the period → service throws → `422 insufficient_data`.

Polymer column → short label/color reuses the Blue Resilience palette (§5 of
the API doc): PET `#00003F`, HDPE `#39B3D8`, LDPE `#BDEAF7`, PP `#4055F6`,
PS `#2F8AA9`, PVC `#62C8E8`, Others `#B8BBC9`.

---

## 6. Rendering — SVG → sharp → PDF

Matches the design team reference (`docs/Monthly Cleanup Report — Blue
Resilience.pdf`). Two modules:

- **`reports-svg.ts`** — builds each A4 page as an SVG string (viewBox
  `0 0 794 1123`, A4 @ ~96dpi). Pure string functions, unit-testable.
- **`reports-pdf.ts`** — for each page SVG: `sharp(Buffer.from(svg)).png()`
  (rasterize at 2× density for crisp output) → `pdf.embedPng` → draw full-bleed
  on an A4 pdf-lib page. Returns `Uint8Array`.

### Theme (light) — exact tokens from `report-template.html`

`INK #00003F` (navy, text + cover bg) · `ACCENT #42C3EE` (cyan) · `MUTED #777D80`
· secondary muted `#9BB5C0` · body text `#3D4649` · card/divider border `#DEE0E0`
· chart panel `#F0F7FB` · pill verified `#166534` on `#DCFCE7` · pill pending
`#92400E` on `#FEF3C7` · gauge gradient stops `#F3EE5F → #7DD9A8 → #42C3EE`.
Polymer bars use the §5 palette at `opacity 0.85`.

### SVG section builders (`reports-svg.ts`)

Ports the template's markup. The three inline chart SVGs and the Universal
Plastic logo are copied **verbatim** from `report-template.html` and
parameterized with data.

- `universalPlasticLogo()` — the template's white horizontal UP logo `<svg>`
  (constant), placed on the navy cover.
- `coverPage(data, meta)` — navy (`#00003F`) cover: logo, `Monthly Cleanup
  Report` title, cyan divider, `{scope} · {country}` entity line,
  Period/Generated/Detail level/Report ID meta grid, "Universal Plastic · Blue
  Resilience" claim.
- `pageHeader(title, period, scope)` — "Universal Plastic · Blue Resilience ·
  {title} — {period}" left, scope right, bottom border.
- `pageFooter(reportId, generatedAt)` — "Universal Plastic · Blue Resilience ·
  {reportId}" + "Generated {date}".
- `sectionHeading(n, label, y)` — cyan rounded `NN` badge + uppercase label.
- `kpiCards(cards, y)` — 4 white cards, 3px cyan top-border, value/unit/label.
- `plasticTypeBars(types, y)` — `#F0F7FB` panel; per polymer label, colored bar
  (`~2.6 px/%`, opacity 0.85), `%` value. (template SVG viewBox `0 0 348 196`.)
- `trendLineChart(series, y)` — `#F0F7FB` panel; axes, polyline + dots
  (r3, white stroke), x labels, 0/max y labels. (template viewBox `0 0 480 160`.)
- `eventsTable(rows, y)` — Date · Location · City · Collected · Volunteers ·
  Status (pill), zebra `#F0F7FB` even rows.
- `gauge(score, rating, y)` — exact template gauge: arc `M 32,108 A 88,88 0 0,1
  120,20 A 88,88 0 0,1 208,108` stroke-width 26 with the gradient, needle rotated
  `(score/100)·180 − 180`°, big score, "{rating} impact", 0/100 labels, side text.
- `mapPlaceholder(y)` — dashed `#DEE0E0` panel, map glyph + "Interactive map
  available in Blue Resilience OS dashboard".

### Per-type page composition

`monthly` mirrors the reference exactly:

| Page | Sections |
|---|---|
| 1 (cover) | UP logo · "Monthly Cleanup Report" · cyan divider · scope·Spain · Period/Generated/Detail/Report-ID meta block |
| 2 | header · **01 KPIs & metrics** (kg, CO₂eq, cleanup events, impact index) · **02 Plastic types** · **03 Monthly trend** |
| 3 | **04 Cleanup events** table · **05 Impact index** gauge · **06 Location overview** placeholder · footer |

Other types reuse the same builders, recomposed:

| Type | Notable differences |
|---|---|
| `annual` | trend chart is 12 monthly buckets; KPIs annual; cover title "Annual Impact Report — {year}". |
| `campaign` | cover + header show the campaign name; KPIs/table scoped to the mapped site. |
| `location` | adds a per-site KPI/table breakdown; trend replaced by kg-by-site bars. |
| `evidence` | events table emphasises the evidence-files column; gauge omitted. |
| `custom` | same as monthly with the explicit date-range label. |

`include[]` gates each numbered section (e.g. `include.map === false` drops
section 06). `detail` scales: `summary` = cover + KPIs + one chart;
`standard` = full reference layout; `detailed` = adds the full untruncated
events table (paginating to extra pages when rows overflow).

PDF staged to `output/reports/{reportId}/report.pdf`, then uploaded.

---

## 7. S3 Upload (`reports-s3.ts`)

```ts
uploadReportToS3({ reportId, ocean, pdfPath }): Promise<{ pdfUrl, s3Key }>
```

- Bucket `universalplastic-sedia`, region `eu-central-1`.
- Key: `public/{ocean}/universal_plastic/reports/{reportId}.pdf`.
- `PutObjectCommand`, `ContentType: application/pdf`.
- Returns public URL: `https://universalplastic-sedia.s3.eu-central-1.amazonaws.com/{key}`.

Credentials from environment (same as `analyses-s3.ts`). If upload fails, the
service surfaces a `500`-class error (report cannot be delivered without the URL).

---

## 8. Service Flow (`reports.service.ts`)

```
generate(req):
  1. normalize defaults (type, detail, language, format→pdf, include)
  2. resolve period → {start, end, label}
  3. validate:
       - type=campaign & scope.campaign in (undefined,'all')  → 400 campaign_required
       - type=custom & (!start || !end)                        → 400 date_range_required
       - start > end                                           → 400 invalid_date_range
  4. resolve scope → S3 recogidas entries (campaign map)
  5. fetch + aggregate → ReportData
       - zero records → 422 insufficient_data
  6. reportId = `rep_<hex>`
  7. build PDF (per-type layout)
  8. resolve ocean → upload PDF to S3
  9. return ReportResponse
```

### Response (success)

```jsonc
{
  "requestId": "rep_ab12cd34",
  "status": "ready",
  "name": "Monthly cleanup report — June 2026",
  "type": "monthly",
  "period": "June 2026",
  "generatedAt": "2026-06-18T10:32:00Z",
  "format": "pdf",
  "size": "0.4 MB",
  "downloadUrl": "https://universalplastic-sedia.s3.eu-central-1.amazonaws.com/public/mediterraneo/universal_plastic/reports/rep_ab12cd34.pdf"
}
```

### Error (NestJS exceptions → `{ error, message }`)

| Condition | HTTP | error |
|---|---|---|
| campaign type without campaign id | 400 | `campaign_required` |
| custom type without start/end | 400 | `date_range_required` |
| start > end | 400 | `invalid_date_range` |
| no data in period | 422 | `insufficient_data` |
| S3 upload / generation failure | 500 | `report_generation_failed` |

---

## 9. Validation rules (§17)

Implemented in the service before aggregation (table above). `entity` is always
treated as `auto` and ignored. `xlsx` is coerced to `pdf` (no error).

---

## 10. Testing

- Unit: period resolution, campaign map resolution (incl. per-file site/city),
  duration parsing, polymer mean aggregation, CO₂eq + impact index/rating,
  validation branches.
- Unit: `ReportData` aggregation against a small fixed recogidas fixture.
- Unit (`reports-svg.ts`): each page builder returns well-formed SVG
  (`<svg…</svg>`) containing expected labels/values; section gating by
  `include` works.
- Unit (`reports-pdf.ts`): `buildReportPdf` returns bytes starting with `%PDF-`
  for every type and detail level.
- e2e (supertest): `POST /v1/reports/request` happy path returns `status:"ready"`
  + a `downloadUrl`; validation errors return correct codes. `fetch` + S3 upload
  mocked.

---

## 11. Reuse / touch list

- **Reuse:** `S3_CATALOGUE` (recogidas entries), `sharp` rasterization + pdf-lib
  embedding pattern from `analyses-plot-pdf.ts`, ocean-resolve logic from
  `analyses-s3.ts`.
- **New:** entire `reports/` module (incl. `reports-svg.ts`, which inlines the
  template's Universal Plastic logo SVG + the three chart SVGs as code).
- **Source of truth:** `docs/report-template.html` (exact CSS tokens + inline SVGs).
- **Edit:** `api-v1.module.ts` (register controller + service).
- No external logo asset required; no changes to `analyses/` or `auth/`.
