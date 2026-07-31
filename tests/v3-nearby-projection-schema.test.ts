import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260731102000_v3_nearby_incident_projection.sql",
    import.meta.url,
  ),
  "utf8",
);
const rollback = readFileSync(
  new URL(
    "../supabase/rollbacks/20260731102000_v3_nearby_incident_projection.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("v3 Nearby database projection", () => {
  it("is a bounded definer read exposed only through a scoped server role", () => {
    expect(migration).toContain("create or replace function api.nearby_incidents_v3");
    expect(migration).toContain("create role firewatch_discovery_reader");
    expect(migration).toContain("grant firewatch_discovery_reader to authenticator");
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain("set statement_timeout = '5s'");
    expect(migration).toContain("from truth.snapshots as snapshot");
    expect(migration).toContain("join core.incidents as incident");
    expect(migration).toContain("from truth.events as event");
    expect(migration).not.toMatch(/execute\s+format/u);
    expect(migration).not.toMatch(/snapshot\.state|event\.payload/u);
  });

  it("enforces spatial, temporal, page, and publication cutoffs in SQL", () => {
    expect(migration).toContain("extensions.st_tileenvelope");
    expect(migration).toContain("cell_minimum_span_m");
    expect(migration).toContain("between 8 and 80 kilometres");
    expect(migration).toContain("operator(extensions.&&)");
    expect(migration).toContain("extensions.st_intersects");
    expect(migration).toContain("p_as_of > p_known_at");
    expect(migration).toContain("interval '7 days'");
    expect(migration).toContain("interval '31 days'");
    expect(migration).toContain("p_limit > 101");
    expect(migration).toContain("truth.publication_subject_is_current");
    expect(migration).toContain("pg_catalog.statement_timestamp()");
    expect(migration).toContain("truth.publication_gate_known_at");
    expect(migration).toContain("successor.version_no, successor.cursor");
    expect(migration).toContain("latest_observed_timezone");
    expect(migration).toContain("item_order_millis");
    expect(migration).not.toContain("p_after_");
  });

  it("keeps writes unavailable and provides a focused rollback", () => {
    expect(migration).toMatch(
      /revoke execute on function api\.nearby_incidents_v3[\s\S]*?from public,[\s\S]*?firewatch_collector/u,
    );
    expect(migration).toMatch(
      /grant execute on function api\.nearby_incidents_v3[\s\S]*?to firewatch_discovery_reader/u,
    );
    expect(rollback).toContain("drop function if exists api.nearby_incidents_v3");
    expect(rollback).toContain("revoke usage on schema api");
    expect(rollback).toContain("revoke firewatch_discovery_reader from authenticator");
    expect(rollback).toContain("drop role if exists firewatch_discovery_reader");
  });
});
