# Firewatch

A mobile-friendly, evidence-aware wildfire discovery and incident-intelligence
platform. Firewatch opens on a global view, can localize to a user-approved
coarse area, and keeps source coverage, observation time, and uncertainty
explicit instead of turning missing data into reassurance.

Firewatch was first deployed for the 29 July 2026 Plomari wildfire on Lesvos,
Greece. That view is now preserved as a dated historical incident archive; it
does not present current Fire Service status or assert an official resolution.
The production foundation uses a Supabase/PostGIS truth layer and evidence-
first ingestion contracts. The broader situational-awareness direction is inspired by
[VrushankPatel/godseye](https://github.com/VrushankPatel/godseye), with this
project supplying its own evidence-first wildfire backend.

The interface is localized in English and Greek. It follows the browser
language on first load, remembers the selected language, and keeps the original
16:58 112 instruction visibly marked as an archived alert in both languages.

[Open Firewatch](https://plomari-wildfire-tracker.vercel.app)

> **Safety notice**
>
> This is an independent information aid, not an emergency service, official
> fire perimeter, evacuation routing system, or substitute for instructions
> from 112, the Hellenic Fire Service, police, or Civil Protection. Satellite
> detections are approximate thermal pixels. Modeled smoke and spread layers
> are scenarios, not observations or predictions. In an emergency, call 112
> and follow authorities.

## What Firewatch shows

The root route is the global discovery workspace:

- A globe-scale Explore view backed only by Firewatch v3 reads. The current
  aggregate endpoint explicitly reports `unconfigured` / `indeterminate`
  until persisted global candidate generation is activated; it does not fake
  incidents or call providers from the browser.
- An opt-in Nearby flow that derives a coarse Web Mercator cell on-device and
  submits only that cell after confirmation. Exact GPS coordinates are not
  sent to Firewatch.
- A semantic candidate list that remains usable if WebGL is unavailable, with
  coverage, event time, knowledge time, source health, and uncertainty visible.

The dated Plomari route preserves the original incident interface as a
historical archive:

- The source-linked 16:58 112 instruction and dated official, observed, and
  local reports through the latest embedded evidence at 20:50 Europe/Athens on
  29 July 2026. It does not display current Fire Service status or an all-clear.
- NASA FIRMS VIIRS and MODIS thermal detections limited to the 8 km incident
  radius. The archive performs one historical read when opened or when the
  user commits a different date on the scrubber; it does not continuously poll
  the Plomari area.
- Source-labeled local reports, with official, observed, reported, and modeled
  information visually distinguished. Current-only wind, source health, Fire
  Service board state, GIBS imagery, measured METAR, and smoke transport are
  withheld rather than presented as historical evidence.
- An optional spread scenario controlled by wind force, direction, and time.
  It is intentionally labeled as a scenario rather than a forecast.
- A map-first phone layout with a safe-area-aware bottom dock, a single tabbed
  panel (Layers / Thermal / Wind / Updates) opened from either dock button,
  44px-or-larger touch targets, and a compact official-status/wind ribbon.
- An explicit historical scrubber from incident start to the latest embedded
  evidence. There is no Live sentinel or return-to-now action on the archive.

Personal location is optional and requested only after an explicit tap. The
global client computes its suggested coarse cell locally and sends only that
cell after explicit confirmation. The Plomari archive uses location for a
temporary marker and distance readouts without submitting the coordinates to
Firewatch. Centering either map can cause configured third-party tile providers
to receive ordinary tile requests for the visible area. There is no account
data or user-specific incident status in this repository.

## Understanding satellite thermal detections

A FIRMS marker is the center of a satellite pixel where a thermal anomaly was
detected during one overpass. It is **not** a live flame location, a fire
perimeter, or a count of separate fires. VIIRS pixels are nominally 375 m, but
the API-provided `scanKm` and `trackKm` values describe the actual sampled
footprint drawn by the map.

The interface groups records by satellite **detecting pass** and keeps three ideas separate:

- **Confidence** (`high`, `nominal`, `low`, or `unknown`) describes detection
  quality. It does not describe fire severity.
- **FRP** is pixel-integrated fire radiative power in megawatts. It is not flame
  height or the total intensity of the incident.
- **Age** is the time since the satellite observation, shown in local Greece
  time alongside the API retrieval time.

An empty result stays empty. The application never substitutes bundled or old
points for a valid zero result or an unavailable FIRMS feed. Zero detections do
not mean the fire is out: clouds, satellite timing, and sensor limits can hide
activity. The daily GIBS raster can remain visible when the FIRMS point feed is
unconfigured or unavailable, and the interface labels that distinction.

Local reporting is displayed separately as **field-reported areas
(approximate)**. Those reference areas do not become satellite detections, a
spread path, or a confirmed perimeter.

## Local feed reader and source health

The local feed reader uses a fixed incident start time and Plomari/fire relevance
matching to prevent unrelated or old municipal items from entering the live
timeline. Exact timestamps are checked against the incident start; date-only
official items are compared by the Europe/Athens calendar date; items without a
parseable source time are excluded. Publisher content is limited to headlines
and outbound links; it is not republished as an official statement.

Each response identifies the source as `official` or `publisher`, reports
whether that source is `ok`, `error`, or `unconfigured`, and separates
protective instructions from reporting. Categories such as evacuation,
readiness, road, smoke, rekindling, containment, and response are machine
classification aids; the linked source remains authoritative. A red
action-required flag is only set for a protective instruction from the
validated official 112 stream; RSS and publisher classification never creates
one.

## Data freshness and limitations

The current Plomari archive does not schedule current-only wind, METAR, GIBS,
Fire Service, or publisher-feed checks. The table below documents the dormant
active-incident policies and provider constraints that remain available for a
future evidence-backed active incident. Historical FIRMS is requested once on
archive entry or after a committed scrubber date change.

| Layer | Application check | Underlying data cadence | Important limitation |
| --- | --- | --- | --- |
| Detailed wind | Active-incident policy: every 5 minutes | Open-Meteo model cycles update less often | Withheld in the archive; point forecast/model, not an on-site anemometer |
| LGMT METAR | Active-incident policy: every 5 minutes through the server route | Usually observed about every 30 minutes; provider cache updates about once a minute | Withheld in the archive; airport is not the fireground |
| Smoke envelope | Recomputed whenever wind data or the selected horizon changes | Derived from the current 10 m model wind | Not observed smoke, PM2.5, or a dispersion model |
| NASA FIRMS points | Archive: one historical read on entry or committed date change; active-incident policy: every 2 minutes | FIRMS services refresh after satellite processing | Orbital detecting snapshots, not continuous coverage; point age is observation age, not API age |
| NASA GIBS thermal/aerosol overlay | Active-incident policy: reload every 5 minutes | Daily satellite layers updated as observations arrive | Withheld in the archive; current-day imagery cannot be historical evidence |
| Fire Service incident status | Active-incident policy: every 5 minutes through the shared server cache | Official board refreshes approximately every 15 minutes and may publish newer minute-age data | Withheld in the archive; status only, with no perimeter or public action instructions |
| Local feed reader | Active-incident policy: every 5 minutes for a visible tab | Source-controlled RSS/page updates | Withheld in the archive; publisher reporting is not official |
| 112 instruction | Browser polling never calls X; the original 16:58 permalink remains visible as an archived alert until a persisted scheduled collector publishes a newer verified projection | Cell broadcast and official publisher | The archived banner is not proof that the instruction remains current; phone alerts and authorities remain authoritative, and X API availability is not guaranteed |

Every active data panel exposes its model or observation time. If retrieval
fails, the interface marks the source unavailable rather than silently
presenting a fallback as current.

Thermal responses expose one of four explicit states:

| State | Meaning |
| --- | --- |
| `ok` | Every configured VIIRS and MODIS dataset returned a valid response with no degraded delivery source |
| `partial` | At least one dataset succeeded while another dataset or one of a dataset's delivery sources failed or was unconfigured |
| `unconfigured` | No delivery source applicable to the request is configured. Live requests always have the keyless 24-hour regional download available, so this state is reachable only for historical `?date=` requests without `FIRMS_MAP_KEY` |
| `upstream-error` | No configured dataset produced a valid response |

## Sources

- [112 Greece — official alert](https://x.com/112Greece/status/2082468150189167080)
- [Greek Civil Protection guidance](https://civilprotection.gov.gr/112/odigies-prostasias)
- [Greek Civil Protection press feed](https://civilprotection.gov.gr/deltia-tupou.rss)
- [Hellenic Fire Service](https://x.com/pyrosvestiki/status/2082459852350066823)
- [Hellenic Fire Service incident board](https://www.fireservice.gr/apps/fire2019/symvanta/page.php)
- [Municipality of Mytilene Civil Protection](https://www.mytilene.gr/category/politiki-prostasia/)
- [ERT North Aegean](https://www.ertnews.gr/news/perifereiakoi-stathmoi/voreio_aigaio/)
- [NASA FIRMS thermal-data description](https://firms.modaps.eosdis.nasa.gov/content/descriptions/FIRMS_VIIRS_Firehotspots.html)
- [NASA FIRMS Area API](https://firms.modaps.eosdis.nasa.gov/api/area/)
- [NASA FIRMS map keys](https://firms.modaps.eosdis.nasa.gov/api/map_key/)
- [NASA GIBS vector/WMS guidance](https://nasa-gibs.github.io/gibs-api-docs/access-advanced-topics/#vector-visualizations)
- [Open-Meteo forecast API](https://open-meteo.com/en/docs)
- [AviationWeather API](https://aviationweather.gov/data/api/)
- [StoNisi local fire reporting](https://www.stonisi.gr/post/114624/stamathsan-oi-ripseis-apo-aeros-sthn-fwtia-toy-plwmarioy)
- [StoNisi satellite-smoke report](https://www.stonisi.gr/post/115334/kapnos-apo-thn-toyrkia-skepazei-lesvo-kai-xio)

Basemaps use OpenStreetMap/CARTO, Esri World Imagery, and OpenTopoMap, with
provider attribution displayed on the map.

## Run locally

Requirements: Node.js 20 (20.19+), Node.js 22 (22.12+), or Node.js 24+
(see the exact supported range in `package.json`).

```bash
npm install
npm run dev
```

Then open <http://localhost:3000>.

Create a local `.env.local` file:

```bash
FIRMS_MAP_KEY=your_server_side_nasa_firms_key
X_BEARER_TOKEN=your_optional_server_side_x_bearer_token
SUPABASE_URL=your_optional_supabase_project_url
SUPABASE_PUBLISHABLE_KEY=your_optional_supabase_publishable_key
SUPABASE_DISCOVERY_READER_KEY=your_scoped_server_only_supabase_secret_key
FIREWATCH_THERMAL_V3_UI_ENABLED=false
```

`FIRMS_MAP_KEY` enables live FIRMS point queries. Without it, the app keeps the
no-key NASA GIBS raster available and explicitly marks the point feed
unconfigured; it does not display substitute points. Create a FIRMS key through
the [NASA FIRMS map-key service](https://firms.modaps.eosdis.nasa.gov/api/map_key/).

`X_BEARER_TOKEN` is optional and reserved for the future scheduled evidence
collector. Public `/api/updates` requests never spend it, including
`realtime=1` requests, which are rejected before any upstream call. X API
access is usage-priced and remains an optional enhancement rather than the only
emergency-alert channel.
Put a hard spend limit and usage alerts on the X project. The intended steady
state is one verified X Activity API webhook with three `post.create`
subscriptions after narrow, idempotent database ingestion is deployed;
persisted polling is the failure fallback.

`SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` are optional and enable the
server-side v3 shadow read routes (`/api/v3/shadow/sources` and
`/api/v3/satellite-passes`). `SUPABASE_DISCOVERY_READER_KEY` is additionally
required for the privilege-scoped Nearby and thermal-anomaly projections;
without it those routes fail closed with 503. The disabled-by-default OpenRouter
OODA variables are documented in `.env.example` and
[docs/ai-ooda-architecture.md](docs/ai-ooda-architecture.md).

All of these variables are server-only. Never prefix any of them with
`NEXT_PUBLIC_`, expose their values in browser code, or commit `.env.local`.

Production validation:

```bash
npm run check
npm start
```

## Deploy to Vercel

1. Import this GitHub repository in Vercel.
2. Keep the detected framework as **Next.js**.
3. Use the default build command (`npm run build`) and output settings.
4. Add `FIRMS_MAP_KEY` under **Settings → Environment Variables** for
   Production, Preview, and Development.
5. Add `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` there as well if the v3
   shadow read routes should be active. Add the separately provisioned
   `SUPABASE_DISCOVERY_READER_KEY` for scoped Nearby and thermal reads; never
   substitute a service-role key.
6. Keep `FIREWATCH_THERMAL_V3_UI_ENABLED=false` until the database statement
   timeout, admission/rate controls, observability, canary, and rollback gates
   in issue #59 are complete. The exact lowercase value `true` is the only
   value that activates the browser panel.
7. Reserve `X_BEARER_TOKEN`, if configured, for the future scheduled evidence
   collector. Public browser-driven routes do not use it.
8. Redeploy after adding or rotating an environment variable.

The `/api/thermal`, `/api/updates`, and `/api/wind` routes keep upstream
credentials and cross-origin requests on the server. Neither key is sent to the
browser. Vercel caches the shared local feed snapshot for 5 minutes, live FIRMS
responses for 2 minutes, normalized wind/METAR responses for 5 minutes (with a
60-second browser `max-age`), and complete finished historical UTC days for
1 hour;
the client uses those shared responses at the documented cadence and pauses
recurring polling while hidden or offline. An offline load still makes one
best-effort read through the service worker so a cached last-known-good snapshot
can hydrate the interface.

## API response contracts

`GET /api/thermal` returns schema version 2. Live mode applies an exact rolling
24-hour window. A validated `?date=YYYY-MM-DD` selects one historical UTC day;
the historical scrubber combines the selected day with the preceding eligible
incident day so exact as-of, 6-hour, and 24-hour filters work across midnight.
The response reports:

- query bounds, the incident center, and the 8 km incident radius;
- credential configuration state without returning the credential;
- per-dataset success/error state for NOAA-20, NOAA-21, Suomi-NPP, and MODIS;
- incident and regional record totals, confidence totals, and grouped passes;
- per-record pixel footprint, pass ID, observation age, confidence, FRP,
  day/night flag, and distance/bearing from the incident center;
- request, retrieval, latest regional observation, and latest incident
  observation times.

`GET /api/updates` returns schema version 2. It reports:

- a feeds-only public snapshot; omitted or `realtime=0` performs no X API
  reads, while `realtime=1` is rejected before any upstream request so paid
  collection cannot be triggered by a browser;
- official and publisher source tiers with per-source health and error codes;
- request/retrieval time, exact source time when available, and item age;
- source summaries for online, failed, and optional unconfigured feeds;
- incident-relevant items only, deduplicated across sources;
- English and Greek item summaries generated by the application;
- category, severity, and action-required metadata without changing the
  original source title or link.

## Data truth layer

The next architecture phase moves source collection and incident history out of
request-time API composition and into an append-only, auditable data layer.
The existing version 2 thermal, updates, and wind routes are the explicitly
tracked rollout exception: they remain request-time collectors until their
persisted read models are reconciled and cut over. New provider and AI adapters
must not add direct network access; they receive an evidence-recording
transport, and their response cannot affect published truth before persistence.
`lib/evidence/recorded-fetch.ts` is that runtime contract, not a completed
collector integration: the legacy v2 routes do not use it yet, and no production
ledger credential, scheduled collector, or adapter has been provisioned for
them. The TypeScript boundary and direct-fetch inventory are migration guards,
not a security boundary against deliberate casts, aliases, or another HTTP
client.

- [Data truth layer specification](docs/data-truth-layer-spec.md)
- [Production architecture and rollout gates](docs/production-architecture.md)
- [Source integration roadmap and Godseye gap audit](docs/source-integration-roadmap.md)
- [Global Explore and localization roadmap](docs/global-explore-roadmap.md)
- [AI-assisted OODA architecture](docs/ai-ooda-architecture.md)
- [Operational ontology and graph roadmap](docs/ontology-roadmap.md)
- [`lib/truth`](lib/truth) contains the initial shared domain contracts,
  provider/endpoint/target registries, source-authority rules, global
  observation contracts, and deterministic freshness calculation.
- [`lib/truth/v1`](lib/truth/v1) contains strict runtime contracts,
  deterministic identity rules, fixture replay, and Draft 2020-12 JSON Schema
  exports.
- [Truth contract versioning](docs/truth-contract-versioning.md) defines
  compatibility, identity, quarantine, and fixture policy.

The CLI-generated [`supabase`](supabase) project contains the private PostGIS
truth schema, access boundary, database tests, and disabled source catalog. The
reviewed foundation is deployed to the live Supabase project, with only the
curated `api` schema exposed. All sources and collection targets remain disabled
while collection and read-model changes run in shadow mode; the public map has
not switched to the new read model.

`GET /api/v3/shadow/sources` is the first bounded server-side read of that
catalog. It requires only `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`, reads
the curated `api` schema, and is deliberately not wired into the v2 map. Never
substitute a service-role or secret key for this route.

`GET /api/v3/satellite-passes?cell=wm/z/x/y` is the persisted CMR
satellite-pass read. It accepts only a canonical coarse area, queries
security-invoker Supabase projections/functions with the same publishable
server credential, and performs no NASA request. The response separates full
UTC observation, production, catalog, retrieval, and source-health times. It
labels CMR geometry as catalog-footprint coverage with
`anomalyAssessment: "not_assessed"`. A local `valid-empty` result requires a
database-proven continuous complete global scan lineage across the current
36-hour window plus zero exact PostGIS intersections; an isolated incremental,
stale scan, or partial scan can never produce that claim. The route is not yet
wired into global Explore fan-out. It is wired into the v2 incident map as a
current-only persisted layer and is withheld while viewing historical time.

The first global-discovery v3 routes are deliberately honest about the current
read-model boundary:

- `GET /api/v3/explore/cells` returns `unconfigured` / `indeterminate` until a
  persisted candidate aggregate exists. It never calls a provider and never
  treats an empty database as “no wildfire.”
- `GET /api/v3/areas/nearby?cell=wm/z/x/y` reads only the bounded
  `api.nearby_incidents_v3` PostGIS projection. Vercel sends a named Supabase
  secret API key whose fixed JWT template contains only
  `role: firewatch_discovery_reader`; the public key alone, `anon`, `authenticated`,
  collectors, and `service_role` cannot execute this RPC. The definer function
  independently enforces public visibility, both cutoff-time and current
  publication eligibility, mutable-gate clocks, a spatial-first latest-snapshot
  proof, a five-second statement timeout, and all input/result bounds. It can
  return persisted items under historical `asOf` and `knownAt` cutoffs, but
  coverage remains `not_assessed` and `no-store`; omission can never authorize
  `valid-empty`.
- `GET /api/v3/thermal-anomalies?cell=wm/z/x/y&schemaVersion=3&asOf=...&knownAt=...&limit=50`
  reads a seven-day window of persisted, assessed FIRMS thermal-pixel
  observations and never contacts NASA. `detectionId` is the stable public UUID
  of the original detection; `detailRevision` identifies the exact immutable
  detail revision used by the latest visible assessment. Every returned clock
  is a conservative canonical millisecond value, so a returned `knownAt`
  knowledge clock can be reused as a cutoff without excluding the same
  sub-millisecond evidence.
  `page.nextCursor` is an opaque, server-authenticated keyset cursor bound to
  the exact cell, both cutoffs, limit, last acquisition/identity tuple, and the
  current publication-gate and evidence-epoch fingerprint. Gate or evidence
  changes return a restartable `409` rather than mixing snapshots. The number
  of candidate identities materialized for assessment and wide evidence
  projection is hard-capped. The underlying
  indexed seven-day PostGIS/time scan is not a physical-work bound; the server
  reader aborts and fails closed after five seconds. A database-side statement
  timeout and request-rate boundary must be enforced outside the RPC before this
  endpoint is activated broadly. A sparse page that cannot prove exhaustion
  within the materialization cap fails closed instead of omitting later rows.
  Relevant evidence inserts transactionally bump a private projection epoch
  folded into that snapshot, so records committed between HTTP pages force the
  same restartable `409`. Result counts are explicitly exact for the current
  page; they are never presented as a total across pages.
  Empty results and exhausted pages remain `not_assessed` / `indeterminate`,
  never an all-clear.

The `/` Nearby thermal panel (`/explore` remains a compatibility alias) is
implemented behind the strict server-only
`FIREWATCH_THERMAL_V3_UI_ENABLED=true` gate and defaults off. Once activated, it
reuses only the exact canonical cell, event-time cutoff, and knowledge-time
cutoff from a freshly validated Nearby response. It performs one bounded
first-page persisted read per validated Nearby snapshot: there is no global
fan-out, provider call, independent thermal polling, automatic retry, cursor
traversal, service-worker cache, offline retention, or legacy-map cutover. A
zero-row page remains coverage-not-assessed and never becomes “no fire” or an
all-clear. Do not activate this gate before issue #59's database and edge
admission controls are complete.

These routes accept only canonical millisecond UTC cutoffs within the bounded
31-day discovery horizon. Nearby remains a single bounded page and rejects
continuation cursors; if a cell contains more than the requested limit, it
returns 503 instead of truncating, skipping, or duplicating incidents. Thermal
anomalies use the authenticated cursor described above. A successful empty
read remains `not_assessed` / `indeterminate` and does not claim local-time
resolution or an all-clear.

Nearby has a mandatory deployment credential. After applying the migration,
create a named, individually revocable Supabase secret API key whose fixed JWT
template is the new database role. This Management API request must be run by
an operator with API-gateway-key write access; do not paste the management
token into the repository or shell history:

```bash
curl 'https://api.supabase.com/v1/projects/cggrrimijkmmzpwhodqt/api-keys?reveal=true' \
  --request POST \
  --header 'Authorization: Bearer YOUR_SCOPED_MANAGEMENT_TOKEN' \
  --header 'Content-Type: application/json' \
  --data '{
    "type":"secret",
    "name":"firewatch-discovery-reader",
    "description":"Vercel v3 Nearby read proxy only",
    "secret_jwt_template":{"role":"firewatch_discovery_reader"}
  }'
```

Store only the returned `sb_secret_...` value as server-only
`SUPABASE_DISCOVERY_READER_KEY` in Vercel Production and Preview, redeploy, and
verify a Nearby request. Never substitute the default `SUPABASE_SECRET_KEY`,
`service_role`, or `SUPABASE_JWT_SECRET`. To rotate, create a replacement with
the same fixed template, update and verify Vercel, then delete the old named
key by its Management API key id. See Supabase's
[API-key guide](https://supabase.com/docs/guides/getting-started/api-keys) and
[platform API-key example](https://supabase.com/docs/guides/integrations/supabase-for-platforms)
for secret-key handling and per-key rotation.

## Supabase development

The local database requires Docker and the Supabase CLI:

```bash
supabase db start
supabase db lint --local --schema core,ingest,truth,api --level error --fail-on error
supabase test db
```

`supabase/config.toml` exposes only the curated `api` schema through the local
Data API. The `core`, `ingest`, and `truth` schemas are private. Rehearse later
hosted migrations on a separate non-production Supabase branch; never push an
unreviewed migration directly to production.

The migration defines separate no-login capability roles for catalog work,
collection, reconciliation, publication, and outbox delivery. It does not
create passwords. Provision and rotate production workload identities outside
the migration, grant each identity exactly one capability role, and never use a
generic Supabase `service_role` key as a shared private-schema writer.

Larger raw responses use a private, content-addressed `raw-evidence` Storage
bucket. Runtime workers can insert and verify SHA-256-derived objects but cannot
overwrite/delete them or make the bucket public; retention is an explicit
operator workflow. Storage uploads use short-lived server-only collector-role
tokens; no JWT signing key or collector token belongs in Vercel client code.
Supabase's managed `service_role` remains a BYPASSRLS platform-root secret with
Storage access; it must never be distributed to browsers or used as a shared
worker credential. Deployments that require hard isolation from that root use
client-side envelope encryption with a separately held key or a separate object
store/security boundary.
Supabase's managed `service_role` remains a root credential with Storage access
and must not be used by application or worker code. Cryptographic isolation
from that credential requires worker-side encryption with a separately held key
or a separate object store, not Storage RLS alone.

CI repeats the migration, seed, database lint, and pgTAP checks against an
ephemeral local Postgres instance; it never links to or modifies the hosted
project.

## Project structure

```text
app/
  api/thermal/route.ts       # NASA FIRMS thermal detections (v2)
  api/updates/route.ts       # official incident board and local/official feeds (v2)
  api/updates/fireservice.ts # Fire Service incident-board parser
  api/updates/text.ts        # shared XML/HTML text normalization
  api/wind/route.ts          # normalized model wind and LGMT METAR (v2)
  api/v3/shadow/sources/     # bounded Supabase source-catalog read (shadow)
  api/v3/satellite-passes/   # persisted CMR satellite-pass read (shadow)
  globals.css                # responsive tactical interface
  layout.tsx                 # metadata and document shell
  manifest.ts                # PWA manifest
  page.tsx                   # Leaflet map, layers, timeline, and scenarios
docs/                        # architecture, rollout, and roadmap documents
lib/
  area-time.ts               # Athens-time formatting rules
  as-of.ts                   # as-of history admission rules
  assist/                    # disabled-by-default AI orientation adapter
  evidence/                  # evidence-recording fetch contract
  firewatch/                 # map context and demand policy (global foundations)
  satellite/                 # NASA CMR catalog adapter and collector
  supabase/                  # server-only Supabase read models
  truth/                     # domain contracts, registries, v1 runtime schemas
public/
  favicon.svg, icon-*.png    # static assets and PWA icons
  sw.js                      # offline/service-worker caching
supabase/
  config.toml                # local Data API exposure (api schema only)
  functions/collect-cmr/     # scheduled CMR Edge Function collector
  migrations/                # versioned PostGIS truth-layer DDL
  seed.sql                   # disabled global source catalog
  tests/                     # pgTAP access, immutability, and integrity tests
tests/                       # Vitest route, contract, and fixture suites
.github/workflows/ci.yml     # lint, typecheck, tests, build, database checks
```

## Design attribution

The command-center visual language and operational-layer organization were
inspired by [Vrushank Patel's Godseye project](https://github.com/VrushankPatel/godseye).
This repository is an independent implementation and does not copy Godseye
source code or claim affiliation with Palantir.

## License

[Apache License 2.0](LICENSE)
