# Production foundation rollout — 30 July 2026

> **Point-in-time record.** This documents the state at the 30 July 2026
> rollout. Later work (the HTTP evidence ledger, the persisted CMR catalog
> projection and collector, and production CMR activation) has since added
> migrations, `api` views, and catalog sources beyond the counts below; the
> repository's `supabase/migrations` directory and seed are authoritative for
> the current state.

Supabase project `cggrrimijkmmzpwhodqt` received the reviewed, inert truth-layer
foundation. This record contains no credentials or application row data.

## Applied migrations

| Version | Name |
| --- | --- |
| `20260730132113` | `initial_truth_foundation` |
| `20260730132257` | `expose_curated_api_schema` |
| `20260730132639` | `cover_foreign_keys_and_remove_duplicate_index` |
| `20260730133137` | `trim_redundant_fk_indexes` |

The foundation migration was applied from SHA-256
`4c0afc76545e06811023370b8e7c0bfe9793fa49fef2551a6ff48e930f444d76`.
The disabled catalog bootstrap was executed once, transactionally, from
`supabase/seed.sql` at SHA-256
`3de92a5ff11d89b5e963656b3571be541438f67063b17ec2c81f97fdeeaa7d68`.

## Verified postconditions

- PostgreSQL 17.6 with PostGIS installed in `extensions`.
- 27 of 27 application tables have RLS enabled and forced.
- Seven of seven `api` views use invoker security.
- Hosted PostgREST exposes only `api`.
- Five capability roles exist with no login, superuser, role-creation,
  database-creation, replication, or RLS-bypass privilege.
- `raw-evidence` exists as a private Storage bucket.
- Catalog counts: 10 providers, 14 sources, 14 endpoints, 14 targets, and 14
  target revisions.
- Enabled/reviewed counts are all zero; no incident, observation, evidence, or
  truth rows were seeded.
- Anonymous projection smoke test returns 14 catalog and 14 unconfigured
  source-health rows, with every incident projection empty.
- Supabase security advisors: zero findings.
- Four genuinely missing foreign-key leading-column paths were retained. The
  exact-tuple advisor still reports informational findings where an existing
  selective leading-column index already covers the parent-check access path;
  duplicating those indexes would add write amplification. Unused-index notices
  are expected before shadow traffic and are retained until workload evidence
  exists.

## Migration timestamp coordination

The canonical foundation filename changed from local-only version
`20260730102113` to the production-recorded version `20260730132113`; the SQL
bytes and SHA-256 are identical. Developers must reset disposable local Supabase
databases after pulling this change. Any persistent Supabase development branch
that recorded the old version must be inventoried and deliberately recreated or
have its migration history repaired before receiving later migrations. Do not
restore both timestamped files to the canonical migration directory.

## Cutover state

This rollout does not switch the public map to the new database. Existing v2
request-time routes remain authoritative while server-side v3 reads, collectors,
reconciliation, and temporal replay are developed and observed in shadow mode.
The first bounded read is `GET /api/v3/shadow/sources`; it uses only the
publishable key, reports global target health honestly, and is not consumed by
the public UI.
