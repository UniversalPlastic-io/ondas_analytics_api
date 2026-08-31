# Dataset Mapping

> **Scope.** The dataset types below, their schemas, units and known data-quality
> issues, describe **what a participant publishes** — not how it is fetched. They
> are the reference for the container validation and the field normalizer, and
> they hold whichever way the data reaches us.
>
> How it reaches us is in [dspacer-integration.md](dspacer-integration.md): the
> API negotiates a contract per asset with each provider's connector. There is no
> path, prefix or folder to look up here; the catalog is the inventory, and the
> mapping from asset id to dataset type lives in
> [`asset-map.ts`](../src/api-v1/dataspace/source/asset-map.ts).

---

## Universal Data Envelope

Every dataset file shares the same top-level structure:

```json
{
  "metadata": {
    "schemaVersion": "v1",
    "datasetType": "<type-id>",
    "dataProviderId": "<provider>",
    "dcatSchemaRef": "<url-to-jsonld-schema>",
    "createdAt": "<ISO8601>",
    "year": 2025,
    "dateRange": { "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" },
    "location": { "lat": 0.0, "lon": 0.0 },
    "recordCount": 0,
    "license": "https://creativecommons.org/licenses/by/4.0/",
    "units": { "<field>": "<unit>" }
  },
  "dataset": {
    "format": "rows | columnar",
    "records": [ ... ]          // when format = "rows"
    "index": ["Date", "Time"],  // when format = "columnar"
    "columns": { ... }          // when format = "columnar"
  }
}
```

Two dataset formats exist:
- **`rows`** — array of record objects under `dataset.records`
- **`columnar`** — parallel arrays keyed by column name under `dataset.columns`, with `dataset.index` listing the key columns

---

## Dataset Types & Schemas

### `recogidas_playa` — Coastal plastic cleanup (App UP v7)

**Metadata schema:** [`recogidas_plastico_app_up_v700_v1.jsonld`](../metadata/DCAT/recogidas_plastico_app_up_v700.jsonld)  
**Format:** `rows` — one record per cleanup event  
**Date format:** `YYYY-MM-DD`

```json
{
  "Date": "2025-11-07",
  "Start point": "41.437,2.244",
  "End point": "41.437,2.242",
  "Plastic waste collected": 0.5,
  "Number of participants": 2,
  "Walking distance": 1.54,
  "Cleanup duration": "0:28:38",
  "Polyethylene terephthalate (%)": 42.7,
  "High-density polyethylene (%)": 21.62,
  "Polyvinyl chloride (%)": 8.11,
  "Low-density polyethylene (%)": 22.16,
  "Polypropylene (%)": 5.41,
  "Polystyrene (%)": 0.0,
  "Others (%)": 0.0,
  "Collected waste image": "<url1> | <url2> | ..."
}
```

| Field | Unit | Notes |
|-------|------|-------|
| `Plastic waste collected` | kg | |
| `Start point` / `End point` | lat,lon decimal degrees | Encoded as string `"lat,lon"` |
| `Walking distance` | km | |
| `Cleanup duration` | HH:MM:SS | |
| Polymer percentages | % | Sum to 100; column names include ` (%)` suffix |
| `Collected waste image` | URL | Multiple URLs pipe-separated |

---

### `boya_biomasa_slx+` — Fish biomass buoy (Satlink SLX+)

**Metadata schema:** [`boya_biomasa_slx+_v1.jsonld`](../metadata/DCAT/boya_biomasa_slx+.jsonld)  
**Format:** `rows` — multiple readings per day  
**Date format:** `YYYY-MM-DD`

```json
{
  "Date": "2025-12-06",
  "Time": "10:10:00",
  "Biomass depth -3_-5 m": 23.0,
  "Biomass depth -5.00_-8 m": 5.0,
  "Biomass depth -8.00_-11 m": 1.0
}
```

| Field | Unit | Notes |
|-------|------|-------|
| `Biomass depth -3_-5 m` | Tonnes | Column naming inconsistent: `-3_-5` vs `-5.00_-8` |
| `Biomass depth -5.00_-8 m` | Tonnes | |
| `Biomass depth -8.00_-11 m` | Tonnes | |
| `Biomass depth -11.00_-16 m` | Tonnes | Only present in Gijón file |

High-frequency data: many readings per day, 868–3611 records per file.

---

### `boya_microplasticos_seabot` — Microplastics buoy (Seabot / µFTIR)

**Metadata schema:** [`boya_microplasticos_seabot_v1.jsonld`](../metadata/DCAT/boya_microplasticos_seabot.jsonld)  
**Format:** `rows` — one record per plastic particle detected  
**Date format:** `DD-MM-YYYY` ← differs from all other datasets

```json
{
  "Date": "18-02-2026",
  "Particle_ID": 1,
  "Size": "Mesoplastics",
  "Form": "Line",
  "Type_of_Polymer": "Polyethylene",
  "Colour": "Red"
}
```

| Field | Allowed values |
|-------|----------------|
| `Size` | `Microplastics` (<5 mm), `Mesoplastics` (5–25 mm), `Macroplastics` (≥25 mm) |
| `Form` | `Line`, `Fragment`, `Foam`, `Film`, `Pellet`, `Tangle` |
| `Type_of_Polymer` | `Polyethylene`, `Polypropylene`, `Polystyrene`, `Ethylene Propylene Diene Monomer`, `Poly(dimer-acid-co-alkyl polyamine)`, `Polyester (polyester fibre)` |
| `Colour` | `Red`, `Yellow`, `Grey`, `Orange`, `Blue`, `White/transparent`, `Green`, `Violet`, `Black`, `White-Grey` |

Polymer identification method: micro-Fourier Transform Infrared Spectroscopy (µFTIR).

---

### `atmosfera_previa_evento` — Atmospheric data, pre-event window (ERA5 / CDS)

**Metadata schema:** `atmosfera_cds_v1.jsonld` *(published in the space; not versioned in this repository)*  
**Format:** `rows` — **nested structure**: each top-level record represents one cleanup event with 7 days of prior daily atmospheric readings embedded inside  
**Date format:** `YYYY-MM-DD`

```json
{
  "event_date": "2025-11-07",
  "location": { "lat": 41.4377, "lon": 2.2442 },
  "atmosfera_previa": {
    "dateRange": { "start": "2025-10-31", "end": "2025-11-07" },
    "recordCount": 8,
    "records": [
      {
        "date": "2025-10-31",
        "air_temperature": 16.0441,
        "atmospheric_pressure": 994.5965,
        "precipitation": 0.0,
        "solar_radiation": 10.9928,
        "wind_u": 2.152,
        "wind_v": 0.0342,
        "wind_speed": 2.1523,
        "wind_direction": 89.09,
        "cloud_cover": 0.8249,
        "nao_index": -0.96,
        "soi_index": 1.5
      }
    ]
  }
}
```

| Field | Unit | Source |
|-------|------|--------|
| `air_temperature` | °C | ERA5 2m_temperature |
| `atmospheric_pressure` | hPa | ERA5 |
| `precipitation` | mm | ERA5 total_precipitation |
| `solar_radiation` | MJ/m² | ERA5 surface_solar_radiation_downwards |
| `wind_u` / `wind_v` | m/s | ERA5 10m wind components |
| `wind_speed` | m/s | Derived: sqrt(u²+v²) |
| `wind_direction` | degree | |
| `cloud_cover` | fraction [0–1] | ERA5 |
| `nao_index` | dimensionless | North Atlantic Oscillation |
| `soi_index` | dimensionless | Southern Oscillation Index |

One top-level record per cleanup event; nested `records` array has 7–8 daily entries (prior week).

---

### `oceanografia_previa_evento` — Oceanographic data, pre-event window (Copernicus Marine / CMEMS)

**Metadata schema:** `oceanografia_cdse_v1.jsonld` *(published in the space; not versioned in this repository)*  
**Format:** `rows` — same **nested structure** as `atmosfera_previa_evento`  
**Date format:** `YYYY-MM-DD`

```json
{
  "event_date": "2025-11-07",
  "location": { "lat": 41.4377, "lon": 2.2442 },
  "oceanografia_previa": {
    "dateRange": { "start": "2025-10-31", "end": "2025-11-07" },
    "recordCount": 8,
    "records": [
      {
        "date": "2025-10-31",
        "current_east": 0.0428,
        "current_north": 0.0171,
        "sea_surface_temperature": 20.0846,
        "surface_salinity": 37.7673,
        "mean_wave_direction": 185.1509,
        "significant_wave_height": 0.4991,
        "mean_wave_period": 3.3125,
        "stokes_drift_east": 0.0191,
        "stokes_drift_north": 0.0259,
        "wind_east": 2.356,
        "wind_north": 0.7319
      }
    ]
  }
}
```

| Field | Unit | Source |
|-------|------|--------|
| `current_east` / `current_north` | m/s | CMEMS uo/vo (cmems_mod_glo_phy_my_0.083deg_P1D-m) |
| `sea_surface_temperature` | °C | CMEMS thetao |
| `surface_salinity` | PSU | CMEMS so |
| `mean_wave_direction` | degree | CMEMS |
| `significant_wave_height` | m | CMEMS |
| `mean_wave_period` | s | CMEMS |
| `stokes_drift_east` / `stokes_drift_north` | m/s | CMEMS |
| `wind_east` / `wind_north` | m/s | CMEMS |

---

### `environmental_boya` — Environmental/met-ocean buoy (Meteomatics)

**Metadata schema:** [`environmental_meteomatics_v1.jsonld`](../metadata/DCAT/meteorología_cdse_vl.jsonld)  
**Format:** `columnar` — parallel arrays indexed by `Date` + `Time`  
**Date format:** `YYYY-MM-DD`, **Time:** `HH:MM:SS`

```json
{
  "dataset": {
    "format": "columnar",
    "index": ["Date", "Time"],
    "columns": {
      "Date": ["2025-11-28", "2025-11-28", ...],
      "Time": ["00:00:00", "01:00:00", ...],
      "absolute_humidity": [8.5, 8.3, ...],
      "air_temperature": [15.2, 15.0, ...],
      ...
    }
  }
}
```

| Field | Unit |
|-------|------|
| `absolute_humidity` | g/m³ |
| `total_cloud_cover` | % |
| `precipitation_24h` | mm |
| `mean_wind_direction` | degree |
| `wind_speed` | m/s |
| `solar_power` | kW |
| `uv_index` | index |
| `atmospheric_pressure` | Pa |
| `air_temperature` | °C |
| `sea_surface_temperature` | °C |
| `surface_ocean_salinity` | PSU |
| `mean_direction_total_swell` | degree |
| `mean_period_total_swell` | s |
| `mean_wave_direction` | degree |
| `mean_wave_period` | s |
| `max_individual_wave_height` | m |
| `ocean_current_direction` | degree |
| `ocean_current_speed` | m/s |
| `nao_index` | dimensionless |
| `so_index` | dimensionless |

High-frequency: hourly readings, 1537–3865 records per file. This is the richest dataset type combining atmospheric + oceanographic variables in one file.

---

## Metadata Schemas (DCAT/JSON-LD)

Each dataset type has a DCAT/JSON-LD schema describing its expected fields and
units. Six of them are versioned in [`metadata/DCAT/`](../metadata/DCAT/) and
linked below; the providers also publish one per dataset as an asset in the space.
The *instance* metadata — publisher, license, spatial and temporal coverage —
travels inside each dataset's own `metadata` block, not in the schema.

**Which copy validates a dataset.** The published one, when it can be read; the
bundled one otherwise. In order:

| Order | Source | When |
|---|---|---|
| 1 | `dataspace` | The document the provider publishes, mapped in `NON_DATA_ASSETS` by `dcatFor` |
| 2 | `local` | The copy in `metadata/DCAT/`, when the published one cannot be read |
| 3 | `remote` | The URL the dataset itself declares in `metadata.dcatSchemaRef` |

The published document goes first because it is what the provider is actually
offering: the bundled copy is a snapshot of it and can drift. The bundled copy
stays as the fallback rather than being deleted, because reading from the space is
a contract negotiation that can fail, and losing the column check because a
connector was slow is worse than validating against a slightly older schema.

Which one answered is recorded on the asset, in `dcatSchemaSource` and
`dcatSchemaId` — otherwise nothing in the read model would say whether a dataset
was checked against its provider's schema or against a copy in this repository.

The schema assets themselves are still skipped at ingest: one would become an
asset with no observations and no location. They are recognised by name
(`esquema_datos*`, `metadatos*`, `dcat*`) and the type each describes is resolved
by `dcatTypeFromName`, which reads either convention seen so far — the type id
(`esquema_datos_recogidas_playa`) or the dataset (`Metadatos Boya biomasa
Gijón`). As with every other name in this system, the result is a *suggestion*:
`npm run assets:refresh -- --write` writes it into the table and the diff is
reviewed.

| Schema | Dataset type | Fields described | Places offered |
|------|-------------|-----------------|----------------|
| `atmosfera_cds_v1.jsonld` *(published in the space; not versioned in this repository)* | `atmosfera_previa_evento` | air_temperature, wind, pressure, humidity, precipitation, solar radiation, cloud cover, NAO/SOI | Badalona, Barcelona, Blanes, Gijón, Tenerife |
| `oceanografia_cdse_v1.jsonld` *(published in the space; not versioned in this repository)* | `oceanografia_previa_evento` | ocean currents, SST, salinity, wave height/period/direction, Stokes drift | Badalona, Barcelona, Gijón, Tenerife |
| [`environmental_meteomatics_v1.jsonld`](../metadata/DCAT/meteorología_cdse_vl.jsonld) | `environmental_boya` | Combined met-ocean: humidity, cloud, precipitation, wind, solar, UV, pressure, temp, SST, salinity, swell, waves, currents, NAO/SO | Badalona, Cádiz, Gijón |
| [`boya_biomasa_slx+_v1.jsonld`](../metadata/DCAT/boya_biomasa_slx+.jsonld) | `boya_biomasa_slx+` | Fish biomass by depth layer (Tonnes), Satlink SLX+ acoustic echosounder | Badalona, Cádiz, Gijón |
| [`boya_microplasticos_seabot_v1.jsonld`](../metadata/DCAT/boya_microplasticos_seabot.jsonld) | `boya_microplasticos_seabot` | Per-particle: Size, Form, Polymer type (µFTIR), Colour | Badalona, Cádiz, Gijón |
| [`recogidas_plastico_app_up_v700_v1.jsonld`](../metadata/DCAT/recogidas_plastico_app_up_v700.jsonld) | `recogidas_playa` | Date, GPS start/end, plastic weight (kg), participants, distance, duration, polymer composition (%) | Badalona, Barcelona, Blanes, Tenerife |
| [`muestras_de_agua_py_gcms_v1.jsonld`](../metadata/DCAT/muestras_de_agua_py_gcms.jsonld) | `muestras_de_agua_py_gcms` | Per-polymer concentration in water (μg/L): PE, PP, PS, PVC, PET, PA, PC, PU, ABS, PMMA, POM | Badalona, Gijón, Tenerife |
| [`muestras_de_peces_py_gcms_v1.jsonld`](../metadata/DCAT/muestras_de_peces_py_gcms.jsonld) | `muestras_de_peces_py_gcms` | Per-polymer concentration in fish tissue (μg/g): same polymer list as water samples | Badalona, Gijón, Tenerife |

---

## Data Quality Issues Found

Keyed by dataset and place, because a provider can republish an asset under a new
name at any time. The three coordinate defects are corrected at ingest by
[`asset-location.ts`](../src/api-v1/dataspace/asset-location.ts), which is keyed
by asset id and records every deviation as a warning; the identifier spellings are
resolved by the organization's `dataProviderIds`.

| Dataset | Place | Issue |
|---|---|---|
| `boya_microplasticos_seabot` | Badalona | Date format is `DD-MM-YYYY` instead of `YYYY-MM-DD` |
| `recogidas_playa` (Innoceana) | Tenerife | `location` reads `{ lat: 31.483, lon: -11.926 }` — open Atlantic, ~1 000 km from Tenerife (28.1°N, 16.6°W) |
| `recogidas_playa` (Gijón Surf Hostel) | Gijón | Same wrong coordinates, and the records are identical to the Tenerife dataset |
| `boya_biomasa_slx+` | Gijón | `location.lon = 5.679` (positive); Gijón is at `-5.679` |
| `recogidas_playa` | Badalona | `dataProviderId` is ``universal`plastic`` (backtick typo) |
| `recogidas_playa` | Blanes | Same backtick typo |
| `boya_biomasa_slx+` | Cádiz | `dataProviderId` is `universalplastic` (no underscore) |
| `boya_biomasa_slx+` | Gijón | Same — `universalplastic` |
| `boya_biomasa_slx+` | Badalona | `dataProviderId` is `portbadalona` (no underscore) |
| `atmosfera_previa_evento`, `oceanografia_previa_evento` | several | `dateRange.start` after `dateRange.end` in some events |

---

## Plot Data Sources

Three categories are used below:

| Symbol | Meaning |
|--------|---------|
| **Real** | Value taken from an ingested dataset with no modification |
| **Calibrated** | Synthetic daily series whose mean and standard deviation are seeded from a real ingested dataset; individual daily values carry pseudo-random noise |
| **Synthetic** | Entirely generated from a hash-seeded PRNG; no observed data involved |

Every **Calibrated** row falls back to **Synthetic** when no dataset of that type
is within reach of the requested point. Which way it went for a given run is
readable in the response: `meta.datasetsUsed` counts the datasets actually used
per category.

### Per-plot breakdown

| # | Plot name | Variable | Dataset type | Data status |
|---|-----------|----------|----------------|-------------|
| 1 | Mean Microplastics Concentration | `mp_per_L` | `muestras_de_agua_py_gcms` | **Calibrated** |
| 2 | Microplastics Over Time | `mp_per_L` series | `muestras_de_agua_py_gcms` | **Calibrated** |
| 3 | BCF Distribution | `mp_per_L`, fish factor | `muestras_de_agua_py_gcms` | **Calibrated** (fish factor synthetic) |
| 4 | Water vs Fish Microplastics | `mp_per_L`, `mp_per_kg_fish` | `muestras_de_agua_py_gcms` | **Calibrated** (`mp_per_kg_fish` synthetic) |
| 5 | Polymer Correlation | polymer composition % | — | **Synthetic** |
| 6 | Exposure Index | `mp_per_L` | `muestras_de_agua_py_gcms` | **Calibrated** |
| 6 | Exposure Index | `biomass` (daily Tonnes) | `boya_biomasa_slx+` | **Calibrated** |
| 7 | Plastic Pressure Composition | `mp_per_L` | `muestras_de_agua_py_gcms` | **Calibrated** |
| 7 | Plastic Pressure Composition | `kgTotal`, `coastLengthKm` | `recogidas_playa` | **Calibrated** |
| 8 | Coastal Pressure Index (IPC) | `kgTotal`, `coastLengthKm` | `recogidas_playa` | **Calibrated** |
| 8 | Coastal Pressure Index (IPC) | `envFactor` (from `wind_speed`) | `environmental_boya` | **Calibrated** |
| 9 | Coastal Source Index (CSI) | `mp_per_L` | `muestras_de_agua_py_gcms` | **Calibrated** |
| 9 | Coastal Source Index (CSI) | `kgTotal` | `recogidas_playa` | **Calibrated** |
| 10 | Spatial Distribution of Impact | `mp_per_L` (mean) | `muestras_de_agua_py_gcms` | **Calibrated** |
| 11 | Basic Contamination Summary | `mp_per_L` mean/std/cv | `muestras_de_agua_py_gcms` | **Calibrated** |
| 12 | Buoy vs Water Concordance | `buoyPolymers` | `boya_microplasticos_seabot` | **Real** |
| 12 | Buoy vs Water Concordance | `waterPolymers` | `muestras_de_agua_py_gcms` | **Real** |
| 13 | Water vs Fish Polymer Similarity | polymer composition % | — | **Synthetic** |

> **`mp_per_L` changed status.** It used to be synthetic in every plot, because no
> `muestras_de_agua_py_gcms` dataset was published anywhere. One is now offered in
> the space (Gijón), and the engine already reads it: when a water-sample dataset
> is near the requested point, the series is centred on its real mean with its real
> standard deviation as the half-width, and `waterPolymers` is the observed polymer
> list rather than a drawn one. Without one, `mp_per_L` falls back to a value
> derived from the coordinates and the radius — see the comment at
> [`analyses.service.ts`](../src/api-v1/analyses/analyses.service.ts) where
> `s3MpBase` is resolved. The precision report has not yet been re-run against
> this: [`validacion-precision.md`](validacion-precision.md) still describes the
> earlier state.

---

### Which dataset answers a request

Selection is by **coast**, not by distance. A request is assigned to one of three
coastlines — Mediterranean, Atlantic (Gulf of Cádiz and the Canaries) or
Cantabrian — and only datasets on that coast may answer it. Within the coast, the
nearest one wins. A coast with no dataset of a category falls back to the
calibration series; it never borrows from another sea.

The rule lives in [`coastline.ts`](../src/api-v1/dataspace/coastline.ts), which
matches a point against a polyline of coastal vertices per coast. A point more
than 100 km from all of them belongs to no coast, and `POST /v1/analyses/run`
answers **400** rather than serving figures from the least-distant sea.

| Request location | `boya_biomasa` | `recogidas_playa` | `environmental_boya` | `boya_microplasticos` | `muestras_de_agua` |
|---|---|---|---|---|---|
| **Badalona** · mediterránea | Badalona | Badalona | Badalona | Badalona | Badalona |
| **Barcelona** · mediterránea | Badalona (52 km) | Barcelona | Badalona (52 km) | Badalona (52 km) | Badalona (52 km) |
| **Blanes** · mediterránea | Badalona (53 km) | Blanes | Badalona (53 km) | Badalona (53 km) | Badalona (53 km) |
| **Cádiz** · atlántica | Cádiz | Tenerife (1 345 km) | Cádiz | Cádiz | Tenerife (1 345 km) |
| **Tenerife** · atlántica | Cádiz (1 345 km) | Tenerife | Cádiz (1 345 km) | Cádiz (1 345 km) | Tenerife |
| **Gijón** · cantábrica | Gijón | Gijón | Gijón | Gijón | Gijón |

Every coast now holds a dataset of all eight categories, so no request falls back
to the calibration series for want of coverage. What the table still shows is
distance: the Atlantic coast spans the mainland and the Canaries, so Cádiz and
Tenerife answer for each other across 1 345 km for the categories only one of
them publishes. Same water body, but worth knowing when reading a result — which
is why `meta.datasetsUsed` reports what was actually used.

Galicia is on the Cantabrian coast, which is a decision rather than a fact of
geography: it faces the Atlantic, but it is one continuous northern coast and
Gijón is both the nearest data and the same body of water. Treating it as
Atlantic would reach for Cádiz, 900 km south, for every Galician request.

---

### Analysis archive upload path

The only object storage left in this document, and it is a **write**: the API
archives what it produces. Nothing is ever read back from it.

With `options.savePlotsWebp: true` the full result is uploaded under the basin of
the requested point:

```
public/{ocean}/universal_plastic/analise-{YYYY-MM-DD}/
  report.pdf     ← all 13 plots, one page each
  result.json    ← full API response JSON
```

The folder is dated, not per request, so two runs on the same day and the same
basin overwrite each other. The basin comes from `AssetsRepository.oceanFor()`,
which asks the read model for
the nearest **observed** dataset and returns its ocean. Calibration series are
excluded on purpose: one of them sits in open water off the Balearics and would
file Atlantic runs under the Mediterranean. When nothing places the point the
folder is `sin-ubicar`, never a real basin guessed by default.

| Ocean | Covers locations |
|-------|-----------------|
| `mediterraneo` | Badalona, Barcelona, Blanes |
| `atlantico` | Cádiz, Tenerife |
| `catambrico` | Gijón |
| `sin-ubicar` | anything the read model cannot place |

---

## Superseded assets

A provider republishing a dataset does not always withdraw the old asset. The
`_v1.1` round left two behind:

| Still offered | Superseded by |
|---|---|
| `Oceanografía Barcelona` (`31f505fb`) | `Oceanografía Barcelona_v1.1` |
| `Recogidas playas Barcelona ` (`0ac35a36`, Innoceana) | `Recogidas playas Barcelona_v1.1` |

`parseCatalog` ignores them and says so once per scan. The rule is per provider
and by version number: among assets whose names fold to the same thing, the
highest version wins, and a name with no suffix sorts below every version.

Why it is worth doing rather than waiting for them to be unpublished: both pairs
sit at the same station coordinates, so `nearest()` — which orders by distance —
picked between them arbitrarily. The older asset is the one the incident emptied,
so about half the time a category found an asset with no observations, fell
through to the calibration series, and reported a substituted figure with a good
asset sitting beside it. Correct-looking, and silent.

They should still be unpublished; the rule is a guard, not a fix.

---

## Calibration series

Five assets in UP's catalog are not measurements of anywhere. One per category,
generated by [`reference-datasets.ts`](../src/api-v1/dataspace/reference-datasets.ts)
and published so the engine has something to fall back on when a request lands
where no participant has published.

| Asset | Dataset type | Id |
|---|---|---|
| `Boya_biomasa_referencia` | `boya_biomasa_slx+` | `e22252f6` |
| `Recogidas_playas_referencia` | `recogidas_playa` | `fdd003f7` |
| `Environmental_referencia` | `environmental_boya` | `85add085` |
| `Boya_microplasticos_referencia.` | `boya_microplasticos_seabot` | `c1c71785` |
| `muestras_de_agua_referencia` | `muestras_de_agua_py_gcms` | `a69dc135` |

They are held in `REFERENCE_ASSETS`, apart from `ASSET_MAP`, and classified into
the `reference` tier by asset id rather than by publisher: UP publishes both
these and real datasets, so classifying by participant would file a synthetic
series in open water as observed data. They carry no place and no station, and
sit at 40.5 N, 2.5 E — Balearic open water, far from every station.

`POST /v1/analyses/run` is the only endpoint that reads them, and only for a
category with no observed dataset holding data near the requested point. The
response says which categories were answered with observed data in
`meta.datasetsUsed`.

---

## Known Gaps

- **Fish samples** (`muestras_de_peces_py_gcms`) are published for Badalona, Gijón
  and Tenerife but are not wired into any indicator yet
  (`meta.datasetsUsed.fish_samples` is hard-coded to 0).
- Coverage is complete by coast, not by place: `boya_biomasa_slx+`,
  `boya_microplasticos_seabot` and `environmental_boya` exist at Badalona, Cádiz
  and Gijón, and `muestras_de_agua_py_gcms` / `muestras_de_peces_py_gcms` at
  Badalona, Gijón and Tenerife. Every coast has one of each; no single place has
  all eight.
- **BCSS** is a participant in the space and its connector answers, but it offers no dataset to us.
- Cádiz has no atmospheric or oceanographic dataset; the Atlantic coast is covered
  for both by Tenerife.
- Two pre-incident assets are still offered alongside their `_v1.1` replacement:
  `Oceanografía Barcelona` (`31f505fb`) and `Recogidas playas Barcelona `
  (`0ac35a36`, Innoceana). Both should be unpublished — see below.
- The **schema and metadata assets** have been republished, one DCAT document per
  dataset. They are skipped as assets and read as schemas: see
  [Metadata Schemas](#metadata-schemas-dcatjson-ld) above. `npm run assets:refresh`
  prints which types have a published schema and which fall back to the bundled
  copy.
- `atmosfera_previa_evento` and `oceanografia_previa_evento` have **no bundled
  schema**, so until their published documents are mapped and readable their
  columns are checked against nothing at all. That is the gap this closes.
- `atmosfera_previa_evento` and `oceanografia_previa_evento` contain very few events per location (1–8 cleanup events); they are event-relative snapshots, not continuous time series.
- The `environmental_boya` files are the only true continuous time-series covering months of hourly data and combining both atmospheric and oceanographic variables.
