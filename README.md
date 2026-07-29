# Plomari Wildfire Tracker

A public, mobile-friendly situational-awareness map for the 29 July 2026
Plomari wildfire on Lesvos, Greece. It combines source-labeled official
instructions, satellite thermal detections, local field reporting, detailed
modeled wind, a measured airport observation, a smoke transport proxy, and a
clearly marked spread-scenario tool.

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
  and Suomi-NPP. The point layer is limited to an 8 km incident radius and can
  be filtered to the latest satellite pass containing a detection, 6 hours, or
  24 hours. FIRMS does not report otherwise empty satellite overpasses.
- A separate, no-key NASA GIBS current-day thermal raster and optional VIIRS
  aerosol classification layer. Raster pixels are imagery, not additional
  point detections or a mapped fire edge.
- Automatic official and publisher feeds from the Hellenic Fire Service
  incident board, Greek Civil Protection, the Municipality of Mytilene, ERT
  North Aegean, StoNisi, and Aeolos. Optional official X feeds can add
  `@112Greece` and `@pyrosvestiki`.
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

There is no personal location tracking, GPS prompt, user marker, account data,
or user-specific status in this repository.

## Understanding satellite thermal detections

A FIRMS marker is the center of a satellite pixel where a thermal anomaly was
detected during one overpass. It is **not** a live flame location, a fire
perimeter, or a count of separate fires. VIIRS pixels are nominally 375 m, but
the API-provided `scanKm` and `trackKm` values describe the actual sampled
footprint drawn by the map.

The interface groups records by satellite pass and keeps three ideas separate:

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

## Incident wire and source health

The incident wire uses a fixed incident start time and Plomari/fire relevance
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
| NASA FIRMS points | Every 5 minutes while the page is open; shared response cache 2 minutes | FIRMS services refresh about every 15 minutes after satellite processing | Orbital snapshots, typically available globally within about 3 hours; point age is observation age, not API age |
| NASA GIBS thermal/aerosol overlay | Reloaded every 5 minutes | Daily satellite layers updated as observations arrive | Current-day detections persist; aerosol retrieval is coarse, daylight-only, cloud-sensitive, and not PM2.5 |
| Fire Service incident status | Every 60 seconds through the shared server cache | Official board refreshes approximately every 15 minutes and may publish newer minute-age data | Status only; no perimeter, route, or public action instructions |
| Incident wire | Every 60 seconds; shared response cache 45 seconds | Source-controlled RSS/page updates | Source failures and unconfigured optional feeds are shown; publisher reporting is not official |
| 112 instruction | Optional official-account check every 60 seconds when `X_BEARER_TOKEN` is configured; the original 16:58 permalink remains visible as an archived alert | Cell broadcast and official publisher | The archived banner is not proof that the instruction remains current; phone alerts and authorities remain authoritative, and X API availability is not guaranteed |

Every live data panel exposes its model/observation time. If live wind retrieval
fails, the interface marks the data stale and retains a timestamped fallback so
the failure is visible rather than silently presenting it as current.

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

Requirements: Node.js 20.9 or newer.

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

`X_BEARER_TOKEN` is optional. It enables automatic retrieval from the official
`@112Greece` and `@pyrosvestiki` accounts. The application continues to use the
other official and publisher sources when it is absent. X API access is
usage-priced and should be treated as an optional enhancement, not the only
emergency-alert channel.

Both variables are server-only. Never prefix either with `NEXT_PUBLIC_`, expose
their values in browser code, or commit `.env.local`.

Production validation:

```bash
npm run lint
npm run build
npm start
```

## Deploy to Vercel

1. Import this GitHub repository in Vercel.
2. Keep the detected framework as **Next.js**.
3. Use the default build command (`npm run build`) and output settings.
4. Add `FIRMS_MAP_KEY` under **Settings → Environment Variables** for
   Production, Preview, and Development.
5. Optionally add `X_BEARER_TOKEN` in the same environments for automatic
   official X account retrieval.
6. Redeploy after adding or rotating an environment variable.

The `/api/thermal`, `/api/updates`, and `/api/wind` routes keep upstream
credentials and cross-origin requests on the server. Neither key is sent to the
browser. Vercel caches the shared incident wire for 45 seconds and the FIRMS
response for 2 minutes; the client continues polling at the documented
application cadence.

## API response contracts

`GET /api/thermal` returns schema version 2. It applies an exact rolling
24-hour window after querying the NASA calendar-day endpoint, then reports:

- query bounds, the incident center, and the 8 km incident radius;
- credential configuration state without returning the credential;
- per-dataset success/error state for NOAA-20, NOAA-21, and Suomi-NPP;
- incident and regional record totals, confidence totals, and grouped passes;
- per-record pixel footprint, pass ID, observation age, confidence, FRP,
  day/night flag, and distance/bearing from the incident center;
- request, retrieval, latest regional observation, and latest incident
  observation times.

`GET /api/updates` returns schema version 2. It reports:

- official and publisher source tiers with per-source health and error codes;
- request/retrieval time, exact source time when available, and item age;
- source summaries for online, failed, and optional unconfigured feeds;
- incident-relevant items only, deduplicated across sources;
- English and Greek item summaries generated by the application;
- category, severity, and action-required metadata without changing the
  original source title or link.

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
```

## Design attribution

The command-center visual language and operational-layer organization were
inspired by [Vrushank Patel's Godseye project](https://github.com/VrushankPatel/godseye).
This repository is an independent implementation and does not copy Godseye
source code or claim affiliation with Palantir.

## License

[Apache License 2.0](LICENSE)
