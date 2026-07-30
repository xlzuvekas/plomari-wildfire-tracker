# Data Truth Layer Specification

**Status:** Draft for direction  
**Version:** 0.1  
**Date:** 30 July 2026  
**Project:** Plomari Wildfire Tracker

## 1. Decision

Build a persistent, append-only data truth layer between upstream sources and
the public map.

The current application retrieves, classifies, deduplicates, and presents data
inside request handlers. That is sufficient for a live prototype, but it cannot
reliably answer:

- What changed since the last check?
- Which source first reported a claim?
- Was an item corrected, retracted, or superseded?
- What did the map know at a particular time?
- Is an apparent change new information or only a refreshed copy?
- Which critical sources are stale even though the application itself is up?

The truth layer will ingest source data independently of page traffic, retain
provenance and history, reconcile observations without hiding contradictions,
and publish a stable incident read model to the map.

## 2. Product position

The tracker remains an independent situational-awareness aid. It does not
become an emergency service, official incident command system, verified fire
perimeter, evacuation router, or automated prediction authority.

The truth layer must improve traceability without creating false certainty.
Every public object must preserve the distinction between:

- official instruction;
- official incident status;
- sensor observation;
- measured weather observation;
- modeled weather or smoke;
- publisher reporting;
- unverified field reporting;
- analyst interpretation.

No single numeric “truth score” will collapse these dimensions. Authority,
corroboration, sensor quality, freshness, and uncertainty remain separate.

## 3. Current baseline

The production application currently provides:

- a Next.js map deployed on Vercel;
- NASA FIRMS VIIRS detections from NOAA-20, NOAA-21, and Suomi-NPP;
- grouped satellite passes and an 8 km incident scope;
- Open-Meteo wind and AviationWeather LGMT METAR data;
- the Hellenic Fire Service incident board;
- Greek Civil Protection and Municipality of Mytilene feeds;
- ERT North Aegean, StoNisi, and Aeolos publisher feeds;
- optional official `@112Greece` and `@pyrosvestiki` retrieval;
- explicit source health, timestamps, and bilingual display;
- client polling every 60 seconds for updates and every five minutes for
  thermal and wind data.

Current limitations:

- successful responses are not persisted;
- source-health history is lost after each request;
- deduplication is limited to the current response;
- the map cannot replay prior incident state;
- material changes are not computed against a durable previous state;
- archived and current claims require manual UI handling;
- upstream corrections cannot be audited;
- source ingestion depends on incoming application requests;
- API routes contain both collection and presentation logic;
- heuristics categorize content without a durable explanation record.

## 4. Goals

### 4.1 Primary goals

1. Persist every successful or failed source check with its retrieval time.
2. Preserve immutable source items and all subsequent source revisions.
3. Normalize source data into typed observations and atomic assertions.
4. Reconcile related evidence into canonical events without deleting
   disagreement.
5. Compute deterministic, explainable material changes.
6. Publish a stable current-state API and cursor-based change feed.
7. Support incident timeline playback and forensic review.
8. Make source freshness and ingestion failures visible independently of
   incident status.
9. Keep protective-action flags restricted to validated official instructions.
10. Retain the application's English and Greek presentation without translating
    or rewriting the underlying evidence.

### 4.2 Success measures

- Reprocessing an identical source response creates no duplicate source item,
  observation, assertion, event, or material change.
- Every canonical event links to at least one immutable evidence record.
- Every material change includes a before state, after state, rule identifier,
  evidence links, and calculation time.
- An upstream failure never converts the last known state into “no activity.”
- A stale source is visibly stale within two expected source intervals.
- A source correction preserves both the original and corrected versions.
- A new official 112 instruction reaches the read model within two minutes of a
  successful ingestion.
- Current-state API responses have a cached p95 latency below 500 ms.
- The application can reconstruct its public incident state for any retained
  snapshot time.

## 5. Non-goals

The first implementation will not:

- infer or publish a fire perimeter from thermal pixels;
- infer fire movement from the movement of satellite pixel centroids;
- generate evacuation routes;
- turn publisher reporting into official public instructions;
- generate an all-clear from zero thermal detections;
- use an LLM to make protective-action or official-status decisions;
- accept unmoderated public reports;
- provide dispatch, crew tracking, or responder tasking;
- promise sub-minute streaming from sources that publish more slowly;
- replace source-specific licensing or attribution requirements;
- create a general multi-hazard platform before the Plomari incident model is
  validated.

## 6. Terminology

| Term | Definition |
| --- | --- |
| Source | A provider or publication, such as FIRMS, the Fire Service board, or ERT |
| Ingestion run | One attempt to retrieve a source at a recorded time |
| Source item | An immutable version of an upstream record, article, post, board row, sensor record, or model result |
| Observation | A normalized representation of what a source measured, modeled, published, or reported |
| Assertion | One atomic claim extracted from an observation, such as `incident.status = in_progress` |
| Canonical event | A durable incident object that groups related assertions and evidence |
| Evidence link | A typed relationship between an event and supporting, updating, or contradicting evidence |
| Incident state | The current read model derived from active canonical events |
| Material change | A versioned, rule-generated difference that is important enough to surface |
| Source freshness | Whether collection and source publication are occurring within source-specific expectations |
| Supersession | Replacement of a prior assertion or event state while retaining its history |

## 7. Design principles

### 7.1 Append-only evidence

Upstream evidence is never silently overwritten. A revised source item creates
a new version linked to the prior version.

### 7.2 Separate event time from system time

Store these independently:

- `observed_at`: when a sensor reading or described event occurred;
- `effective_at`: when an instruction or status became effective;
- `published_at`: when the source published it;
- `modified_at`: when the source says it changed;
- `retrieved_at`: when the collector received it;
- `recorded_at`: when the truth layer committed it.

All stored timestamps use UTC. Source timezone and time precision are retained.
Europe/Athens conversion is a presentation concern.

### 7.3 Evidence before interpretation

Original titles, identifiers, measurements, URLs, timestamps, and source
payload hashes are retained before categorization or summarization.

### 7.4 Authority is claim-specific

A source is not globally “more true.” Its authority depends on the claim:

- 112/Civil Protection is authoritative for protective instructions;
- the Fire Service board is authoritative for its published incident status;
- police or road authorities are authoritative for closures;
- FIRMS is authoritative only for its thermal-anomaly observations;
- AviationWeather is authoritative for the reported LGMT observation;
- Open-Meteo is a model provider, not an on-site measurement;
- publishers report claims and do not create official instructions.

### 7.5 Contradictions remain visible

Conflicting claims are stored together and marked as conflicting. The system
may select a current display state using an explicit rule, but it must not
delete or conceal contrary evidence.

### 7.6 Deterministic critical rules

Protective actions, official status transitions, source staleness, and
notification eligibility are deterministic and versioned. Machine learning or
LLM assistance may suggest categories or translations, but it cannot set an
official action flag, alter evidence, or decide an all-clear.

### 7.7 No activity is not the same as no data

Zero observations, source failure, source staleness, source unconfiguration,
and a successfully observed absence are distinct states.

## 8. Proposed system architecture

### 8.1 Components

1. **Source registry**
   - Stores source identity, authority scope, cadence, adapter version,
     attribution, and freshness policy.

2. **Collectors**
   - Run independently of page traffic.
   - Retrieve one source per job with timeout, retry, and rate-limit handling.
   - Record success, failure, latency, response metadata, and payload hash.

3. **Raw evidence store**
   - Retains encrypted raw responses for a limited audit window.
   - Stores large payloads in object storage and hashes in PostgreSQL.

4. **Normalizer**
   - Converts source-specific payloads into source items and observations.
   - Validates timestamps, coordinates, units, and incident relevance.

5. **Assertion extractor**
   - Produces typed atomic claims from normalized observations.
   - Uses deterministic parsers for official statuses and instructions.
   - May use assistive classification for publisher content, clearly labeled as
     machine-derived.

6. **Reconciliation engine**
   - Matches assertions to existing canonical events.
   - Records support, update, contradiction, retraction, and supersession.

7. **Material-change engine**
   - Compares the new incident state with the previous committed state.
   - Emits explainable changes and an outbox record.

8. **Read-model builder**
   - Produces denormalized current-state, timeline, map-object, and
     source-health views.

9. **Public API**
   - Serves only read models and evidence-safe detail.
   - Uses cursor pagination, ETags, and cache-aware responses.

10. **Operations console**
    - Displays adapter health, quarantined records, contradictions, and
      material-change explanations.
    - Human adjudication is introduced only after read-only shadow operation.

### 8.2 Recommended storage

Use managed PostgreSQL with PostGIS.

Reasons:

- transactional idempotency;
- durable relational provenance;
- spatial and temporal queries;
- JSONB for source-specific measurements;
- advisory locks for ingestion jobs;
- indexed current-state views;
- a clear path to row-level security for future moderation tools.

Object storage should hold raw payloads that are too large or unsuitable for
long-term relational storage.

### 8.3 Collection model

Collectors should run as scheduled jobs, not only inside public GET requests.
Each job:

1. acquires a source-specific advisory lock;
2. creates an `ingestion_run`;
3. retrieves the source with conditional headers where supported;
4. stores response metadata and a content hash;
5. exits idempotently if the payload has already been processed;
6. creates new immutable versions when content changes;
7. normalizes and validates the changed payload;
8. runs reconciliation in the same transaction where practical;
9. commits an incident-state snapshot and any material changes;
10. writes notification candidates to an outbox;
11. records final health and latency.

Retries must use exponential backoff with jitter. Authentication, quota, parser,
timeout, and upstream HTTP failures remain separate error classes.

## 9. Data model

All primary identifiers should be application-generated UUIDv7 values. Every
table includes `created_at`; mutable operational tables also include
`updated_at`.

### 9.1 `incidents`

| Field | Purpose |
| --- | --- |
| `id` | Stable incident identifier |
| `slug` | Public identifier, initially `plomari-2026-07-29` |
| `name_en`, `name_el` | Display names |
| `started_at`, `ended_at` | Incident lifecycle |
| `area_of_interest` | PostGIS polygon used for relevance queries |
| `default_timezone` | `Europe/Athens` |
| `lifecycle` | `active`, `monitoring`, `closed`, or `archived` |

### 9.2 `sources`

| Field | Purpose |
| --- | --- |
| `id`, `key` | Stable identity |
| `name`, `homepage_url` | Attribution |
| `source_kind` | Official alert, official status, sensor, model, broadcaster, publisher |
| `authority_scopes` | Claim types for which the source is authoritative |
| `expected_cadence_seconds` | Used for freshness |
| `stale_after_seconds` | Explicit stale threshold |
| `adapter_name`, `adapter_version` | Parser provenance |
| `enabled` | Operational control |
| `license_policy` | Storage and display constraints |

### 9.3 `ingestion_runs`

| Field | Purpose |
| --- | --- |
| `id`, `source_id` | Attempt identity |
| `started_at`, `finished_at` | Collection timing |
| `status` | `running`, `success`, `not_modified`, `partial`, `failed` |
| `http_status`, `latency_ms` | Upstream health |
| `payload_hash`, `raw_object_key` | Audit linkage |
| `item_count` | Parsed item count |
| `error_class`, `error_detail_safe` | Non-secret diagnostics |
| `collector_version` | Reproducibility |

### 9.4 `source_items`

| Field | Purpose |
| --- | --- |
| `id`, `source_id` | Version identity |
| `external_id`, `canonical_url` | Upstream identity |
| `version_number`, `supersedes_id` | Revision chain |
| `content_hash` | Idempotency |
| `title`, `language` | Evidence-safe source text |
| `published_at`, `modified_at`, `retrieved_at` | Time provenance |
| `time_precision` | `exact`, `date_only`, `unknown` |
| `raw_excerpt` | License-limited excerpt |
| `raw_payload` | Small structured source fields only |

Publisher bodies are not copied wholesale. Store a headline, direct URL,
content hash, permitted excerpt, and extracted structured metadata.

### 9.5 `observations`

| Field | Purpose |
| --- | --- |
| `id`, `incident_id`, `source_item_id` | Provenance |
| `observation_type` | Thermal detection, satellite pass, official status, article, wind model, METAR, etc. |
| `observed_at`, `effective_at` | Event time |
| `geometry` | PostGIS point, line, or polygon where supplied |
| `geometry_precision_m` | Spatial uncertainty |
| `measurements` | Typed JSONB values and units |
| `quality` | Source-provided quality, such as FIRMS confidence |
| `relevance_method` | Exact identifier, geometry, keyword, or analyst link |
| `parser_version` | Reproducibility |
| `validation_state` | `accepted`, `quarantined`, or `rejected` |

### 9.6 `assertions`

Assertions are atomic and machine-readable.

| Field | Purpose |
| --- | --- |
| `id`, `observation_id`, `incident_id` | Provenance |
| `subject_type`, `subject_key` | Incident, road, settlement, sector, source, etc. |
| `predicate` | `status`, `instruction`, `threatens`, `closed`, `contains_thermal_anomaly`, etc. |
| `value` | Typed JSONB object |
| `assertion_type` | Observation, report, model, instruction, or interpretation |
| `authority_scope` | Relevant authority category |
| `effective_at`, `expires_at` | Validity |
| `extraction_method` | Deterministic parser, source field, analyst, or assistive classifier |
| `extraction_version` | Rule or model version |
| `state` | `active`, `superseded`, `retracted`, or `disputed` |

### 9.7 `canonical_events`

| Field | Purpose |
| --- | --- |
| `id`, `incident_id` | Stable event identity |
| `event_type` | Instruction, status transition, thermal pass, road condition, smoke, response, etc. |
| `first_effective_at`, `last_effective_at` | Time range |
| `geometry`, `geometry_precision_m` | Best supported spatial representation |
| `lifecycle` | `active`, `superseded`, `resolved`, `retracted`, `disputed` |
| `verification_state` | `official`, `corroborated`, `single_source`, `unverified`, `contradicted` |
| `current_summary_en`, `current_summary_el` | Derived presentation |
| `reconciliation_version` | Explainability |

### 9.8 `event_evidence`

| Field | Purpose |
| --- | --- |
| `event_id`, `assertion_id` | Many-to-many linkage |
| `relationship` | `supports`, `updates`, `contradicts`, `retracts`, `supersedes` |
| `rationale_code` | Deterministic match reason |
| `linked_by` | Rule version or analyst identity |

### 9.9 `incident_state_snapshots`

| Field | Purpose |
| --- | --- |
| `id`, `incident_id`, `sequence` | Ordered state |
| `calculated_at` | System time |
| `state_hash` | Idempotency |
| `state` | Denormalized JSONB read model |
| `ruleset_version` | Reproducibility |

### 9.10 `material_changes`

| Field | Purpose |
| --- | --- |
| `id`, `incident_id`, `sequence` | Ordered change |
| `change_type`, `materiality` | Classification |
| `before_snapshot_id`, `after_snapshot_id` | Exact comparison |
| `rule_id`, `rule_version` | Explanation |
| `evidence_event_ids` | Supporting event identifiers |
| `summary_en`, `summary_el` | Public presentation |
| `protective_action` | Official action object or `null` |
| `notification_eligible` | Downstream decision |

### 9.11 `source_health_samples`

Retains source status over time without treating it as incident evidence:

- last successful retrieval;
- last changed payload;
- latest source publication;
- consecutive failures;
- latency;
- authentication or quota state;
- freshness state;
- adapter/parser health.

## 10. Identity and deduplication

Apply identity rules in this order:

1. source-provided stable identifier;
2. normalized canonical URL;
3. sensor-specific natural key;
4. source ID plus normalized timestamp plus payload hash.

FIRMS detection natural key:

`product + satellite + observed_at + rounded_lat + rounded_lon + scan + track`

Satellite pass identity:

`product + satellite + pass_start`, where detections no more than ten minutes
apart belong to the same detecting pass.

Source revisions:

- same external ID and same content hash: no new version;
- same external ID and changed content hash: new version with `supersedes_id`;
- deleted upstream item: retain evidence and mark availability separately;
- source correction: create a new observation and supersede affected
  assertions.

Canonical events are not deduplicated by headline similarity alone. Reconciliation
uses event type, source identity, time, geography, entities, and assertion
values. An official instruction is never merged into a publisher report.

## 11. Reconciliation rules

### 11.1 Official protective instructions

- Create only from a validated official-alert adapter.
- Preserve the original instruction text and direct source URL.
- Extract origin, destination, affected area, issued time, and expiration only
  when explicitly present.
- A later instruction may supersede an earlier instruction, but does not erase
  it.
- Absence of a newer instruction is not an all-clear.

### 11.2 Official incident status

- Parse the Fire Service board deterministically.
- Emit a transition only when the normalized status changes.
- A failed or stale board check retains the last known status and separately
  marks it stale.
- Only an explicit official state can produce `partial_control`,
  `full_control`, `ended`, or an official all-clear equivalent.

### 11.3 Thermal detections

- Persist each detection and detecting pass independently.
- Preserve FIRMS confidence, FRP, scan, track, platform, and observation time.
- Spatial clustering may describe groups of detected pixels.
- Cluster movement must not be labeled fire-front movement.
- No-detection passes are not inferred because FIRMS does not expose them.
- Zero detections cannot resolve the incident.

### 11.4 Publisher and broadcaster reports

- Retain source title, URL, time, and limited excerpt.
- A single report creates a `single_source` event.
- Two independent sources making materially compatible claims may create a
  `corroborated` event.
- Syndicated copies do not count as independent corroboration.
- Publisher text cannot create an official protective action.

### 11.5 Weather and smoke

- METAR observations remain measured airport conditions.
- Open-Meteo values remain modeled point conditions.
- Smoke envelopes remain derived models with their input and calculation
  versions.
- No modeled smoke value is labeled measured air quality.

### 11.6 Contradictions

When assertions conflict:

1. preserve both;
2. attach both to the canonical event;
3. mark the event `disputed` when the conflict affects its current state;
4. prefer a source only when a claim-specific authority rule applies;
5. expose the reason for the selected display state;
6. require analyst review before resolving ambiguous high-materiality
   conflicts.

## 12. Material-change rules

Every rule has an immutable ID and version. Rule results include their evidence
and are reproducible from snapshots.

| Change | Required evidence | Public treatment | Notification |
| --- | --- | --- | --- |
| New or changed evacuation/readiness instruction | Validated official-alert source | Critical official instruction with exact action | Yes |
| Official cancellation or all-clear | Explicit validated official source | Critical official update | Yes |
| Fire Service status transition | Fire Service board | Official incident status | Yes |
| Official road closure/opening | Road authority, police, municipality, or Civil Protection | Official road update | Yes |
| Reported settlement threat | Public broadcaster or publisher | Clearly labeled report | Only after configured corroboration policy |
| New detecting satellite pass inside incident area | Successful FIRMS response | Sensor observation; not fire movement | Normally timeline only |
| Material wind threshold crossing | Two consecutive model retrievals or a new measured observation | Modeled or measured weather change | Configurable; never an evacuation instruction |
| New modeled smoke direction | Current wind input and calculation version | Modeled exposure change | Timeline only by default |
| Critical source stale | Missed source-specific freshness threshold | Source-health warning | Operations alert, not public incident alert |
| All critical sources unavailable | Repeated failures across independent collectors | Prominent data-availability warning | Operations alert |

Initial wind thresholds for evaluation:

- gust crosses 50, 70, or 90 km/h;
- 10 m direction changes at least 45 degrees and persists for two model
  retrievals;
- measured LGMT gust changes at least 15 kt;
- model and METAR disagreement exceeds a configured threshold.

These thresholds describe changing conditions, not predicted fire spread.

## 13. Freshness model

Freshness has three independent dimensions:

1. **Collector freshness:** when the application last reached the source.
2. **Publication freshness:** when the source last published or modified data.
3. **Observation freshness:** when the underlying event or measurement
   occurred.

Initial source policies:

| Source | Collection target | Stale threshold | Notes |
| --- | --- | --- | --- |
| Official 112 account, when configured | 60 seconds | 3 minutes | Optional API must not be the only alert path |
| Fire Service board | 60 seconds | 5 minutes collector / source age shown separately | Board may publish less frequently |
| Official and publisher feeds | 60 seconds | 5 minutes collector | Publication age remains separate |
| FIRMS | 5 minutes | 15 minutes collector | Observation latency may be up to several hours |
| Open-Meteo | 5 minutes | 15 minutes collector | Model cycle age must be exposed |
| LGMT METAR | 5 minutes | 20 minutes collector / 90 minutes observation | Airport is not the fireground |

Future timestamps, invalid coordinates, impossible units, and timestamps older
than the incident relevance window are quarantined rather than silently used.
Date-only records retain date-only precision and never display a fabricated
exact age.

## 14. Public API

Keep the current version 2 routes operational during migration. Introduce a
version 3 truth API:

### 14.1 Current state

`GET /api/v3/incidents/{slug}/current`

Returns:

- incident lifecycle and official status;
- active official instructions;
- current weather observations and models;
- latest thermal detecting passes;
- active reported/corroborated events;
- source-health summary;
- state sequence, state hash, and calculation time.

### 14.2 Material changes

`GET /api/v3/incidents/{slug}/changes?after={cursor}`

Returns ordered material changes with an opaque cursor. An empty result means
“no new material change,” not “no incident activity.”

### 14.3 Timeline

`GET /api/v3/incidents/{slug}/events?before={cursor}&limit=50`

Supports event type, verification state, source, and time filters.

### 14.4 Map observations

`GET /api/v3/incidents/{slug}/observations?types=thermal,weather&from={time}`

Returns evidence-level sensor and model records suitable for map rendering.

### 14.5 Source health

`GET /api/v3/incidents/{slug}/sources`

Returns current health plus last-success, last-change, and source-publication
times.

### 14.6 Evidence detail

`GET /api/v3/events/{eventId}`

Returns the canonical event, assertions, evidence links, reconciliation
rationale, and source URLs within licensing constraints.

All list endpoints use stable cursor pagination. Current-state endpoints provide
ETags. The initial client continues polling; server-sent or database-realtime
transport is deferred until the persisted change feed is proven.

### 14.7 Example material change

```json
{
  "id": "0198...",
  "sequence": 184,
  "incidentId": "0198...",
  "changeType": "official_status_transition",
  "materiality": "high",
  "calculatedAt": "2026-07-30T05:03:12Z",
  "rule": {
    "id": "official-status-transition",
    "version": 1
  },
  "before": {
    "status": "in_progress"
  },
  "after": {
    "status": "partial_control"
  },
  "verificationState": "official",
  "evidence": [
    {
      "eventId": "0198...",
      "sourceKey": "fire-service-board",
      "sourceUrl": "https://www.fireservice.gr/apps/fire2019/symvanta/page.php"
    }
  ],
  "summaryEn": "The Fire Service now lists the incident under partial control.",
  "summaryEl": "Η Πυροσβεστική καταγράφει πλέον το συμβάν σε μερικό έλεγχο.",
  "protectiveAction": null
}
```

## 15. User experience requirements

### 15.1 “What changed” briefing

The primary update surface should answer:

- what changed;
- when the underlying evidence occurred;
- when the source published it;
- when the application retrieved it;
- whether it is official, observed, modeled, corroborated, or unverified;
- what prior state it replaces;
- whether authorities issued a specific action.

### 15.2 Timeline

- Current live events appear before archived chronology.
- Superseded instructions remain visible as history, never as current action.
- Corrections and retractions are visually linked to the original event.
- Users can distinguish event time from publication and retrieval time.
- Timeline playback uses committed state snapshots, not regenerated current
  heuristics.

### 15.3 Source-health surface

Display:

- healthy, stale, failed, rate-limited, authentication failure, or
  unconfigured;
- last successful retrieval;
- latest source publication;
- expected cadence;
- whether the last state is retained from an earlier successful check.

### 15.4 Bilingual presentation

- Evidence remains in its source language.
- Application summaries are stored separately as English and Greek derived
  fields.
- Critical official instructions display the source wording alongside
  translation when available.
- Translation failure never blocks evidence ingestion.

## 16. Reliability and observability

### 16.1 Service objectives

- 99% successful scheduled executions per enabled critical source, excluding
  documented upstream outages.
- 99.9% idempotent processing under replay tests.
- p95 current-state API latency below 500 ms from the read model.
- p95 material-change calculation below 30 seconds after normalized evidence is
  committed.
- zero secrets in public payloads, logs, or stored source excerpts.

### 16.2 Required telemetry

- ingestion attempts, successes, failures, and latency by source;
- payload changed/not-modified rate;
- parser rejection and quarantine counts;
- observations and assertions created;
- reconciliation matches, new events, and conflicts;
- material changes by rule;
- notification candidates and delivery outcomes;
- current read-model sequence and build latency;
- database and object-store errors.

### 16.3 Operational alerts

Alert maintainers for:

- official-alert source stale or authentication failure;
- Fire Service parser failure;
- all news/official context sources unavailable;
- FIRMS authentication or quota failure;
- repeated future timestamps or schema drift;
- change-engine transaction failure;
- read model behind the latest committed evidence;
- notification outbox backlog.

Operational alerts are distinct from public incident notifications.

## 17. Security, privacy, and content controls

- Keep `FIRMS_MAP_KEY`, optional `X_BEARER_TOKEN`, database credentials, and
  object-store credentials server-only.
- Do not use `NEXT_PUBLIC_` for secrets.
- Encrypt database and raw object storage at rest and in transit.
- Do not store user GPS, account identity, or personal location in phase 1.
- Strip credentials and unnecessary headers before raw-response retention.
- Apply strict retention to raw publisher payloads.
- Store only licensed excerpts, hashes, metadata, and direct links for
  publisher content.
- Rate-limit evidence-detail endpoints.
- Add role-based access before any analyst mutation or field-report workflow.
- Record every analyst adjudication with actor, reason, before, and after state.
- Never let a generated translation or summary replace original evidence.

## 18. Retention

Recommended initial policy:

| Data | Retention |
| --- | --- |
| Ingestion metadata and health | 1 year |
| Raw official/sensor payloads | 90 days |
| Raw publisher payloads | 30 days or less if licensing requires |
| Source-item metadata and hashes | Incident lifetime plus 1 year |
| Observations, assertions, and event evidence | Incident lifetime plus 1 year |
| Incident snapshots and material changes | Permanent project record |
| High-frequency model weather records | 90 days, then hourly aggregation |
| Logs containing no source content | 30 days |

Retention jobs must delete object-store data and mark the corresponding key as
expired without deleting normalized provenance.

## 19. Failure modes

| Failure | Required behavior |
| --- | --- |
| Upstream timeout | Record failed run; retain last known state; mark source health |
| HTML or RSS schema change | Quarantine unparsed response; alert adapter owner |
| Authentication failure | Do not retry aggressively; mark configuration failure |
| Quota exhaustion | Respect reset; retain state; display delayed source |
| Database outage | Do not emit unpersisted changes or notifications |
| Duplicate scheduled jobs | Advisory lock and unique constraints prevent duplicates |
| Late-arriving evidence | Store with original event time and current retrieval time |
| Source correction | Create immutable revision and supersession chain |
| Source deletion | Preserve prior evidence and mark upstream availability |
| Contradictory official and publisher claims | Prefer claim-specific official state while retaining conflict |
| Clock or timezone error | Quarantine implausible times; never infer exact time from date-only data |
| FIRMS returns zero rows | Store successful zero result; do not infer all-clear |
| All sources fail | Display data-availability failure, not “no change” |
| Reconciliation bug | Rebuild read models from immutable evidence using a corrected ruleset |

## 20. Migration and rollout

### Phase 0 — Contract lock and fixtures

- Move shared source and event types into versioned modules.
- Capture sanitized fixtures for every adapter, including failures and
  corrections.
- Define JSON Schemas for source items, observations, assertions, events,
  snapshots, and changes.
- Add replay and idempotency tests.
- Finalize source authority and freshness registry.

**Exit criterion:** Every current upstream response can be normalized from a
fixture with deterministic results.

### Phase 1 — Persistent ingestion in shadow mode

- Provision PostgreSQL/PostGIS and raw object storage.
- Add migrations and source registry.
- Move collectors out of public GET handlers.
- Persist ingestion runs, source items, observations, and source health.
- Continue serving the existing version 2 APIs.
- Compare persisted results with current live route outputs.

**Exit criterion:** Seven consecutive days of shadow ingestion with no duplicate
evidence, no lost successful response, and explainable source-health state.

### Phase 2 — Reconciliation and current read model

- Add assertions, canonical events, and evidence links.
- Implement deterministic official-status and instruction rules.
- Build version 3 current, events, observations, and source APIs.
- Switch the map to version 3 behind a feature flag.

**Exit criterion:** The current map state can be rebuilt exclusively from
persisted evidence and matches reviewed expectations.

### Phase 3 — Material changes

- Add state snapshots, rules engine, and change feed.
- Build the “what changed” briefing.
- Add operations-only alerting and change explanations.
- Run public notifications in dry-run mode.

**Exit criterion:** Reviewed test scenarios produce the correct single material
change with no duplicate notification candidates.

### Phase 4 — Playback and controlled collaboration

- Add timeline playback.
- Add analyst contradiction/adjudication workflow.
- Introduce notification subscriptions only after dry-run review.
- Prepare schemas for moderated field reports without enabling public writes.

**Exit criterion:** An operator can explain and reproduce every public state and
material change from evidence.

## 21. Acceptance tests

1. Process the same FIRMS response 100 times; one source version and one set of
   detections exist.
2. Process a revised official board response; the prior status remains
   auditable and one status-transition change is emitted.
3. Fail the Fire Service collector for three intervals; the last status remains
   visible and becomes stale rather than disappearing.
4. Return a successful FIRMS response with zero rows; no all-clear or
   containment change is emitted.
5. Ingest two syndicated publisher articles; they count as one reporting origin,
   not corroboration.
6. Ingest two independent compatible reports; the event becomes corroborated
   without becoming official.
7. Ingest a publisher evacuation headline; no protective action is created.
8. Ingest a validated new 112 instruction; it supersedes the prior instruction,
   preserves both, and creates one notification-eligible change.
9. Ingest a date-only official item; it retains date-only precision and no
   fabricated age.
10. Ingest a future-dated item; it is quarantined and excluded from the read
    model.
11. Change reconciliation rules and replay evidence; a new ruleset rebuilds the
    read model without mutating evidence.
12. Request the change feed twice with the same cursor; responses are stable and
    ordered.
13. Switch the UI to Greek; derived summaries change language while evidence and
    identifiers remain unchanged.
14. Remove all API keys; public payloads show unconfigured sources without
    leaking secret names beyond documented environment-variable labels.
15. Simulate a database write failure; no notification is emitted for
    uncommitted evidence.

## 22. Initial implementation epics

### Epic A — Contracts and source registry

- shared TypeScript domain package;
- source authority and freshness configuration;
- JSON Schema validation;
- sanitized adapter fixtures.

### Epic B — Persistence

- PostgreSQL/PostGIS migrations;
- ingestion run and source-item repositories;
- raw object-store adapter;
- idempotency and retention jobs.

### Epic C — Collectors

- FIRMS collector;
- Fire Service collector;
- official and publisher feed collectors;
- wind and METAR collectors;
- scheduler, retry, and advisory locking.

### Epic D — Reconciliation

- observation normalizers;
- assertion extraction;
- canonical-event matcher;
- contradiction and supersession handling.

### Epic E — Read models and API

- current-state builder;
- timeline and observation views;
- source-health view;
- version 3 API and cursor contracts.

### Epic F — Change engine

- state snapshots;
- versioned materiality rules;
- change feed;
- operations outbox and dry-run notification audit.

## 23. Decisions required before implementation

| Decision | Recommended default |
| --- | --- |
| Managed database vendor | Any managed PostgreSQL service with PostGIS, point-in-time recovery, and regional placement suitable for the project |
| Scheduler/worker runtime | Independent scheduled worker with at-least-once delivery and PostgreSQL advisory locks |
| Raw payload storage | Encrypted object storage with lifecycle deletion |
| Initial incident scope | One incident, with multi-incident-compatible identifiers |
| Public transport | Poll version 3 changes using cursor and ETag |
| Notifications | Operations-only dry run until material-change precision is reviewed |
| Analyst tools | Read-only health/contradiction console before write access |
| Field reports | Schema extension only; no public submission in this phase |
| LLM use | Optional categorization/translation assistant outside the critical action path |

## 24. Direction checkpoint

Approval of this specification authorizes Phase 0 design and fixtures only.
Before provisioning persistence or changing production ingestion, confirm:

1. the managed PostgreSQL provider;
2. the scheduled worker runtime;
3. whether raw publisher responses may be retained for up to 30 days;
4. whether the tracker remains Plomari-specific through Phase 3;
5. who may adjudicate disputed events in Phase 4.

