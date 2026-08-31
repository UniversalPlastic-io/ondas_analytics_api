# Map Endpoint Design — `GET /v1/map/points`

A dashboard map that shows **one marker per dataset in S3**
([`dataset-mapping.md`](dataset-mapping.md)), each with its info
(type, provider, location, record count, date range, format, links). This is a
**dataset/station map** — distinct from the Blue Resilience §11 `mapPoints`,
which is a *cleanup-aggregate* map (kg per cleanup site). See §8 for that variant.

> Status: design only. Mirrors the `overview/` module patterns. Build when the
> dashboard's map view is needed.

---

## 1. Goal

For every data file in the bucket, emit a marker the dashboard can plot and open
an info popup on. The info comes from each file's **`metadata`** block (the
"Universal Data Envelope" — identical shape across every dataset type), so the
endpoint is mostly: list files → read each file's metadata → return points.

---

## 2. Endpoint & params

```
GET /v1/map/points?ocean=&datasetType=&provider=
```

| Param | Values | Default |
|---|---|---|
| `ocean` | `mediterraneo` \| `atlantico` \| `catambrico` | all |
| `datasetType` | `recogidas_playa` \| `boya_biomasa_slx+` \| `boya_microplasticos_seabot` \| `environmental_boya` \| `atmosfera_previa_evento` \| `oceanografia_previa_evento` | all |
| `provider` | `innoceana` \| `universal_plastic` \| `port_badalona` \| … | all |

All filters optional; omitted = every known file. Public, no guard (consistent
with `/v1/overview`).

---

## 3. Response shape (Leaflet-ready)

The map is **Leaflet**, so coords are `lat`/`lng` and a top-level `bounds` feeds
`map.fitBounds`. **One marker per dataset** — each dataset type is its own point
(it represents different data), even when several share a station's coordinates
(handle overlap with clustering/spiderfy, see §3.2).

`cleanup` points (`recogidas_playa`) additionally carry **aggregated kg +
volunteers across all cleanups at that location, plus the per-event list**.

```jsonc
{
  "count": 14,                                       // markers (datasets)
  "bounds": [[28.188, -16.660], [43.572, 2.795]],    // [[minLat,minLng],[maxLat,maxLng]]
  "points": [
    {
      "id": "atlantico/innoceana/recogidas_playa_tenerife",
      "name": "Tenerife — Coastal cleanup",
      "datasetType": "recogidas_playa",
      "label": "Coastal cleanup",
      "category": "cleanup",
      "color": "#00003F",
      "provider": "innoceana",
      "ocean": "atlantico",
      "lat": 28.1876, "lng": -16.6596,
      "records": 8,
      "dateRange": { "start": "2025-04-10", "end": "2025-11-10" },
      "format": "rows",
      "url": "https://…/atlantico/innoceana/recogidas_playa_tenerife.json",
      "metadataSchemaRef": "https://…/metadatos/recogidas_plastico_app_up_v700_v1.jsonld",
      "warnings": ["coords corrected 31.483,-11.926 → Tenerife"],

      // headline numbers for every marker
      "summary": { "kg": 144.87, "volunteers": 31, "cleanups": 8 },
      // cleanup ONLY: the per-event list (files are tiny, 1–8 rows)
      "cleanupsList": [
        { "date": "2025-11-10", "kg": 22.4, "volunteers": 5, "km": 1.8, "duration": "1:12:00", "evidence": 3 }
      ]
    },
    {
      "id": "mediterraneo/port_badalona/boya_biomasa_badalona",
      "name": "Badalona — Fish biomass buoy",
      "datasetType": "boya_biomasa_slx+", "label": "Fish biomass buoy",
      "category": "biomass", "color": "#16a34a", "provider": "portbadalona",
      "ocean": "mediterraneo", "lat": 41.4342, "lng": 2.2433,
      "records": 3611, "dateRange": { "start": "2025-12-06", "end": "2026-05-11" },
      "format": "rows", "units": { "Biomass depth -3_-5 m": "Tonnes" },
      "url": "https://…/boya_biomasa_badalona.json",
      "metadataSchemaRef": "https://…/metadatos/boya_biomasa_slx%2B_v1.jsonld",
      "warnings": [],
      "summary": { "meanTonnes": 18.24, "maxTonnes": 41.2, "depthLayers": 3 }
      // buoys carry summary stats only — NOT their 3.5k+ rows (see §3.5)
    }
  ]
}
```

- One point per dataset file. **Every** marker carries a type-appropriate
  `summary` (headline numbers for the popup). Only **cleanup** datasets also
  carry `cleanupsList` (full per-event rows) — their files are tiny.
- Datasets with no usable file are omitted (never an error).
- Several datasets at one place (e.g. Badalona's 5+) share coordinates → see §3.2.

### 3.1 Leaflet usage

```js
const res = await fetch('/v1/map/points').then(r => r.json());
const cluster = L.markerClusterGroup();          // handles co-located datasets
for (const p of res.points) {
  let html = `<b>${p.name}</b><br><span style="color:${p.color}">●</span> ${p.label}` +
             `<br>${p.records} records` +
             (p.dateRange ? `<br>${p.dateRange.start} → ${p.dateRange.end}` : '');
  if (p.category === 'cleanup') {
    html += `<br><b>${p.summary.kg} kg</b> · ${p.summary.cleanups} cleanups · ${p.summary.volunteers} volunteers`;
  } else if (p.summary) {
    html += '<br>' + Object.entries(p.summary).map(([k, v]) => `${k}: ${v}`).join(' · ');
  }
  cluster.addLayer(L.circleMarker([p.lat, p.lng], { color: p.color, radius: 7 }).bindPopup(html));
}
map.addLayer(cluster);
map.fitBounds(res.bounds);
```

### 3.2 Co-located datasets (overlap)

Multiple datasets at one place share coordinates (Badalona has 5–6). Since each
is its own marker, **cluster client-side** (`L.markerClusterGroup`, which
spiderfies overlapping pins on click) — recommended. Alternatives: a small
deterministic per-category offset (`lat += k*0.0008`) server-side, or render as
`circleMarker`s colored by `category`. The endpoint returns true coordinates;
the client decides how to de-overlap.

### 3.3 Optional GeoJSON (`?format=geojson`)

For `L.geoJSON(...)`. Note GeoJSON is **`[lng, lat]`** order; properties carry
the per-dataset fields (incl. cleanup aggregates where applicable):

```jsonc
{
  "type": "FeatureCollection",
  "features": [
    { "type": "Feature",
      "geometry": { "type": "Point", "coordinates": [-16.6596, 28.1876] },
      "properties": { "id": "…recogidas_playa_tenerife", "name": "Tenerife — Coastal cleanup",
                      "datasetType": "recogidas_playa", "category": "cleanup", "color": "#00003F",
                      "records": 8, "kg": 144.87, "volunteers": 31, "cleanups": 8 } }
  ]
}
```

### 3.4 Per-type `summary` (popup headline)

Every marker carries `summary` with type-appropriate aggregates. Full
record-level lists are **only** shipped for cleanups (tiny files); buoys hold
3.5k+ rows, so they send summary stats only — deep detail belongs in a future
drill-down endpoint (`GET /v1/datasets/:id?from=&to=`), loaded on marker click.

| category | `summary` fields | full list? |
|---|---|---|
| `cleanup` | `kg`, `volunteers`, `cleanups` | ✅ `cleanupsList[]` |
| `biomass` | `meanTonnes`, `maxTonnes`, `depthLayers` | ❌ |
| `microplastics` | `particles`, `byPolymer[]`, `bySize[]` | ❌ (breakdowns small → included) |
| `environmental` | `meanSeaSurfaceTemperatureC`, `meanWindSpeedMs`, `readings` | ❌ |
| `atmospheric` | `events`, `meanAirTemperatureC`, `meanWindSpeedMs` | ❌ |
| `oceanographic` | `events`, `meanSeaSurfaceTemperatureC`, `meanSignificantWaveHeightM` | ❌ |

The biomass / microplastics / environmental summaries are **already implemented**
in [`overview-sources.ts`](../src/api-v1/overview/overview-sources.ts)
(`loadBiomass`, `loadMicroplastics`, `loadEnvironment`) — reuse them; the map
service just attaches the result as `summary`.

### 3.5 Category → color (marker + legend)

| datasetType | category | color |
|---|---|---|
| `recogidas_playa` | `cleanup` | `#00003F` |
| `boya_biomasa_slx+` | `biomass` | `#16a34a` |
| `boya_microplasticos_seabot` | `microplastics` | `#42C3EE` |
| `environmental_boya` | `environmental` | `#4055F6` |
| `atmosfera_previa_evento` | `atmospheric` | `#B8BBC9` |
| `oceanografia_previa_evento` | `oceanographic` | `#2F8AA9` |

---

## 4. Data sourcing — the universal `metadata` block

Every file shares this top-level structure (mapping doc §"Universal Data Envelope"):

```jsonc
{
  "metadata": {
    "datasetType": "...", "dataProviderId": "...",
    "dcatSchemaRef": "...", "dateRange": { "start": "...", "end": "..." },
    "location": { "lat": 0.0, "lon": 0.0 }, "recordCount": 0,
    "units": { "<field>": "<unit>" }
  },
  "dataset": { "format": "rows | columnar", ... }
}
```

Most points are built from `metadata.*` + `dataset.format`. **Exception:
`cleanup` (`recogidas_playa`) points must parse `dataset.records`** to compute
the aggregates + per-event list (§6.1). For all other types, records are not
read. One HTTP GET per file (cached).

> Reality check (from the live files): `metadata.dateRange` and
> `metadata.dataProviderId` are frequently **missing/null**, and nested
> datasets report `metadata.location = 0,0`. So take **coords + provider from
> the static manifest** (§5 A), and derive `dateRange` from the record dates
> (min/max) when metadata lacks it. Live metadata is only reliable for
> `recordCount`, `units`, and `dataset.format`.

---

## 5. Two ways to know which files exist

### Option A — static manifest (recommended to start)

A `MAP_CATALOGUE` constant listing every file (extends today's
[`s3-catalogue.ts`](../src/api-v1/analyses/s3-catalogue.ts), which only has the 4
types the analytics use). Source the list directly from the mapping doc's
per-ocean tables. Each entry: `{ ocean, provider, datasetType, url, name }`.
The endpoint then fetches each file's metadata to fill records/dateRange/units.

Pros: explicit, filterable without any S3 call to enumerate; covers
atmosfera/oceanografia too. Cons: hand-maintained — add a row when a file lands.

### Option B — live S3 listing

`ListObjectsV2` under `public/` to discover `*.json` files, skip
`metadatos/`. Self-updating, but needs S3 list permission and key→type parsing.

**Recommendation:** Option A. The bucket changes rarely and the mapping doc is
the authoritative inventory; a manifest keeps the endpoint fast and predictable.

---

## 6. Apply the known data-quality fixes

From the mapping doc's "Data Quality Issues" + per-ocean ⚠ notes. The endpoint
must **correct** these (the analytics catalogue already corrects coords):

| File | Fix |
|---|---|
| `recogidas_playa_tenerife` | coords `31.483,-11.926` → Tenerife `28.188,-16.660` |
| `recogidas_playas_gijon` | same wrong coords → Gijón `43.572,-5.721` |
| `boya_biomasa_gijon` | `lon 5.679` → `-5.679` |
| microplastics `Date` | `DD-MM-YYYY` → normalize when shown |
| provider ids | `universal\`plastic`, `universalplastic`, `portbadalona` → display-normalize |
| atmosfera/oceanografia | some `dateRange.start > end` → swap for display |

Keep a small `CORRECTIONS` table keyed by file fragment; apply lat/lon override
+ push a `warnings[]` entry. Path prefix is `catambrico/` (bucket typo), not
`cantabrico/`.

### 6.1 Per-type `summary` + cleanup list

**Cleanup** (`recogidas_playa`) — parse `dataset.records` (reuse the field
mapping from [`reports-data.ts`](../src/api-v1/reports/reports-data.ts)):

| Field | From records |
|---|---|
| `summary.kg` | Σ `Plastic waste collected` |
| `summary.volunteers` | Σ `Number of participants` |
| `summary.cleanups` | record count |
| `cleanupsList[]` | per record: `{ date, kg, volunteers, km (Walking distance), duration (Cleanup duration), evidence (pipe-split Collected waste image count) }` |
| `dateRange` | min/max `Date` across records |

**Biomass / microplastics / environmental** — call the existing
`loadBiomass` / `loadMicroplastics` / `loadEnvironment` from
[`overview-sources.ts`](../src/api-v1/overview/overview-sources.ts) and attach
the result as `summary` (biomass: add `maxTonnes`/`depthLayers`).

**Atmospheric / oceanographic** (nested events) — `summary.events` = top-level
record count; mean the relevant field across all nested `*_previa.records[]`
(atmospheric: `air_temperature`, `wind_speed`; oceanographic:
`sea_surface_temperature`, `significant_wave_height`).

Factor a shared `parseRecogidas(records)` for the cleanup branch rather than
duplicating the reports/overview logic.

---

## 7. Build steps (mirror `overview/`)

```
src/api-v1/map/
├── map-catalogue.ts     MAP_CATALOGUE (all files) + CORRECTIONS + dataset labels
├── map.service.ts       list → fetch metadata (cache, non-fatal) → correct → filter → MapPoint[]
├── map.controller.ts    GET /v1/map/points + swagger (?ocean=&datasetType=&provider=)
├── map.types.ts         MapPoint, MapResponse
└── map.swagger.dto.ts   DTOs
```

1. **`map-catalogue.ts`** — enumerate every file from the mapping doc tables;
   include `name`, `category`/`color`/`label` (datasetType → §3.4), corrected
   `lat`/`lng`, and `provider`. Add `CORRECTIONS`.
2. **`map.service.ts`**:
   ```
   getPoints({ ocean?, datasetType?, provider? }):
     entries = MAP_CATALOGUE.filter(by params)
     points = await Promise.all(entries.map(async e => {
       const file = await fetchFile(e.url)            // GET; null on fail → drop marker
       if (!file) return null
       const base = buildPoint(e, file.metadata, file.dataset.format)   // coords/provider from manifest
       if (e.category === 'cleanup') Object.assign(base, parseRecogidas(file.dataset.records)) // §6.1
       return base
     }))
     const pts = points.filter(Boolean)
     return { count: pts.length, bounds: bbox(pts), points: pts }
   ```
   `fetchFile` reuses the 6h cache pattern from `overview-sources.ts`; failures
   → `null` (marker dropped, not fatal). `bbox` = `[[minLat,minLng],[maxLat,maxLng]]`.
3. **`map.controller.ts`** — `GET /v1/map/points`, `@ApiTags('Map')`, query
   params, `@ApiOkResponse(MapResponseDto)`.
4. **Register** in `api-v1.module.ts` (controller + service).
5. **Tests** — unit: filtering, corrections applied + `warnings`, null-drop on
   unreachable file, metadata projection; e2e: `GET /v1/map/points` shape with
   `fetch` mocked.

No new deps (Option A). Option B adds `ListObjectsV2` (already have `@aws-sdk/client-s3`).

---

## 8. Note — Blue Resilience §11 `mapPoints`

The §11 cleanup-map fields (`kg`, `cleanups`, `size`) are now **covered by the
`cleanup` points** here (`summary.kg`, `summary.volunteers`, `summary.cleanups`,
`cleanupsList`). For a §11-style "size by kg" marker, derive `size` client-side
from `summary.kg` thresholds (sm/md/lg) — no separate endpoint needed.

Pick per the dashboard's map view; build the dataset map first if the goal is
"show every dataset with its info."

---

## 9. Checklist

- [ ] `MAP_CATALOGUE` covers every file in the mapping doc (incl. atmosfera/oceanografia).
- [ ] `datasetType → label` map; per-file `name`.
- [ ] `CORRECTIONS` for coords/provider/date; emit `warnings[]`.
- [ ] Metadata read from the envelope `metadata` block (no record parsing).
- [ ] Fetch cached + non-fatal (drop unreachable markers).
- [ ] Filters `ocean`/`datasetType`/`provider`, all optional.
- [ ] Unit + e2e tests.
- [ ] Public, no guard; consistent `/v1` prefix and tag `Map`.
