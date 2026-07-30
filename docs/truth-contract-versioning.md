# Truth contract versioning

The truth layer uses explicit semantic versions. Version 1 is exported from
`lib/truth/v1`, and every generated JSON Schema has a stable `$id` containing
the contract version.

## Compatibility policy

- **Patch** changes may clarify descriptions, add validation that only rejects
  values already outside the documented contract, or add optional fields.
- **Minor** changes may add enum members, new event variants, or new optional
  fields. Consumers must preserve unknown evidence and must not silently
  reinterpret a new enum member.
- **Major** changes are required when a field is removed, renamed, made
  required, changes meaning or units, or when identity/canonicalization changes.
- Persisted evidence records retain the contract, adapter, parser, collector,
  reconciliation, and ruleset versions that produced them.
- Readers may support multiple major versions during migration. Writers emit
  exactly one configured major version.
- A major-version migration creates new normalized records or read models; it
  never mutates immutable source evidence in place.

## Runtime validation boundary

Zod schemas are the TypeScript source of truth. The corresponding Draft
2020-12 JSON Schemas are exported through `TRUTH_JSON_SCHEMAS`. Canonical
objects use strict schemas, so undocumented fields fail validation instead of
being silently discarded.

Structural rejection and semantic quarantine are intentionally different:

- malformed envelopes and impossible types are rejected;
- structurally valid but unsafe values, such as future timestamps or invalid
  authority claims, are retained as quarantined evidence;
- only accepted observations may reach reconciliation, read models, maps, or
  notification evaluation.

## Identity policy

Source identity uses, in order:

1. a stable source-provided identifier;
2. a normalized canonical URL;
3. a sensor-specific natural key;
4. source key, normalized time, and canonical payload hash.

Canonical JSON sorts object keys and rejects non-finite numbers before hashing.
FIRMS identity rounds latitude and longitude to four decimal places while
retaining the original coordinates in evidence. A FIRMS detecting pass groups
consecutive detections from the same product and satellite when their gap is no
more than ten minutes.

Record UUIDv7 values remain separate from semantic keys. Idempotency is based
on the semantic key and content hash, not on regenerating the same UUID.

## Fixture policy

The sanitized fixture corpus covers every registered source and adapter family.
It contains no credentials, authorization headers, user location, or full
publisher article bodies. Every source has at least one success fixture and one
failure fixture, while the corpus also covers:

- successful zero results;
- source corrections;
- malformed and future timestamps;
- partial parse failure;
- timeout;
- authentication failure;
- quota exhaustion;
- malformed payloads;
- publisher evacuation wording that must never become an official protective
  action.

Contract tests replay identical FIRMS input 100 times, verify correction
versioning, enforce claim-specific protective-action authority, and keep source
health independent from incident status.
