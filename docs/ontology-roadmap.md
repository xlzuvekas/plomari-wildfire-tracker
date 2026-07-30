# Operational Ontology and Graph Roadmap

**Decision:** keep Supabase/Postgres/PostGIS authoritative; design an
ontology-compatible, rebuildable projection before considering a second
database.
**Updated:** 30 July 2026

## What “ontology” means here

A graph database stores and traverses nodes and edges. An operational ontology
also defines governed object/property/link semantics, backing-data mappings,
interfaces, allowed actions, executable functions, security, lineage,
lifecycle metadata, and branch/review workflows. Palantir describes its
Ontology as both the semantic and kinetic layer of an organization—not merely
a graph representation. See Palantir's [Ontology overview](https://www.palantir.com/docs/foundry/ontology/overview),
[ontology resource overview](https://www.palantir.com/docs/foundry/ontologies/ontologies-overview),
and [Ontology SDK overview](https://www.palantir.com/docs/foundry/ontology-sdk/overview).

Firewatch already has the important separation: immutable evidence and
provenance, explicit association objects, deterministic actions, curated read
models, and capability-scoped writers. Preserve that rather than dual-writing
into a new graph.

## Object and link mapping

| Firewatch records | Future object types |
| --- | --- |
| providers, sources, endpoints, adapter releases | `Provider`, `SourceProduct`, `SourceEndpoint`, `AdapterRelease` |
| incidents and AOI versions | `Incident`, `AreaOfInterestVersion` |
| targets, target revisions, incident bindings | `CollectionTarget`, `CollectionTargetRevision`, `IncidentCollectionBinding` |
| jobs, runs, raw objects, source revisions | `CollectionJob`, `CollectionRun`, `RawAcquisition`, `SourceRecordRevision` |
| global observations | `Observation` |
| incident relevance | `IncidentObservationAssessment` |
| assertions, evidence, events | `Assertion`, `EvidenceAssociation`, `IncidentEvent` |
| snapshots and material changes | `IncidentSnapshot`, `MaterialChange` |
| publications and outbox | `PublicationDecision`, `DeliveryMessage` |
| source health | `SourceHealthSample` |

`IncidentObservationAssessment`, `EvidenceAssociation`, and
`IncidentCollectionBinding` remain first-class association objects because
they carry method, AOI version, score, distance, authority, rationale, actor,
and time. They must not become metadata-free edges.

Palantir link types are bidirectional and support one-to-one, one-to-many, and
many-to-many backing models. One Firewatch relationship therefore maps to one
link type with independently named traversal sides, not duplicated reverse
relations. See [link types](https://www.palantir.com/docs/foundry/object-link-types/link-types-overview)
and [link metadata/cardinality](https://www.palantir.com/docs/foundry/object-link-types/link-type-metadata).

## Low-regret conventions now

- Keep `public_id` as the stable, non-sensitive external identity; internal
  bigint IDs/cursors remain storage and pagination details.
- Never use a coordinate, timestamp, localized label, or random build row
  number as semantic identity. Palantir likewise recommends deterministic
  object keys and warns that changing keys loses edits and links. See
  [object-type creation and keys](https://www.palantir.com/docs/foundry/object-link-types/create-object-type/index.html).
- Use stable, non-localized API names; presentation labels and translations are
  separate metadata.
- Retain `contractVersion`, identity/parser/calculator versions, idempotency
  keys, content hashes, source record keys, and explicit supersession links.
- Keep observed, effective, published, retrieved, ingested, recorded, checked,
  and reviewed clocks separate, with precision and timezone metadata.
- Preserve WGS84 geometry plus spatial precision, but project geometry into
  graph properties rather than using it as a primary key.
- Use controlled semantic codes for lifecycle, trust, validation, evidence,
  precision, sensitivity, and publication state. Deprecate rather than silently
  repurpose codes or API names.
- Version the future mapping independently as `ontologyMappingVersion`.

Useful future read interfaces are `PubliclyIdentified`, `VersionedArtifact`,
`SpatiotemporalRecord`, `ProvenancedArtifact`, `IncidentScoped`, and
`OperationalStatusSample`. Palantir interfaces are abstract shapes/capabilities
rather than concrete objects; support varies by product, so publication safety
must not depend on them. See [interfaces](https://www.palantir.com/docs/foundry/interfaces/interface-overview).

## Actions and functions

Model commands, not generic CRUD:

- approve a provider/source/adapter;
- append or enable a collection-target revision;
- open an incident or append an AOI version;
- record relevance or an assertion;
- publish/retract an evidence-backed update; and
- retry/acknowledge a fenced delivery.

Each command carries actor, reason, idempotency key, expected prior version,
and submission time. Raw acquisitions, observations, evidence, and historical
decisions have no edit/delete action. Palantir actions similarly apply governed
rules and submission criteria, while function-backed actions express complex
object/link edits. See [action rules](https://www.palantir.com/docs/foundry/action-types/rules),
[submission criteria](https://www.palantir.com/docs/foundry/action-types/submission-criteria),
and [function-backed actions](https://www.palantir.com/docs/foundry/action-types/function-actions-overview).

Good read-only functions include `nearbyObservations`,
`currentIncidentTruth`, `explainEventProvenance`, `sourceCoverage`, and
`currentOfficialStatus`. Functions may traverse/aggregate projections; they do
not duplicate authoritative reconciliation logic. Palantir's [functions](https://www.palantir.com/docs/foundry/functions/overview)
similarly read properties, traverse links, and can be placed behind actions for
edits.

## Security, lineage, and branching

Mirror the existing catalog-admin, collector, reconciler, publisher, and
dispatcher split. Keep credentials, personal location, licensed raw bodies,
and secrets out of object properties. `public_id` must be safe because primary
keys cannot be treated like an ordinary protected presentation property.
Palantir separates ontology-resource permissions from object/property data
security; see [ontology permissions](https://www.palantir.com/docs/foundry/object-permissioning/ontology-permissions)
and [object/property security](https://www.palantir.com/docs/foundry/object-permissioning/managing-object-security).

Platform lineage does not replace evidentiary provenance. Preserve the explicit
record chain from provider through raw acquisition, observation, relevance,
event, snapshot, publication, and delivery. Palantir's [lineage graph](https://www.palantir.com/docs/foundry/data-lineage/elements-reference)
can expose datasets and object types, but Firewatch must still explain each
public claim at record level.

Develop mapping changes like database contracts: branch from `main`, preview
against shadow data, rebase, review, and merge. Protect object, link, interface,
shared-property, and especially action resources. Palantir documents this
proposal workflow in [branching the ontology](https://www.palantir.com/docs/foundry/ontologies/branching-ontology).

## When to add a graph projection

Prototype a one-way, rebuildable projection only when at least two signals
persist across two releases:

- 20% or more of interactive queries require three-plus relationship
  traversals and remain above 500 ms P95 after indexed SQL/read-model tuning;
- analysts repeatedly need cross-incident pathfinding/entity resolution across
  five or more object types;
- three or more applications duplicate the same object/link/action semantics;
- provenance/impact analysis regularly crosses ten or more entity types; or
- representative benchmarks show at least 2× latency improvement or a material
  reduction in application complexity.

Any projection—whether Graphiti or another candidate—must consume Postgres
outbox/CDC one way, be idempotent, checkpointed, mapping-versioned,
retraction/tombstone-aware, and fully rebuildable. PostGIS remains authoritative
for spatial filtering. No graph system receives application dual writes.
