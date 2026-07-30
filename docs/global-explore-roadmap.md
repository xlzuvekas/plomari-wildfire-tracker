# Global Explore and Localization Roadmap

**Status:** implementation work packages
**Updated:** 30 July 2026

## Product modes

1. **Explore** — world map, place search, source coverage, clustered wildfire
   incident candidates.
2. **Nearby** — an explicitly selected coarse area, nearby incidents, freshness,
   and jurisdiction-aware source availability.
3. **Incident** — official instructions/status, observations, reports, models,
   source health, provenance, and historical time selection.

Godseye informs global discovery, independent layer health, and object
inspection. It does not provide user localization, area-of-interest collection,
historical replay, or a persistence backend. Firewatch implements those
independently and retains provider attribution/terms.

## Privacy and cost boundary

Exact GPS stays in browser memory after an explicit tap. The browser renders
the precise marker and computes precise distance locally, then—only after a
separate area activation—sends a versioned coarse 10–20 km cell. Never send raw
coordinates in a URL or persist a movement trail, identity, device fingerprint,
or user timezone by default.

Page traffic queries Firewatch/Supabase first. Stale coverage creates at most
one deduplicated collection job per shared area/target/time bucket. Browsers do
not call upstream providers, and refresh polling does not increase demand
counts or paid-source usage.

## Cache and demand contract

The browser uses ordinary HTTP cache semantics and the production service
worker retains a bounded last-known-good snapshot for offline use. Public
responses are shared through Vercel's CDN. Supabase remains the durable source
of truth and already supplies unique job idempotency keys, lease fencing, and
`FOR UPDATE SKIP LOCKED` claims for global single-flight collection.

Redis is deliberately deferred. It must not become a second evidence store or
job authority. Add a small, single-region ephemeral cache only after metrics
show that CDN hit rate, Postgres leases, or coarse-cell rate limits need it;
every Redis key must then have a TTL and failures must fall back to the durable
database model.

The implemented request-time policy is deterministic and accepts only a
canonical coarse cell key:

| Mode | Thermal | Wind | RSS / official web | X |
| --- | --- | --- | --- | --- |
| Quiet | 15 minutes | Off | Off | Off |
| Watch | 5 minutes | 10 minutes | 5 minutes | Off |
| Incident | 2 minutes | 5 minutes | 5 minutes | Off in clients; scheduled persisted worker only |

Hidden clients make no request-time polls. An offline load gets one best-effort
service-worker snapshot read, then makes no recurring polls; live refresh
resumes immediately when the client becomes visible/online again. The active
incident route uses a five-minute feeds-only snapshot and performs no X API requests.
The current Plomari view also uses that public feeds-only snapshot. Paid or
limited realtime providers will run only in a persisted scheduled collector; a
browser request cannot authorize provider spend. Global discovery will run
once per provider-sized region and partition results into UI cells, never once
per viewer.

Repeated successful empty scans may back off from 15 to 30 to 60 minutes for
an active cell and then to 2, 6, and 12 hours while inactive. Failed, obscured,
partial, or unknown coverage never counts as a successful empty scan. A global
catalog or new regional anomaly can wake a quiet cell.

## Persisted satellite-pass reads

`GET /api/v3/satellite-passes` is the persisted, metadata-only satellite-pass
read boundary. It accepts a canonical `wm/z/x/y` coarse cell, never raw GPS or
an arbitrary browser bounding box. PostGIS reconstructs that cell and performs
the exact intersection against reviewed CMR catalog footprints. NASA is not
called by the route or browser.

The current read window ends on a shared five-minute UTC bucket and covers the
preceding 36 hours. A source scan can be a bootstrap, increment, or
reconciliation. An increment is not complete coverage by itself: the database
must prove an unbroken lineage to a complete baseline across the entire
requested window. Only that proof, current source health, complete product and
page coverage, and zero PostGIS intersections permit the response state
`valid-empty`. Stale, partial, gapped, disabled, unconfigured, or unavailable
coverage remains explicitly non-empty-eligible.

Every pass returns full RFC 3339 instants for the source observation interval,
source production and catalog times, and Firewatch retrieval time. These are
normalized to UTC with their meanings kept separate. CMR coverage is labeled
`catalog-footprint-intersection` and its anomaly assessment is always
`not_assessed`; catalog metadata cannot clear a FIRMS anomaly or claim a fire
is out. Only current complete responses can replace the service worker's
bounded last-known-good snapshot. Failures and incomplete coverage are
`no-store`.

## Renderer boundary

Global Explore will use a dynamically loaded MapLibre globe backed by curated
aggregate cells and a keyboard-accessible incident list. Incident mode keeps
the existing Leaflet renderer. Only one renderer is mounted at a time, and a
WebGL failure falls back to the semantic list plus a lightweight map/raster.
Cesium remains a later option for real terrain, altitude-aware objects, 3D
Tiles, or plume volumes. This adopts Godseye's camera-height layer budgets and
modular layers without copying its client polling, continuous rendering,
hidden attribution, or zero-as-error behavior.

## Implementation packages

| Package | Deliverable | Primary ownership |
| --- | --- | --- |
| P0-A contracts | `MapContext`, area, time, bounded-query, and response contracts | `lib/firewatch`, `lib/geo`, tests |
| P0-B shell | Normal-flow header/alert/time stack; reserved map grid; rails/sheets | `components/firewatch` |
| P0-C temporal UX | Full dates/zones, observed/published/checked labels, history semantics | `lib/time`, time components |
| P0-D incident profile | Remove Plomari coordinates, timezone, and source lists from routes | `lib/incidents`, v2 routes |
| P0-E persisted reads | Curated v3 incident/observation/event/source endpoints | migration, `lib/supabase`, v3 routes |
| P0-F adapters | FIRMS, EONET, GDACS, weather, METAR, Greek sources in shadow | `lib/adapters`, fixtures |
| P0-G integration | Compose the shell and v3 cutover behind a rollback flag | `app/page.tsx`, global CSS |

Only the integration owner edits the existing monolithic page during the shell
cutover. Other packages remain independently mergeable.

P1 adds the coarse area resolver, world/nearby UI, EFFIS/GWIS/Meteoalarm after
source review, France jurisdiction/source profiles, bounded historical reads,
and publication invalidation with cached polling fallback. P2 adds clearly
labeled smoke/air quality, official roads/cameras, outages/infrastructure,
compound hazards, moderated community evidence, an operations console, and
offline snapshots.

## Source order

- **P0 wildfire core:** FIRMS thermal observations; GIBS dated imagery; EONET
  and GDACS discovery/context; Open-Meteo modeled weather; METAR measurements;
  verified fire/civil-protection/emergency-alert sources.
- **P1 regional context:** EFFIS/GWIS/Meteoalarm and approved national/regional
  adapters, including a France pack.
- **P2 contextual layers:** pollutant-specific air quality, smoke, official
  roads/cameras, outages, ports, airports, buoys, and compound hazards.

Never import synthetic traffic, military/intent inference, client credentials,
public CORS proxies, random-jitter geolocation, unrelated camera fallbacks, or
automated evacuation routing.

## Layout target

```text
AppShell
├── IncidentHeader / AreaContextBar
├── EmergencyBanner
├── TimeContextBar
└── MapWorkspace
    ├── LeftRail (context, layers, key)
    ├── Map
    ├── RightRail / ObjectInspector
    └── StatusRail
```

Header, alert, and time controls stay in document flow. One workspace grid owns
map overlays; the location card belongs to the left rail. Tablet shows one
drawer at a time; mobile uses a map, bottom dock, and one bounded sheet. Rails
scroll independently, Leaflet receives `invalidateSize()` on layout resize, and
all key mobile targets are at least 44 px.

## Plomari and France acceptance

Shared:

- no overlap/clipping at 360×800, 390×844, 768×1024, 1024×768, 1366×768,
  1920×1080, and 2048×1152;
- every timestamp has date, semantic label, area timezone, and UTC offset;
- stale, valid-empty, unavailable, and unconfigured are distinct;
- historical view never leaks current-only data;
- every observation shows source, freshness, and provenance; and
- new persisted publications appear within 60 seconds.

Plomari resolves Greece/Lesvos, `Europe/Athens`, Greek/English, approved Greek
sources, and the existing incident. The archived 112 alert shows its original
full timestamp and is never presented as current.

A Marseille fixture resolves France, `Europe/Paris`, French/English, metric
units, and approved France/European sources. A Paris valid-empty fixture says
“No known incidents in this area,” never “No fire.” Greek labels, feeds,
coordinates, and 112 actions never leak into a France context. Summer/winter
DST behavior is tested separately.
