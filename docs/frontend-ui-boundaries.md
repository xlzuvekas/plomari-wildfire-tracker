# Frontend boundaries for UI work

**Status:** working agreement between the integration owner and UI contributors
**Updated:** 31 July 2026
**Companion docs:** [Global Explore roadmap](global-explore-roadmap.md),
[production architecture](production-architecture.md), issues
[#36](https://github.com/xlzuvekas/plomari-wildfire-tracker/issues/36) and
[#37](https://github.com/xlzuvekas/plomari-wildfire-tracker/issues/37)

This document is the short, binding version of the frontend rules. If a UI
change cannot satisfy one of these boundaries, raise it before building —
do not ship an exception.

## Product modes

The interface has exactly three modes, and a session is always in one of them:

1. **Explore** — global globe: aggregate wildfire candidate/incident cells,
   place search, source coverage.
2. **Nearby** — an explicitly activated coarse area: nearby
   candidates/incidents, freshness, jurisdiction-aware source availability.
3. **Incident** — the tactical map: official instructions/status,
   observations, reports, models, source health, historical time selection.

## Renderer boundary

- **MapLibre** (dynamically imported) renders the Explore globe.
- **Leaflet** renders Incident tactical detail (the existing renderer).
- **Only one renderer is mounted at a time.** Mode transitions unmount the
  previous renderer before mounting the next. No hidden or stacked map
  instances, no shared WebGL/DOM containers.
- A WebGL failure in Explore falls back to the keyboard-accessible incident
  list plus a lightweight raster map, not to a broken canvas.

## Privacy boundary

- Exact GPS stays in browser memory, requested only after an explicit tap.
  The browser renders the precise marker and computes precise
  distance/bearing locally.
- The backend receives at most a canonical coarse **`wm/z/x/y`** cell, and
  only after a separate, explicit area activation.
- Never place raw coordinates in a URL, request body, log, or analytics
  event. Never send addresses or coordinates to third-party geocoders from
  the client without an approved server boundary.
- No movement trails, device fingerprints, or default user-timezone
  persistence.

## Satellite-pass data semantics

- Use `GET /api/v3/satellite-passes?cell=wm/z/x/y` for pass coverage.
- CMR results are **satellite coverage** (catalog-footprint intersections):
  they prove a cataloged granule covered the area. They are **not fire
  detections** and must never be styled, worded, or clustered as detections.
- `anomalyAssessment` remains `not_assessed` for CMR footprints. The UI must
  not infer, upgrade, or display any other assessment from them.
- No UI state may ever read as "fire resolved," "all clear," or "no fire."
  The strongest permitted negative is "no anomaly observed on this pass" /
  "no known incidents in this area," with coverage limitations shown
  (see #36 for the lifecycle wording).

## Timestamp contract

Every displayed timestamp shows all of:

1. full date;
2. time;
3. timezone (the selected area's zone);
4. UTC offset; and
5. a provenance label: **observed**, **published**, **cataloged**, or
   **retrieved**.

Relative ages ("12 min ago") may accompany but never replace the full form.
Historical (as-of) views admit only values known at the cutoff and withhold
current-only data (live source health, current-day imagery, latest wind)
rather than presenting it as historical.

## Layout contract

- Header, warning banner, and time scrubber live in **normal document
  flow** — not absolutely positioned over the map.
- One **map workspace grid** owns the map and its rails/overlays
  (see the AppShell layout target in the Global Explore roadmap).
- Mobile gets a map, a bottom dock, and **one bounded sheet at a time**.
  No overlapping floating panels, no stacked z-index wars.
- Rails/sheets scroll independently; the map receives `invalidateSize()`
  (Leaflet) or `resize()` (MapLibre) on layout resize; touch targets are
  at least 44 px.

## Data-source boundary for the globe

- The global Explore globe must **not** call the Plomari-specific
  `/api/thermal`, `/api/updates`, or `/api/wind` routes, and must not call
  upstream providers directly.
- Until the v3 global discovery endpoints (#37) land, Explore renders from a
  **typed fixture behind an interface** (e.g. a `GlobalDiscoveryClient` with
  a fixture implementation) so the swap to `/api/v3/explore/cells` and
  friends is a data-layer change, not a UI rewrite.
- Browsers never authorize paid retrieval (X or any quota-limited provider);
  collection is a persisted scheduled-worker concern.

## Code ownership

- **One integration owner edits `app/page.tsx`** (and the shell cutover in
  `app/globals.css`). The file is ~4,900 lines; parallel edits do not merge.
- All other UI work lands as **extracted components** (`components/…`) and
  libraries (`lib/…`) with their own tests, imported by the integration
  owner during composition.
- If your feature seems to require editing `app/page.tsx`, extract first or
  hand the integration point to the owner.

## Caching order

CDN caching (`s-maxage`/`stale-while-revalidate`), ETags with
`If-None-Match`/`304`, and the bounded service-worker last-known-good
snapshot come first. Redis is deferred until measured pressure shows CDN hit
rate, Postgres leases, or coarse-cell rate limits need it.

## Parallel backend priorities (context for sequencing)

1. Persist FIRMS detections and the explicit anomaly lifecycle (#36). A
   later valid pass may say "no anomaly observed on this pass," never
   "fire resolved."
2. v3 global discovery and incident APIs (#37): aggregate cells, incidents,
   current state, events, observations, sources, bounded historical reads.
3. Persist Fire Service, RSS, weather, METAR, EONET/GDACS, then
   EFFIS/GWIS/Meteoalarm — not per-page-request collection.
4. Adaptive polling, quiet-area backoff, provider quotas, and a
   cost/request ledger. Browsers never authorize paid retrieval.
5. Collector/source-health monitoring, timestamp-regression handling, cron
   alerts, operational runbooks.
6. Local RSS reader, then the cited OpenRouter orientation workflow only
   after its evidence and human-review persistence exists.
7. Graph/Graphiti projection and Stripe stay deferred.

## First shared integration milestone

```
open app → resolve coarse area → show global/nearby incidents
        → open incident → scrub trustworthy history
```

Explore and Nearby may run on fixtures until #37 lands; Incident runs on the
existing persisted/v2 reads. The milestone is done when that path works with
the renderer, privacy, timestamp, and layout contracts above intact.
