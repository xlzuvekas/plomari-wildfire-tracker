# Open-Meteo Air Quality — adapter foundation and activation path

Status: **registered, disabled, no runtime**. This document records what the
air-quality bootstrap ships, what it deliberately does not ship, and the
operator checklist for turning it on later.

Provenance: issue #43 work package A, superseding PR #19's request-time
route. Parser lineage: tyler-grimes commits `e002589`, `0e31aa7` (reviewed
and reimplemented against the evidence boundary).

## What ships now

- `lib/air-quality/open-meteo.ts` — pure protocol module. URL builder
  (allowlisted query keys only: `latitude`, `longitude`, `current`,
  `timezone=UTC`), byte-capped parser with coded `malformed` reasons,
  never throws, no network I/O.
- `lib/air-quality/open-meteo-collector.server.ts` — collection
  orchestrator: deterministic five-minute plan slots, persistence port
  (`reserve / heartbeat / persistReading / persistReadingFailure /
  complete / fail`), required injected `fetchImpl`, every request through
  `recordedFetch` so raw bytes are durable before parsing.
- `supabase/migrations/20260731190000_open_meteo_air_quality_bootstrap.sql`
  — provider/source/endpoint registration, everything `enabled = false`,
  license `unreviewed`, guard block forbids collection targets and adapter
  releases at bootstrap time.

## Semantics (non-negotiable)

- Open-Meteo air quality is a **model** (CAMS-based). Trust class
  `modeled`; never present a reading as an on-site measurement.
- Pollutant fields (PM2.5, PM10, NO₂, O₃, AOD) stay separate fields.
  `european_aqi` / `us_aqi` are **provider indexes** and are never
  relabeled as a pollutant concentration.
- Model timestamps are requested in UTC (`timezone=UTC`); a response with
  a non-zero `utc_offset_seconds` is rejected as malformed rather than
  reinterpreted.
- No place, incident, timezone, or regional AQ index is hard-coded.
  Target points arrive from configuration (jurisdiction profiles).

## Deliberately not shipped

- No detail/readings table, no Edge Function runtime, no postgres
  persistence adapter (the port's SQL implementation), no cron job, no v3
  read route, no UI. Each follows the CMR/FIRMS sequencing: registration
  first, runtime and projections as separate reviewed steps.

## Activation checklist (in order)

1. **License review**: confirm Open-Meteo non-commercial API terms and
   CC BY 4.0 attribution fit the deployment; flip `license_status` to a
   reviewed value in a migration.
2. **Readings persistence**: migration for the readings detail table
   (UTC source/retrieval times, per-pollutant columns, provider indexes,
   geometry) plus the postgres adapter implementing
   `AirQualityPersistence`, with pgTAP coverage.
3. **Edge Function**: `supabase/functions/collect-open-meteo-aq/`
   mirroring `collect-firms/` (bounded body, runtime identity assertion,
   lease reaping, public summary), deployed disabled.
4. **Adapter release**: real artifact digest + git commit registered in
   `core.adapter_releases`.
5. **Targets**: jurisdiction-profile collection targets with coarse area
   geometry; enable target revisions.
6. **Schedule**: pg_cron job at the endpoint's `poll_interval`; enable
   endpoint state last.
7. **Reads/UI**: bounded v3 read (`coverage.state: "not_assessed"`,
   `result.state: "items" | "indeterminate"`, never `valid-empty`), then
   UI through the #41 shell with the #42 timestamp contract (full date,
   time, area timezone, UTC offset, provenance label).
