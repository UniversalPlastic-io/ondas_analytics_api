# Data space sync + identity — operations

How to run the ONDAs API now that it serves Blue Resilience from Mongo.
Design rationale: [`dspacer-integration.md`](dspacer-integration.md).

---

## 1. Setup

```bash
cp .env.example .env      # set MONGODB_URI, PORTAL_JWT_SECRET and DSPACER_*
npm ci
npm run seed              # organizations + users (prints passwords once)
npm run backfill          # fills Mongo from the data space catalog
npm run start:dev
```

`npm run seed` is idempotent — it skips anything that already exists. It creates
the five data space participants (`universal_plastic`, `innoceana`,
`port_badalona`, `gijon_surf_hostel`, `bcss`), one `provider` user each, and one
`admin`. Passwords come from `config/portal-connectors.local.json` when that file
exists, otherwise they are generated and printed **once**.

`npm run backfill` runs the same scan the API exposes, as an admin:

```bash
npm run backfill                       # every provider that offers us a contract
npm run backfill -- --dry-run          # report the plan, write nothing
npm run backfill -- --force            # re-ingest even if unchanged
npm run backfill -- --provider innoceana
```

## 2. Telling the API about a new asset

There is no scheduler. After a participant publishes an asset and grants a
contract, call the API. Assets are named by the id their provider's connector
assigned, which is what the catalog reports.

```bash
# one asset, by its id in the space
curl -X POST https://ondas.universalplastic.io/api/v1/sync/assets \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"sourceId":"ddadf21b-0c4d-40c8-97d7-e5cf902a5024"}'

# reconcile everything the space offers us
curl -X POST …/v1/sync/scan -d '{"dryRun":true}'

# or one provider only
curl -X POST …/v1/sync/scan -d '{"provider":"innoceana"}'
```

To find an asset id, read the catalog of its provider, or run
`npm run assets:refresh`, which lists every asset offered to us and flags the ones
this API does not yet recognise.

Both return a run summary: per-asset `action`
(`created|updated|unchanged|missing|failed|skipped`), observation counts and
warnings. History lives at `GET /v1/sync/runs` and `GET /v1/sync/runs/:id`.

**Idempotent, but not free.** The catalog carries no version, date or checksum,
so an asset is only recognisable as unchanged once its content is in hand. Every
sync transfers; what `unchanged` saves is the reprocessing and the write. Pass
`"force": true` to re-ingest anyway (needed after a normalizer change).

**Authorization** happens twice, and the API only ever narrows. The data space
decides what this connector can see at all, through the contracts each provider
granted; on top of that, `admin` syncs anything visible and `provider` only its
own organization's assets. Anything else is `403`.

**Replacing an asset** deletes the previous observations only after the new ones
are written and the asset has been flipped to them, so a reader never sees a
half-replaced dataset.

**`missing` versus `failed`** is a distinction worth knowing. An asset no provider
offers any more is `missing`: its observations are kept and the map marker carries
a warning. An asset that is offered but unreadable — a lapsed contract, or a
provider publishing no resolvable data address — is `failed`, not `missing`,
because it still exists and its observations are still valid.

## 3. Reading

| Endpoint | Auth | Notes |
|---|---|---|
| `GET /v1/overview` | optional | `?period=`, `?campaign=`, `?scope=mine\|all` |
| `GET /v1/map/points` | optional | `?ocean=`, `?datasetType=`, `?provider=`, `?format=geojson`, `?scope=` |
| `POST /v1/reports/request` | none | unchanged contract |
| `POST /v1/analyses/run` | **required** | Bearer token |
| `GET /v1/campaigns\|cleanups\|organizations` | none | marketplace passthrough, untouched |

With a token, reads scope to the caller's organization by default; `?scope=all`
widens to the whole data space. Without a token, everything is visible. Admins
are never narrowed.

## 4. Identity

```bash
POST /v1/auth/login    {"username":"<email>","password":"…"}   # username also accepts a legacy connector name
GET  /v1/auth/me
POST /v1/admin/organizations   # admin only
POST /v1/admin/users           # admin only
PUT  /v1/admin/users/password  # admin only
```

Roles: `admin` (everything), `provider` (sync its own organization, read),
`viewer` (read).

An organization is a data space participant: its `slug`, every spelling of its
`dataProviderId` found in the published assets, and the provider folders it owns —
the names by which its assets are attributed to it.

## 5. Operational notes

- **Connector credentials.** `DSPACER_*` is only needed to sync. Every analytic
  endpoint reads from Mongo, so the API boots and serves an already populated read
  model without them; the failure surfaces on the first sync.
- **The access token lives 300 seconds**, less than a full scan. The client
  renews it mid-scan on its own.
- **A provider that fails is isolated.** Its catalog request is reported as a run
  warning and the rest of the space still syncs, rather than one unreachable
  connector emptying the read model.
- **Assets get republished under new ids.** When that happens, an asset absent
  from `ASSET_MAP` is classified from its name and the run says so. Run
  `npm run assets:refresh` to see what changed, and `-- --write` to record it.
- **Warnings are data.** Each asset stores the corrections and DCAT deviations
  found at ingest; they surface on map markers. A file with warnings is still
  served — read them rather than assuming the data is clean.
- **The DCAT a dataset is validated against comes from the space first**, from
  the bundled copy in `metadata/DCAT/` when it cannot be read. Which one answered
  is on the asset, in `dcatSchemaSource` and `dcatSchemaId`; why the published one
  was not used is in the run's warnings, once per type rather than once per
  asset. See [dataset-mapping.md](dataset-mapping.md#metadata-schemas-dcatjson-ld).
- **Re-ingest after changing a normalizer**, otherwise stored observations keep
  the old shape: `npm run backfill -- --force`.
