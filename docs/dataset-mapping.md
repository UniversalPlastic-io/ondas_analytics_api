# Dataset Mapping

> **Scope.** The dataset types, their schemas, units and known data-quality issues
> below are **independent of where the data comes from** — they describe what a
> participant publishes, not how it is fetched. They are the reference for the
> container validation and the field normalizer.
>
> The sections marked *(legacy source layout)* describe the object-storage layout
> that preceded consumption through the data space connector. They are kept because
> the read model still carries the corrections derived from them, and because they
> document the provenance of every dataset currently ingested. The current flow is
> in [dspacer-integration.md](dspacer-integration.md).

**Bucket:** `universalplastic-sedia`  
**Region:** `eu-central-1`  
**Base URL:** `https://universalplastic-sedia.s3.eu-central-1.amazonaws.com/public/`

---

## Ocean Mapping Strategy *(legacy source layout)*

When a location is received (lat/lon), the API selects the closest ocean basin and loads data from the corresponding S3 prefix.

| Ocean | S3 Prefix | Coverage |
|-------|-----------|----------|
| Mediterráneo | `public/mediterraneo/` | Barcelona, Badalona, Blanes |
| Atlántico | `public/atlantico/` | Cádiz, Tenerife (Canary Islands) |
| Cantábrico | `public/catambrico/` | Gijón |

> **Note:** the S3 prefix uses `catambrico` (typo), not `cantabrico`.

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

**Metadata schema:** [`recogidas_plastico_app_up_v700_v1.jsonld`](https://universalplastic-sedia.s3.eu-central-1.amazonaws.com/public/metadatos/recogidas_plastico_app_up_v700_v1.jsonld)  
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

**Metadata schema:** [`boya_biomasa_slx+_v1.jsonld`](https://universalplastic-sedia.s3.eu-central-1.amazonaws.com/public/metadatos/boya_biomasa_slx%2B_v1.jsonld)  
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

**Metadata schema:** [`boya_microplasticos_seabot_v1.jsonld`](https://universalplastic-sedia.s3.eu-central-1.amazonaws.com/public/metadatos/boya_microplasticos_seabot_v1.jsonld)  
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

**Metadata schema:** [`atmosfera_cds_v1.jsonld`](https://universalplastic-sedia.s3.eu-central-1.amazonaws.com/public/metadatos/atmosfera_cds_v1.jsonld)  
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

**Metadata schema:** [`oceanografia_cdse_v1.jsonld`](https://universalplastic-sedia.s3.eu-central-1.amazonaws.com/public/metadatos/oceanografia_cdse_v1.jsonld)  
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

**Metadata schema:** [`environmental_meteomatics_v1.jsonld`](https://universalplastic-sedia.s3.eu-central-1.amazonaws.com/public/metadatos/environmental_meteomatics_v1.jsonld)  
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

## Datasets by Ocean and Provider

### Mediterráneo

| File | datasetType | Provider ID | Location (lat, lon) | Records | Date range | Format |
|------|-------------|-------------|---------------------|---------|------------|--------|
| `innoceana/recogidas_playas_barcelona.json` | `recogidas_playa` | `innoceana` | 41.670, 2.790 | 2 | 2025-09-20 → 2025-11-10 | rows |
| `port_badalona/boya_biomasa_badalona.json` | `boya_biomasa_slx+` | `portbadalona` | 41.434, 2.243 | 3611 | 2025-12-06 → 2026-05-11 | rows |
| `port_badalona/boya_microplasticos_badalona.json` | `boya_microplasticos_seabot` | `portbadalona` | 41.434, 2.243 | 105 | 2026-02-18 (single day) | rows |
| `universal_plastic/atmosfera_badalona.json` | `atmosfera_previa_evento` | `universal_plastic` | 41.438, 2.244 | 1 event | 2025-10-31 → 2025-11-07 | rows (nested) |
| `universal_plastic/atmosfera_barcelona.json` | `atmosfera_previa_evento` | `universal_plastic` | — | 1 event | 2025-11-03 → 2025-11-10 | rows (nested) |
| `universal_plastic/atmosfera_blanes.json` | `atmosfera_previa_evento` | `universal_plastic` | — | 1 event | 2026-01-08 → 2026-01-15 | rows (nested) |
| `universal_plastic/environmental_badalona.json` | `environmental_boya` | `universal_plastic` | 41.434, 2.243 | 3865 | 2025-11-28 → 2026-05-08 | columnar |
| `universal_plastic/oceanografia_badalona.json` | `oceanografia_previa_evento` | `universal_plastic` | 41.438, 2.244 | 1 event | 2025-10-31 → 2025-11-07 | rows (nested) |
| `universal_plastic/oceanografia_barcelona.json` | `oceanografia_previa_evento` | `universal_plastic` | — | 1 event | 2025-11-03 → 2025-11-10 | rows (nested) |
| `universal_plastic/oceanografia_blanes.json` | `oceanografia_previa_evento` | `universal_plastic` | — | 1 event | 2026-01-08 → 2026-01-15 | rows (nested) |
| `universal_plastic/recogidas_playas_badalona.json` | `recogidas_playa` | `universal\`plastic` ⚠ | 41.438, 2.244 | 1 | 2025-11-07 | rows |
| `universal_plastic/recogidas_playas_blanes.json` | `recogidas_playa` | `universal\`plastic` ⚠ | — | 1 | 2026-01-15 | rows |

---

### Atlántico

| File | datasetType | Provider ID | Location (lat, lon) | Records | Date range | Format |
|------|-------------|-------------|---------------------|---------|------------|--------|
| `innoceana/recogidas_playa_tenerife.json` | `recogidas_playa` | `innoceana` | 31.483, -11.926 ⚠ | 8 | 2025-04-10 → 2025-11-10 | rows |
| `universal_plastic/atmosfera_tenerife.json` | `atmosfera_previa_evento` | `universal_plastic` | 28.188, -16.660 | 7 events | 2025-04-03 → 2026-04-07 | rows (nested) |
| `universal_plastic/boya_biomasa_cadiz.json` | `boya_biomasa_slx+` | `universalplastic` | 36.396, -6.208 | 1544 | 2026-03-10 → 2026-05-11 | rows |
| `universal_plastic/environmental_cadiz.json` | `environmental_boya` | `universal_plastic` | 36.530, -6.290 | 1537 | 2026-03-05 → 2026-05-08 | columnar |
| `universal_plastic/oceanografia_tenerife.json` | `oceanografia_previa_evento` | `universal_plastic` | 28.188, -16.660 | 7 events | 2025-04-03 → 2026-04-07 | rows (nested) |

---

### Cantábrico (`catambrico/`)

| File | datasetType | Provider ID | Location (lat, lon) | Records | Date range | Format |
|------|-------------|-------------|---------------------|---------|------------|--------|
| `gijon_surf_hostel/recogidas_playas_gijon.json` | `recogidas_playa` | `gijonsurfhostel` | 31.483, -11.926 ⚠ | 8 | 2025-04-10 → 2025-11-10 | rows |
| `universal_plastic/atmosfera_gijon.json` | `atmosfera_previa_evento` | `universal_plastic` | 43.572, -5.721 | 8 events | 2025-07-01 → 2026-04-27 | rows (nested) |
| `universal_plastic/boya_biomasa_gijon.json` | `boya_biomasa_slx+` | `universalplastic` | 43.568, 5.679 ⚠ | 868 | 2026-01-21 → 2026-05-10 | rows |
| `universal_plastic/environmental_gijon.json` | `environmental_boya` | `universal_plastic` | 43.575, -5.650 | 3457 | 2025-12-15 → 2026-05-08 | columnar |
| `universal_plastic/oceanografia_gijon.json` | `oceanografia_previa_evento` | `universal_plastic` | 43.572, -5.721 | 8 events | 2025-07-01 → 2026-04-27 | rows (nested) |

---

## Metadata Schemas (DCAT/JSON-LD)

Stored under `public/metadatos/`. Describe the expected fields and units for each dataset type. The instance metadata (publisher, license, spatial, temporal) travels inside each data file's `metadata` block.

| File | Dataset type | Fields described | Has data files? |
|------|-------------|-----------------|----------------|
| [`atmosfera_cds_v1.jsonld`](https://universalplastic-sedia.s3.eu-central-1.amazonaws.com/public/metadatos/atmosfera_cds_v1.jsonld) | `atmosfera_previa_evento` | air_temperature, wind, pressure, humidity, precipitation, solar radiation, cloud cover, NAO/SOI | Yes — all 3 oceans |
| [`oceanografia_cdse_v1.jsonld`](https://universalplastic-sedia.s3.eu-central-1.amazonaws.com/public/metadatos/oceanografia_cdse_v1.jsonld) | `oceanografia_previa_evento` | ocean currents, SST, salinity, wave height/period/direction, Stokes drift | Yes — all 3 oceans |
| [`environmental_meteomatics_v1.jsonld`](https://universalplastic-sedia.s3.eu-central-1.amazonaws.com/public/metadatos/environmental_meteomatics_v1.jsonld) | `environmental_boya` | Combined met-ocean: humidity, cloud, precipitation, wind, solar, UV, pressure, temp, SST, salinity, swell, waves, currents, NAO/SO | Yes — Badalona, Cádiz, Gijón |
| [`boya_biomasa_slx+_v1.jsonld`](https://universalplastic-sedia.s3.eu-central-1.amazonaws.com/public/metadatos/boya_biomasa_slx%2B_v1.jsonld) | `boya_biomasa_slx+` | Fish biomass by depth layer (Tonnes), Satlink SLX+ acoustic echosounder | Yes — Badalona, Cádiz, Gijón |
| [`boya_microplasticos_seabot_v1.jsonld`](https://universalplastic-sedia.s3.eu-central-1.amazonaws.com/public/metadatos/boya_microplasticos_seabot_v1.jsonld) | `boya_microplasticos_seabot` | Per-particle: Size, Form, Polymer type (µFTIR), Colour | Yes — Badalona only |
| [`recogidas_plastico_app_up_v700_v1.jsonld`](https://universalplastic-sedia.s3.eu-central-1.amazonaws.com/public/metadatos/recogidas_plastico_app_up_v700_v1.jsonld) | `recogidas_playa` | Date, GPS start/end, plastic weight (kg), participants, distance, duration, polymer composition (%) | Yes — all 3 oceans |
| [`muestras_de_agua_py_gcms_v1.jsonld`](https://universalplastic-sedia.s3.eu-central-1.amazonaws.com/public/metadatos/muestras_de_agua_py_gcms_v1.jsonld) | *(future)* water samples | Per-polymer concentration in water (μg/L): PE, PP, PS, PVC, PET, PA, PC, PU, ABS, PMMA, POM | **No data files yet** |
| [`muestras_de_peces_py_gcms_v1.jsonld`](https://universalplastic-sedia.s3.eu-central-1.amazonaws.com/public/metadatos/muestras_de_peces_py_gcms_v1.jsonld) | *(future)* fish samples | Per-polymer concentration in fish tissue (μg/g): same polymer list as water samples | **No data files yet** |

---

## Folder Structure *(legacy source layout)*

```
public/
├── metadatos/
│   ├── atmosfera_cds_v1.jsonld
│   ├── boya_biomasa_slx+_v1.jsonld
│   ├── boya_microplasticos_seabot_v1.jsonld
│   ├── environmental_meteomatics_v1.jsonld
│   ├── muestras_de_agua_py_gcms_v1.jsonld       ← no data files yet
│   ├── muestras_de_peces_py_gcms_v1.jsonld      ← no data files yet
│   ├── oceanografia_cdse_v1.jsonld
│   └── recogidas_plastico_app_up_v700_v1.jsonld
│
├── mediterraneo/
│   ├── innoceana/
│   │   └── recogidas_playas_barcelona.json       (2 records)
│   ├── port_badalona/
│   │   ├── boya_biomasa_badalona.json            (3611 records, hourly)
│   │   └── boya_microplasticos_badalona.json     (105 particles, 1 day)
│   └── universal_plastic/
│       ├── atmosfera_badalona.json               (1 event, 8 nested days)
│       ├── atmosfera_barcelona.json              (1 event, 8 nested days)
│       ├── atmosfera_blanes.json                 (1 event, 8 nested days)
│       ├── environmental_badalona.json           (3865 records, hourly, columnar)
│       ├── oceanografia_badalona.json            (1 event, 8 nested days)
│       ├── oceanografia_barcelona.json           (1 event, 8 nested days)
│       ├── oceanografia_blanes.json              (1 event, 8 nested days)
│       ├── recogidas_playas_badalona.json        (1 record)
│       └── recogidas_playas_blanes.json          (1 record)
│
├── atlantico/
│   ├── innoceana/
│   │   └── recogidas_playa_tenerife.json         (8 records)
│   └── universal_plastic/
│       ├── atmosfera_tenerife.json               (7 events, 8 nested days each)
│       ├── boya_biomasa_cadiz.json               (1544 records, hourly)
│       ├── environmental_cadiz.json              (1537 records, hourly, columnar)
│       └── oceanografia_tenerife.json            (7 events, 8 nested days each)
│
└── catambrico/                                   ← note: typo in bucket
    ├── gijon_surf_hostel/
    │   └── recogidas_playas_gijon.json           (8 records)
    └── universal_plastic/
        ├── atmosfera_gijon.json                  (8 events, 8 nested days each)
        ├── boya_biomasa_gijon.json               (868 records, hourly, +extra depth layer)
        ├── environmental_gijon.json              (3457 records, hourly, columnar)
        └── oceanografia_gijon.json              (8 events, 8 nested days each)
```

---

## Data Quality Issues Found

| File | Issue |
|------|-------|
| `port_badalona/boya_microplasticos_badalona.json` | Date format is `DD-MM-YYYY` instead of `YYYY-MM-DD` |
| `atlantico/innoceana/recogidas_playa_tenerife.json` | `location` field shows `{ lat: 31.483, lon: -11.926 }` — coordinates in the Atlantic Ocean, not Tenerife (28.1°N, 16.6°W) |
| `catambrico/gijon_surf_hostel/recogidas_playas_gijon.json` | Same wrong coordinates as above (`lat: 31.483, lon: -11.926`), identical data to Tenerife file |
| `catambrico/universal_plastic/boya_biomasa_gijon.json` | `location.lon = 5.679` (positive), should be `-5.679` for Gijón |
| `mediterraneo/universal_plastic/recogidas_playas_badalona.json` | `dataProviderId` is `"universal\`plastic"` (backtick typo) |
| `mediterraneo/universal_plastic/recogidas_playas_blanes.json` | Same backtick typo in `dataProviderId` |
| `atlantico/universal_plastic/boya_biomasa_cadiz.json` | `dataProviderId` is `"universalplastic"` (no underscore) |
| `catambrico/universal_plastic/boya_biomasa_gijon.json` | Same — `dataProviderId` is `"universalplastic"` (no underscore) |
| `mediterraneo/port_badalona/boya_biomasa_badalona.json` | `dataProviderId` is `"portbadalona"` (no underscore) |
| Multiple atmosfera/oceanografia files | `dateRange.start` is after `dateRange.end` in some cases (data entry error) |

---

## Plot Data Sources

Three categories are used below:

| Symbol | Meaning |
|--------|---------|
| **Real** | Value taken directly from an S3 file with no modification |
| **S3-calibrated** | Synthetic time series whose mean and std are seeded from real S3 statistics; individual daily values include random noise |
| **Synthetic** | Entirely generated from a hash-seeded PRNG; no S3 data involved |

### Per-plot breakdown

| # | Plot name | Variable | S3 dataset type | Data status |
|---|-----------|----------|----------------|-------------|
| 1 | Mean Microplastics Concentration | `mp_per_L` | — | **Synthetic** |
| 2 | Microplastics Over Time | `mp_per_L` series | — | **Synthetic** |
| 3 | BCF Distribution | `mp_per_L`, fish factor | — | **Synthetic** |
| 4 | Water vs Fish Microplastics | `mp_per_L`, `mp_per_kg_fish` | — | **Synthetic** |
| 5 | Polymer Correlation | polymer composition % | — | **Synthetic** |
| 6 | Exposure Index | `mp_per_L` | — | **Synthetic** |
| 6 | Exposure Index | `biomass` (daily Tonnes) | `boya_biomasa_slx+` | **S3-calibrated** |
| 7 | Plastic Pressure Composition | `mp_per_L` | — | **Synthetic** |
| 7 | Plastic Pressure Composition | `kgTotal`, `coastLengthKm` | `recogidas_playa` | **S3-calibrated** |
| 8 | Coastal Pressure Index (IPC) | `kgTotal`, `coastLengthKm` | `recogidas_playa` | **S3-calibrated** |
| 8 | Coastal Pressure Index (IPC) | `envFactor` (from `wind_speed`) | `environmental_boya` | **S3-calibrated** |
| 9 | Coastal Source Index (CSI) | `mp_per_L` | — | **Synthetic** |
| 9 | Coastal Source Index (CSI) | `kgTotal` | `recogidas_playa` | **S3-calibrated** |
| 10 | Spatial Distribution of Impact | `mp_per_L` (mean) | — | **Synthetic** |
| 11 | Basic Contamination Summary | `mp_per_L` mean/std/cv | — | **Synthetic** |
| 12 | Buoy vs Water Concordance | `buoyPolymers` | `boya_microplasticos_seabot` | **Real** |
| 12 | Buoy vs Water Concordance | `waterPolymers` | — | **Synthetic** |
| 13 | Water vs Fish Polymer Similarity | polymer composition % | — | **Synthetic** |

> `mp_per_L` is kept synthetic for all plots because no `muestras_de_agua_py_gcms` data files exist yet in S3.

---

### Nearest dataset selected per reference location

The API uses equirectangular nearest-neighbor matching independently per dataset type. The table below shows which S3 file is selected for each of the six known geographic locations.

| Request location | `boya_biomasa` → biomass base | `recogidas_playa` → kg base, coast km | `environmental_boya` → env factor | `boya_microplasticos` → buoy polymers |
|---|---|---|---|---|
| **Badalona** (41.43, 2.24) | `boya_biomasa_badalona` | `recogidas_playas_badalona` | `environmental_badalona` | `boya_microplasticos_badalona` |
| **Barcelona** (41.67, 2.79) | `boya_biomasa_badalona` | `recogidas_playas_barcelona` | `environmental_badalona` | `boya_microplasticos_badalona` |
| **Blanes** (41.68, 2.80) | `boya_biomasa_badalona` | `recogidas_playas_blanes` | `environmental_badalona` | `boya_microplasticos_badalona` |
| **Cádiz** (36.53, -6.29) | `boya_biomasa_cadiz` | `recogidas_playas_gijon` ¹ | `environmental_cadiz` | `boya_microplasticos_badalona` |
| **Tenerife** (28.19, -16.66) | `boya_biomasa_cadiz` ² | `recogidas_playa_tenerife` | `environmental_cadiz` ² | `boya_microplasticos_badalona` |
| **Gijón** (43.57, -5.72) | `boya_biomasa_gijon` | `recogidas_playas_gijon` | `environmental_gijon` | `boya_microplasticos_badalona` |

¹ Gijón is the nearest cleanup site to Cádiz (~787 km) because no `recogidas_playa` file exists for the Atlantic coast of mainland Spain.  
² No `boya_biomasa` or `environmental_boya` exists for Tenerife/Canaries; Cádiz is the nearest Atlantic file (~1 090 km).  
`boya_microplasticos` data exists only for Badalona — all locations fall back to it.

---

### Analysis archive upload path

When `options.savePlotsWebp: true`, the full result is also uploaded to the data bucket. The ocean is determined by the same nearest-neighbor logic applied to the whole catalogue:

```
s3://universalplastic-sedia/public/{ocean}/universal_plastic/analise-{requestId}/
  report.pdf     ← all 13 plots, one page each
  result.json    ← full API response JSON
```

| Ocean | Covers locations |
|-------|-----------------|
| `mediterraneo` | Badalona, Barcelona, Blanes |
| `atlantico` | Cádiz, Tenerife |
| `catambrico` | Gijón |

---

## Known Gaps

- **Water samples** (`muestras_de_agua_py_gcms`) and **fish samples** (`muestras_de_peces_py_gcms`) have metadata schemas but no data files in any ocean.
- **Microplastics buoy** (`boya_microplasticos_seabot`) data only exists for Badalona (Mediterráneo) — missing for Atlántico and Cantábrico.
- **bcss** provider folder is referenced in the path convention but has no files in any ocean.
- Atlántico has no atmospheric data for Cádiz, and no coastal cleanup for Cádiz.
- `atmosfera_previa_evento` and `oceanografia_previa_evento` contain very few events per location (1–8 cleanup events); they are event-relative snapshots, not continuous time series.
- The `environmental_boya` files are the only true continuous time-series covering months of hourly data and combining both atmospheric and oceanographic variables.
