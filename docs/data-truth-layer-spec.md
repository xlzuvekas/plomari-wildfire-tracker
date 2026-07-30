# Data Truth Layer Specification

**Status:** Draft for direction  
**Version:** 0.2
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
global provenance and history, link relevant observations to one or more
incidents without copying them, reconcile evidence without hiding
contradictions, and publish stable incident read models to the map.

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
- archived official-account context; live X retrieval is disabled until a
  persisted scheduled collector is provisioned;
- explicit source health, timestamps, and bilingual display;
- client polling every five minutes for updates and wind data and every two
  minutes for active-incident thermal data.

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
11. Support multiple simultaneous wildfire incidents without duplicating a
    provider, endpoint, source item, or observation for every incident.

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
| Source provider | Organization-level identity and attribution, such as NASA Earthdata or the Hellenic Fire Service |
| Source endpoint | One feed, account, page, station, dataset, imagery product, or model API with its own authority and license policy |
| Collection target | A versioned request/query against an endpoint, including geography, cadence, and freshness policy |
| Incident-source binding | Configuration that selects a collection target for an incident |
| Ingestion run | One attempt to retrieve a collection target at a recorded time |
| HTTP exchange | One issued upstream HTTP request and its terminal response, transport failure, or indeterminate abandoned result |
| Source item | An immutable version of an upstream record, article, post, board row, sensor record, or model result |
| Observation | A global normalized representation of what a source measured, modeled, published, or reported |
| Incident-observation link | Immutable relevance evaluation connecting an observation to an incident and the AOI version used |
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

Historical reads keep these clocks separate. An `effective_at`/`observed_at`
selection answers what the evidence describes at a point in incident time;
`known_at` limits the query to rows and publication decisions already recorded
by that cutoff. The default historical map uses `known_at = now()` so later
corrections are visible. Audit replay sets both cutoffs explicitly. Unknown
times never receive a synthetic slider position, and date-only evidence is
selected by its source calendar date rather than UTC midnight.

Immutable snapshots initially support committed-snapshot replay only: select
the newest snapshot whose `as_of` and database creation clock are within the
two cutoffs. Recomputing a corrected historical composite from evidence learned
later requires versioned bitemporal snapshot editions; the API must not imply
that arbitrary stored snapshot JSON has already been retroactively rebuilt.

### 7.3 Evidence before interpretation

Original titles, identifiers, measurements, URLs, timestamps, and source
payload hashes are retained before categorization or summarization.

Every upstream data request that can influence a displayed observation,
status, alert, model, summary, or source-health decision is itself durable
evidence. The collector records a credential-redacted application request
entity before network I/O and records exactly one terminal result afterward.
The retained entity is sufficient to reconstruct that credential-redacted
application exchange; it is deliberately not a replay-ready wire message. Its
schema excludes explicit credential and transport fields, TLS state, HTTP
framing, transfer-compression bytes, cookies, and other transport-private state.

The safe request URL is the catalog-bound HTTPS origin and path only: it has no
userinfo, query, or fragment and must exactly equal the endpoint's approved
base URL. Credential-free query values, request headers, response
headers, and request/result metadata are stored in separate, bounded maps with
positive key allowlists. Unknown keys and nested structures are rejected.
Credential fields—including authorization, cookies, `x-auth-token`, signed URL
or signed-query material, redirect `Location`, and `set-cookie`—are not
representable in this safe envelope. Positive key allowlists and bounded flat
values are defense in depth; they cannot prove that an opaque value under an
allowed key is not a secret. A trusted, provider-reviewed collector must still
exclude credentials. Redaction is not a reason to put a secret-bearing URL or
an unapproved field into a generic metadata map.

For bodies, “exact” means the application-body byte sequence at the collector's
declared HTTP-runtime boundary: the redacted request bytes supplied to the
client and the response bytes presented to the adapter after the runtime's
configured transfer/content decoding. It does not mean the original network
framing or compressed wire serialization. The adapter release and fixtures
must keep that byte boundary deterministic.

HTTP responses, including non-2xx, redirect, and zero-byte responses, are
linked to immutable exact-byte raw content. Every redirect response is
terminalized on its own exchange; following its transient `Location` creates a
new catalog-validated exchange and does not persist that header. Transport
failures retain only safe error metadata. A request abandoned after issuance
is explicitly indeterminate. Its missing response must never be reconstructed,
parsed, normalized, or published by assumption.

Parsing and publication are downstream of raw persistence. If evidence cannot
be stored, the response cannot influence a public read model. Run-level request
counts are derived from the per-request ledger rather than trusted as caller
supplied summaries.

This boundary covers server-side acquisition from NASA, weather services,
official pages and feeds, social APIs, AI providers, and future adapters. It
does not turn browser requests for presentation-only basemap, imagery, font, or
application assets into incident evidence. Those responses remain under their
provider cache and retention terms and cannot be cited as database truth.
Calls to Firewatch's own read API are reconstructed from the underlying stored
entities and are handled by access logs rather than duplicated as upstream
evidence.

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

1. **Source catalog and target registry**
   - Separates organization-level providers, endpoint/product semantics,
     collection targets, and incident-source bindings.
   - Stores claim authority, content and license policy on each endpoint.
   - Stores query geography, cadence, enablement, and freshness policy on each
     collection target.

2. **Collectors**
   - Run independently of page traffic.
   - Retrieve one collection target per logical job with timeout, retry, and
     rate-limit handling.
   - Coalesce compatible target requests to the same endpoint where the
     upstream API supports batching, while retaining target-specific runs and
     health.
   - Record success, failure, latency, response metadata, and payload hash.

3. **Raw evidence store**
   - Retains encrypted raw responses for a limited audit window.
   - Stores exact small bodies as database-verified `inline_bytes`; stores
     large exact bodies at content-addressed object-storage paths and requires
     the collector to verify their byte count and digest on write and read.
   - Uses `inline_payload` only for a canonical PostgreSQL `jsonb::text`
     semantic representation. JSONB normalization changes whitespace and key
     order, so this representation is never claimed as original request or
     response bytes.

4. **Normalizer**
   - Converts source-specific payloads into source items and global
     observations.
   - Validates timestamps, coordinates, units, and source semantics.

5. **Incident relevance linker**
   - Evaluates global observations against configured incident bindings.
   - Persists method, rationale, distance, and the exact incident AOI geometry
     and version used, so later AOI edits never rewrite relevance history.

6. **Assertion extractor**
   - Produces typed atomic claims from normalized observations.
   - Uses deterministic parsers for official statuses and instructions.
   - May use assistive classification for publisher content, clearly labeled as
     machine-derived.

7. **Reconciliation engine**
   - Matches assertions to existing canonical events.
   - Records support, update, contradiction, retraction, and supersession.

8. **Material-change engine**
   - Compares the new incident state with the previous committed state.
   - Emits explainable changes and an outbox record.

9. **Read-model builder**
   - Produces denormalized current-state, timeline, map-object, and
     source-health views.

10. **Public API**
   - Serves only read models and evidence-safe detail.
   - Uses cursor pagination, ETags, and cache-aware responses.

11. **Operations console**
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
The planner may batch compatible targets against one endpoint request, but it
must never merge target health, cadence, or incident bindings. Each logical
target job:

1. acquires a collection-target-specific advisory lock;
2. resolves the immutable `collection_target_revision` and creates an
   `ingestion_run` keyed by both target and revision;
3. retrieves the source with conditional headers where supported;
4. stores response metadata and a content hash;
5. exits idempotently if the payload has already been processed;
6. creates new immutable versions when content changes;
7. normalizes and validates changed payload into global observations;
8. evaluates configured incident bindings and records immutable relevance
   links with the AOI version used;
9. runs reconciliation in the same transaction where practical;
10. commits incident-state snapshots and any material changes;
11. writes notification candidates to an outbox;
12. records final health and latency for the target.

Retries must use exponential backoff with jitter. Authentication, quota, parser,
timeout, and upstream HTTP failures remain separate error classes.

## 9. Data model

All primary identifiers should be application-generated UUIDv7 values. Every
contract-backed persisted record includes `contract_version`; every table
includes `created_at`; mutable operational tables also include `updated_at`.

### 9.1 `incidents`

| Field | Purpose |
| --- | --- |
| `contract_version`, `id` | Contract provenance and stable incident identifier |
| `slug` | Public identifier, initially `plomari-2026-07-29` |
| `canonical_name`, `display_names` | Canonical and BCP-47-keyed localized names |
| `started_at`, `ended_at` | Incident lifecycle |
| `area_of_interest` | PostGIS polygon used for relevance queries |
| `area_of_interest_version` | Monotonic version captured by every relevance evaluation |
| `default_timezone` | `Europe/Athens` |
| `lifecycle` | `active`, `monitoring`, `closed`, or `archived` |

### 9.2 Source catalog and collection configuration

#### `source_providers`

Provider records identify an organization for attribution. They do not carry
claim authority: one organization may publish products with materially
different semantics.

| Field | Purpose |
| --- | --- |
| `contract_version`, `key` | Contract provenance and stable provider identity |
| `name`, `homepage_url` | Organization attribution |
| `default_license_policy` | Conservative fallback only; never authorizes an endpoint |
| `notes` | Provider-level context |

#### `source_endpoints`

| Field | Purpose |
| --- | --- |
| `contract_version`, `id`, `key` | Contract provenance and stable product/account identity |
| `provider_key`, `name`, `data_url` | Provider relationship and endpoint identity |
| `endpoint_kind` | Feed, account, dataset, station, page, model, or imagery |
| `source_kind` | Official alert, official status, sensor, model, broadcaster, publisher |
| `authority_scopes` | Claim types for which this endpoint is authoritative |
| `content_policy`, `license_policy` | Endpoint-specific storage, reuse, and display constraints |
| `adapter_name`, `adapter_version` | Parser provenance |
| `credential_ref` | Secret-manager or environment reference, never a credential value |

#### `collection_targets`

| Field | Purpose |
| --- | --- |
| `contract_version`, `id`, `key` | Contract provenance and stable collection identity |
| `endpoint_id`, `target_kind` | Endpoint and global/area/point/station/account/feed/dataset scope |
| `request_config`, `geometry`, `geometry_precision_m` | Query parameters and spatial scope |
| `expected_cadence_seconds` | Used for freshness |
| `stale_after_seconds` | Explicit stale threshold |
| `enabled_by_default` | Operational default for this target |

#### `collection_target_revisions`

Collection targets are stable identities; every operational configuration is
an immutable revision. Editing coordinates, query parameters, endpoint,
cadence, or enablement creates a new revision rather than changing history.

| Field | Purpose |
| --- | --- |
| `contract_version`, `identity_algorithm_version`, `id` | Contract and hash provenance |
| `collection_target_id`, `endpoint_id` | Stable target and endpoint used |
| `version_number`, `supersedes_id` | Immutable revision chain |
| `target_kind`, `request_config`, `geometry`, `geometry_precision_m` | Exact request and spatial configuration |
| `expected_cadence_seconds`, `stale_after_seconds`, `enabled` | Exact operational policy |
| `configuration_hash`, `created_at` | Canonical v2 hash and creation time |

#### `incident_source_bindings`

| Field | Purpose |
| --- | --- |
| `contract_version`, `id` | Contract provenance and stable binding identity |
| `incident_id`, `collection_target_id` | Incident-to-target relationship |
| `purpose`, `priority` | Primary, context, or fallback collection ordering |
| `relevance_method`, `relevance_config` | Versioned geometry, keyword, identifier, or analyst policy |
| `enabled` | Incident-specific operational control |

### 9.3 `ingestion_runs`

| Field | Purpose |
| --- | --- |
| `contract_version`, `id`, `collection_target_id`, `collection_target_revision_id` | Attempt identity and exact target configuration |
| `started_at`, `finished_at` | Collection timing |
| `status` | `running`, `success`, `not_modified`, `partial`, `failed` |
| `http_status`, `latency_ms` | Upstream health |
| `payload_hash`, `raw_object_key` | Audit linkage |
| `item_count` | Parsed item count |
| `error_class`, `error_detail_safe` | Non-secret diagnostics |
| `collector_version` | Reproducibility |

### 9.3a `http_exchanges`

One run may issue several HTTP requests because of products, pagination,
conditional retries, or bounded fan-out. The per-request ledger is therefore
the durable source for `ingestion_runs.request_count`.

| Field | Purpose |
| --- | --- |
| `contract_version`, `id`, `run_id`, `request_no` | Stable occurrence identity and ordering inside one run |
| `source_id`, `endpoint_id`, `idempotency_key` | Endpoint-bound provenance and replay protection |
| `request_method`, `request_url_redacted` | Method plus catalog-bound HTTPS origin/path, without query, fragment, or credentials |
| `request_query_safe`, `request_headers_safe`, `request_metadata_safe` | Separate flat, positive-key-allowlisted, credential-free request envelope |
| `request_fingerprint_sha256`, `request_body_blob_id`, `request_body_sha256` | Reconstructible credential-redacted application body and request identity |
| `started_at`, `completed_at`, `latency_ms` | Database-owned request timing |
| `outcome` | `pending`, `response`, `transport_error`, or reclaim-only `indeterminate` |
| `http_status`, `response_headers_safe`, `result_metadata_safe` | Status and flat, positive-key-allowlisted, credential-free result diagnostics |
| `response_raw_object_id` | Exact application-visible response body, including an explicit zero-byte object |
| `error_class`, `error_detail_safe` | Bounded, non-secret transport diagnostics |

The issuance row commits before network I/O. Request identity is immutable;
only a lease-fenced database function may terminalize it once. The safe URL is
bound to the catalog endpoint, and query, header, and metadata maps accept only
known non-secret keys. Authorization, cookies, `x-auth-token`, signed URL/query
material, `Location`, and `set-cookie` are outside the evidence envelope.

Exact request and response bodies use one of two representations:

- `inline_bytes` stores the bytes in PostgreSQL, where constraints verify the
  byte count and SHA-256 digest;
- `storage_object` stores them at a digest-derived path. PostgreSQL enforces the
  content address, while the trusted collector verifies the object bytes and
  byte count on write and read.

`inline_payload` is a third representation for normalized semantic JSON. Its
digest is database-verified over PostgreSQL's canonical `jsonb::text` bytes,
not over the upstream serialization, so it cannot satisfy an exact request-body
or raw-response link. An empty response is still represented by an exact
zero-byte content blob and raw object rather than by `null` or a fabricated
payload.

Each raw response occurrence links to exactly one issued exchange, and that
exchange can select only its own raw object as the terminal response. A source
revision may cite a raw object only after the linked exchange has terminalized
as `response`; pending, transport-error, and indeterminate exchanges cannot be
parsed into revisions. Every followed redirect is a separate issued exchange.
A transport error has no fabricated status or body. Lease reclaim marks an
unfinished request indeterminate before closing its run.

### 9.4 `source_items`

| Field | Purpose |
| --- | --- |
| `contract_version`, `identity_algorithm_version`, `id` | Version and hash provenance |
| `source_endpoint_id`, `ingestion_run_id` | Registered endpoint and target-run provenance |
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
| `contract_version`, `id`, `source_item_id` | Global provenance; no incident ownership |
| `observation_type` | Thermal detection, satellite pass, official status, article, wind model, METAR, etc. |
| `observed_at`, `effective_at` | Event time |
| `geometry` | PostGIS point, line, or polygon where supplied |
| `geometry_precision_m` | Spatial uncertainty |
| `measurements` | Typed JSONB values and units |
| `quality` | Source-provided quality, such as FIRMS confidence |
| `parser_version` | Reproducibility |
| `validation_state` | `accepted`, `quarantined`, or `rejected` |

### 9.5a `incident_observation_links`

An observation may be relevant to zero, one, or many incidents. Linking never
copies or mutates the global observation.

| Field | Purpose |
| --- | --- |
| `contract_version`, `id`, `incident_id`, `observation_id` | Immutable relevance identity |
| `relevance_method`, `rationale_code` | Exact identifier, geometry, keyword, or analyst rationale |
| `incident_area_version`, `incident_area_of_interest` | Exact AOI snapshot evaluated at link time |
| `distance_to_area_km` | Deterministic spatial result when applicable |
| `linked_at`, `linked_by` | Evaluation time and ruleset version |

### 9.6 `assertions`

Assertions are atomic and machine-readable.

| Field | Purpose |
| --- | --- |
| `contract_version`, `id`, `observation_id`, `incident_id` | Provenance |
| `subject_type`, `subject_key` | Incident, road, settlement, sector, source, etc. |
| `predicate` | `status`, `instruction`, `threatens`, `closed`, `contains_thermal_anomaly`, etc. |
| `value` | Typed JSONB object |
| `assertion_type` | Observation, report, model, instruction, or interpretation |
| `authority_scope` | Relevant authority category |
| `effective_at`, `expires_at` | Validity |
| `extraction_method` | Deterministic parser, source field, analyst, or assistive classifier |
| `extraction_version` | Rule or model version |
| `state` | `active`, `superseded`, `retracted`, or `disputed` |
| `recorded_at` | Assertion creation time; must exist before an evaluation can authorize it |

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
| `contract_version`, `identity_algorithm_version`, `id` | Contract, hash provenance, and identity |
| `incident_id`, `sequence` | Ordered state |
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

Each canonical sample is keyed by `collection_target_id` and
`collection_target_revision_id`, not provider or incident, and retains target
status over time without treating it as incident evidence:

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
4. source endpoint ID plus normalized timestamp plus payload hash.

Every persisted identity key begins with `identity_algorithm_version`. Identity
algorithm `2.0.0` uses deterministic ECMAScript code-unit ordering. Algorithm
`1.0.0` hashes are read-only and are never recomputed; a version change creates
an explicit `identity_rebaseline` source revision even when source content is
otherwise unchanged.

FIRMS detection natural key:

`identity_version + product + satellite + observed_at + rounded_lat + rounded_lon + scan + track`

Missing FIRMS scan or track values remain `null` and contribute an explicit
`null` token to identity. They are never synthesized. Canonical JSON and URL
parameters sort by ECMAScript code-unit order, not process locale, before
hashing.

Satellite pass identity:

`identity_version + product + satellite + pass_start`, where detections no more
than ten minutes apart belong to the same detecting pass. Equal timestamps use
natural-key code-unit tie-breakers, never input order.

Source revisions:

- same external ID and same content hash: no new version;
- same external ID and changed content hash: new version with `supersedes_id`;
- changed identity-algorithm major: new `identity_rebaseline` version while the
  prior hash remains immutable;
- deleted upstream item: retain evidence and mark availability separately;
- source correction: create a new observation and supersede affected
  assertions.

Canonical events are not deduplicated by headline similarity alone. Reconciliation
uses event type, source identity, time, geography, entities, and assertion
values. An official instruction is never merged into a publisher report.

## 11. Reconciliation rules

### 11.1 Official protective instructions

- Create only after validating the complete endpoint → endpoint-bound source
  item → global observation → incident-observation link → assertion ID chain.
- Require an accepted protective-instruction observation, claim-specific
  official-alert endpoint authority, an active deterministic/source-field
  assertion, and an assertion that was already recorded, is effective, and is
  unexpired at evaluation. Evidence, relevance links, and assertions created
  after the evaluation time cannot authorize a retrospective action.
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

Initial Plomari collection-target policies:

| Endpoint/product | Target cadence | Stale threshold | Notes |
| --- | --- | --- | --- |
| Official 112 account, when configured | Scheduled worker or webhook only | 3 minutes | Optional API must not be the only alert path |
| Fire Service board | 5 minutes | 5 minutes collector / source age shown separately | Board may publish less frequently |
| Official and publisher feeds | 5 minutes | 5 minutes collector | Publication age remains separate |
| FIRMS | 5 minutes | 15 minutes collector | Observation latency may be up to several hours |
| Open-Meteo | 5 minutes | 15 minutes collector | Model cycle age must be exposed |
| LGMT METAR | 5 minutes | 20 minutes collector / 90 minutes observation | Airport is not the fireground |

Future timestamps, invalid coordinates, and impossible units are quarantined
rather than silently used. An otherwise valid global observation outside one
incident's relevance window is not quarantined; it simply does not receive a
link to that incident. Date-only records retain date-only precision and never
display a fabricated exact age.

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
- Persist only catalog-bound HTTPS origins/paths and positive-key-allowlisted
  query, header, and metadata maps. Never retain authorization, cookies,
  `x-auth-token`, signed URLs/query values, redirect `Location`, or
  `set-cookie` in the API evidence envelope.
- Strip credentials before request-body retention and never claim the retained
  application exchange is a replay-ready wire message.
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
- Define JSON Schemas for incidents, providers, endpoints, collection targets,
  incident bindings, source items, global observations, relevance links,
  assertions, events, snapshots, changes, and target health.
- Add replay and idempotency tests.
- Finalize endpoint authority/licensing and target freshness registries.
- Deep-freeze exported registries and expose deeply readonly contract types.
- Complete the pre-deployment identity `2.0.0` rebaseline, preserving all stored
  `1.0.0` hashes as read-only evidence, and approve the golden JSON Schema
  digest before provisioning persistence.

**Exit criterion:** Every current upstream response can be normalized from a
fixture with deterministic results.

### Phase 1 — Persistent ingestion in shadow mode

- Provision PostgreSQL/PostGIS and raw object storage.
- Add migrations, source catalog, target registry, immutable target revisions,
  and incident bindings.
- Move collectors out of public GET handlers.
- Persist ingestion runs with their exact target-revision IDs, endpoint-bound
  source items, observations, and target health.
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
16. Link one global observation to two overlapping incidents; one observation
    and two AOI-versioned relevance links exist, with no copied evidence.
17. Omit `contractVersion` from each canonical persisted entity, or label a
    legacy `1.0.0` payload as `1.1.0`; validation fails unless the explicitly
    named compatibility adapter performs and records the upgrade.
18. Change a target request configuration; a new immutable target revision and
    configuration hash are created, while earlier runs retain their original
    target-revision references.
19. Attempt to create a protective action from a retracted, expired, or
    not-yet-recorded assertion, a mismatched endpoint/source-item ID, or a
    mismatched observation/link ID; every invalid provenance chain is rejected.
20. Reverse equal-timestamp FIRMS detections; pass membership, ordering, and
    pass identities remain byte-for-byte identical.
21. Re-evaluate a stored `1.0.0` identity under `2.0.0`; the old hash is not
    recomputed and an explicit `identity_rebaseline` revision is produced.
22. Regenerate JSON Schemas; required fields, version constants, identifier
    patterns, negative cases, runtime-refinement annotations, and the reviewed
    golden digest remain stable.

## 22. Initial implementation epics

### Epic A — Contracts, source catalog, and target registry

- shared TypeScript domain package;
- endpoint authority/licensing and target freshness configuration;
- immutable, hashed target revisions referenced by every targeted run;
- explicit legacy upgrade adapters and identity-major rebaseline policy;
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
| Initial incident scope | Plomari is the first target profile; providers, endpoints, observations, and scheduling are global and multi-incident |
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
4. which incident becomes the second profile after Plomari validates the
   multi-incident path;
5. who may adjudicate disputed events in Phase 4.
