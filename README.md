# Plomari Wildfire Tracker

A public, mobile-friendly situational-awareness map for the 29 July 2026
Plomari wildfire on Lesvos, Greece. It combines source-labeled official
instructions, satellite thermal detections, local field reporting, detailed
modeled wind, a measured airport observation, a smoke transport proxy, and a
clearly marked spread-scenario tool.

The interface is localized in English and Greek. It follows the browser
language on first load, remembers the selected language, and keeps the critical
112 instruction visible in both languages.

[Open the live map](https://plomari-fire-map.xlzuv.chatgpt.site)

> **Safety notice**
>
> This is an independent information aid, not an emergency service, official
> fire perimeter, evacuation routing system, or substitute for instructions
> from 112, the Hellenic Fire Service, police, or Civil Protection. Satellite
> detections are approximate thermal pixels. Modeled smoke and spread layers
> are scenarios, not observations or predictions. In an emergency, call 112
> and follow authorities.

## What the map shows

- The latest sourced 112 instruction and Fire Service response update.
- Near-real-time NASA FIRMS VIIRS thermal detections from NOAA-20, NOAA-21,
  and Suomi-NPP, plotted from the coordinates supplied by the server API.
- A no-key NASA GIBS current-day thermal overlay and optional VIIRS aerosol
  classification layer. Neither is a mapped fire edge.
- Automatic Hellenic Fire Service incident-board status, plus near-real-time
  local reporting from StoNisi and Aeolos RSS feeds.
- Source-labeled local reports, with official, observed, reported, and modeled
  information visually distinguished.
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

## Data freshness and limitations

| Layer | Application check | Underlying data cadence | Important limitation |
| --- | --- | --- | --- |
| Detailed wind | Every 5 minutes while the page is open | Open-Meteo model cycles update less often | Point forecast/model, not an on-site anemometer |
| LGMT METAR | Every 5 minutes through the server route | Usually observed about every 30 minutes; provider cache updates about once a minute | Airport is not the fireground; terrain can produce very different local wind |
| Smoke envelope | Recomputed whenever wind data or the selected horizon changes | Derived from the current 10 m model wind | Not observed smoke, PM2.5, or a dispersion model |
| NASA FIRMS points | Every 5 minutes while the page is open | FIRMS services refresh about every 15 minutes after satellite processing | Orbital snapshots, typically available within about 3 hours; pixels are not a perimeter or proof of continuing flame |
| NASA GIBS thermal/aerosol overlay | Reloaded every 5 minutes | Daily satellite layers updated as observations arrive | Current-day detections persist; aerosol retrieval is coarse, daylight-only, cloud-sensitive, and not PM2.5 |
| Fire Service incident status | Every 60 seconds through the shared server cache | Official board refreshes approximately every 15 minutes and may publish newer minute-age data | Status only; no perimeter, route, or public action instructions |
| Local incident reporting | Every 60 seconds through the shared server cache | Publisher-controlled RSS/page updates | Local reporting is not official; StoNisi feed item timestamps are day-only, so the app uses the live story's modification time when available |
| 112 instruction | Manually verified direct official permalink | Cell broadcast and official publisher | No supported credential-free public 112 alert API; the banner displays the manual verification time, while phone alerts and authorities remain authoritative |

Every live data panel exposes its model/observation time. If live wind retrieval
fails, the interface marks the data stale and retains a timestamped fallback so
the failure is visible rather than silently presenting it as current.

## Sources

- [112 Greece — official alert](https://x.com/112Greece/status/2082468150189167080)
- [Greek Civil Protection guidance](https://civilprotection.gov.gr/112/odigies-prostasias)
- [Hellenic Fire Service](https://x.com/pyrosvestiki/status/2082459852350066823)
- [Hellenic Fire Service incident board](https://www.fireservice.gr/apps/fire2019/symvanta/page.php)
- [NASA FIRMS thermal-data description](https://firms.modaps.eosdis.nasa.gov/content/descriptions/FIRMS_VIIRS_Firehotspots.html)
- [NASA FIRMS Area API](https://firms.modaps.eosdis.nasa.gov/api/area/)
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
```

The key is optional: without it, the app retains the no-key NASA GIBS overlay
and the bundled timestamped fallback points. Never prefix the variable with
`NEXT_PUBLIC_`.

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
5. Deploy.

The `/api/thermal`, `/api/updates`, and `/api/wind` routes keep upstream
credentials and cross-origin requests on the server. The FIRMS key is never
sent to the browser. Vercel caches the shared news feed for about one minute
and wind/thermal responses for up to five minutes.

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
