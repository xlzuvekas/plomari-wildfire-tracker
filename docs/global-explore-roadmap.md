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
