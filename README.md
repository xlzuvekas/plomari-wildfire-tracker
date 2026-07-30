# Plomari Wildfire Tracker

A public, mobile-friendly situational-awareness map first deployed for the
29 July 2026 Plomari wildfire on Lesvos, Greece. It combines source-labeled
official instructions, satellite thermal detections, local field reporting,
detailed modeled wind, a measured airport observation, a smoke transport proxy,
and a clearly marked spread-scenario tool.

The repository is now also building the production foundation for a global,
multi-incident wildfire platform. The current public map remains Plomari-
specific while the new Supabase/PostGIS truth layer runs through migration,
fixture replay, shadow ingestion, and safety review before any cutover.
The broader situational-awareness direction is inspired by
[VrushankPatel/godseye](https://github.com/VrushankPatel/godseye), with this
project supplying its own evidence-first wildfire backend.

The interface is localized in English and Greek. It follows the browser
language on first load, remembers the selected language, and keeps the original
16:58 112 instruction visibly marked as an archived alert in both languages.

[Open the live map](https://plomari-wildfire-tracker.vercel.app)

> **Safety notice**
>
> This is an independent information aid, not an emergency service, official
> fire perimeter, evacuation routing system, or substitute for instructions
> from 112, the Hellenic Fire Service, police, or Civil Protection. Satellite
> detections are approximate thermal pixels. Modeled smoke and spread layers
> are scenarios, not observations or predictions. In an emergency, call 112
> and follow authorities.

## What the map shows

- The archived, source-linked 16:58 112 instruction, the health of the optional
  live official-alert feed, and the latest Fire Service response update.
- Near-real-time NASA FIRMS VIIRS thermal detections from NOAA-20, NOAA-21,
  Suomi-NPP, and MODIS. The point layer is limited to an 8 km incident radius and can
  be filtered to the latest satellite detecting pass, 6 hours, or
  24 hours. FIRMS does not report otherwise empty satellite overpasses.
- A separate, no-key NASA GIBS current-day thermal raster and optional VIIRS
  aerosol classification layer. Raster pixels are imagery, not additional
  point detections or a mapped fire edge.
- Automatic official and publisher feeds from the Hellenic Fire Service
  incident board, Greek Civil Protection, the Municipality of Mytilene, ERT
  North Aegean, StoNisi, and Aeolos. Optional official X feeds can add
  `@112Greece`, `@pyrosvestiki`, and `@CivPro_GR`; only `@112Greece` is
  classified as an official-alert feed.
- Source-labeled local reports, with official, observed, reported, and modeled
  information visually distinguished. Feed health, source tier, category,
  severity, publication time, and action-required status remain separate.
- Open-Meteo wind at 10 m, 80 m, 120 m, and 180 m above ground for the incident
  area, plus gusts, humidity, pressure, and boundary-layer height.
- The latest available measured METAR from Mytilene Airport (LGMT), shown with
  its own observation time.
- A wind-driven smoke exposure envelope and selectable time horizon. It is
  **not** measured PM2.5, an air-quality forecast, or safe-route guidance.
- An optional spread scenario controlled by wind force, direction, and time.
  It is intentionally labeled as a scenario rather than a forecast.
- A map-first phone layout with a safe-area-aware bottom dock, mutually
  exclusive Layers and Updates sheets, 44px-or-larger touch targets, and a
  compact official-status/wind ribbon.
- An explicit **Live / as-of** scrubber from incident start to now. Historical
  view admits only known source or observation times at or before the cutoff;
  latest-only wind, source health, Fire Service board state, and daily current
  rasters are clearly withheld rather than presented as historical evidence.

Personal location is optional and requested only after an explicit tap. The
Firewatch client uses it for a temporary marker and distance readouts and does
not submit the coordinates to Firewatch servers. Explicitly centering the map
can cause the configured third-party map and overlay providers (Carto, Esri,
OpenTopoMap, and NASA) to receive ordinary tile requests for the nearby view.
There is no account data or user-specific incident status in this repository.

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

| Layer | Application check | Underlying data cadence | Important limitation |
| --- | --- | --- | --- |
| Detailed wind | Every 5 minutes while the page is open | Open-Meteo model cycles update less often | Point forecast/model, not an on-site anemometer |
| LGMT METAR | Every 5 minutes through the server route | Usually observed about every 30 minutes; provider cache updates about once a minute | Airport is not the fireground; terrain can produce very different local wind |
| Smoke envelope | Recomputed whenever wind data or the selected horizon changes | Derived from the current 10 m model wind | Not observed smoke, PM2.5, or a dispersion model |
| NASA FIRMS points | Every 2 minutes for the active incident while the tab is visible; shared response cache 2 minutes | FIRMS services refresh after satellite processing | Orbital detecting snapshots, not continuous coverage; point age is observation age, not API age |
| NASA GIBS thermal/aerosol overlay | Reloaded every 5 minutes | Daily satellite layers updated as observations arrive | Current-day detections persist; aerosol retrieval is coarse, daylight-only, cloud-sensitive, and not PM2.5 |
| Fire Service incident status | Every 5 minutes through the shared server cache | Official board refreshes approximately every 15 minutes and may publish newer minute-age data | Status only; no perimeter, route, or public action instructions |
| Local feed reader | Every 5 minutes for a visible active-incident tab; shared response cache 5 minutes | Source-controlled RSS/page updates | Source failures and unconfigured optional feeds are shown; publisher reporting is not official |
| 112 instruction | Browser polling never calls X; the original 16:58 permalink remains visible as an archived alert until a persisted scheduled collector publishes a newer verified projection | Cell broadcast and official publisher | The archived banner is not proof that the instruction remains current; phone alerts and authorities remain authoritative, and X API availability is not guaranteed |

Every live data panel exposes its model/observation time. If live wind retrieval
fails, the interface marks the model unavailable and withholds wind vectors,
smoke proxies, and model values rather than silently presenting a fallback as
current.

Thermal responses expose one of four explicit states:

| State | Meaning |
| --- | --- |
| `ok` | All configured VIIRS datasets returned valid responses |
| `partial` | At least one VIIRS dataset succeeded and at least one failed |
| `unconfigured` | `FIRMS_MAP_KEY` is not present |
| `upstream-error` | No configured VIIRS dataset produced a valid response |

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

Both variables are server-only. Never prefix either with `NEXT_PUBLIC_`, expose
their values in browser code, or commit `.env.local`.

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
5. Reserve `X_BEARER_TOKEN`, if configured, for the future scheduled evidence
   collector. Public browser-driven routes do not use it.
6. Redeploy after adding or rotating an environment variable.

The `/api/thermal`, `/api/updates`, and `/api/wind` routes keep upstream
credentials and cross-origin requests on the server. Neither key is sent to the
browser. Vercel caches the shared local feed snapshot for 5 minutes, live FIRMS
responses for 2 minutes, and complete finished historical UTC days for 1 hour;
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
wired into the v2 map.

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
  api/thermal/route.ts # NASA FIRMS thermal detections
  api/updates/route.ts # official incident board and local/official feeds
  api/wind/route.ts    # normalized model wind and LGMT METAR
  globals.css        # responsive tactical interface
  layout.tsx         # metadata and document shell
  page.tsx           # Leaflet map, layers, timeline, and scenarios
public/
  favicon.svg
supabase/
  migrations/      # versioned PostGIS truth-layer DDL
  tests/           # pgTAP access, immutability, and integrity tests
```

## Design attribution

The command-center visual language and operational-layer organization were
inspired by [Vrushank Patel's Godseye project](https://github.com/VrushankPatel/godseye).
This repository is an independent implementation and does not copy Godseye
source code or claim affiliation with Palantir.

## License

[Apache License 2.0](LICENSE)
