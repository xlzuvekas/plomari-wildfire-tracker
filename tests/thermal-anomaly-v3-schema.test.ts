import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260731150520_thermal_anomaly_v3_projection.sql",
    import.meta.url,
  ),
  "utf8",
);
const rollback = readFileSync(
  new URL(
    "../supabase/rollbacks/20260731150520_thermal_anomaly_v3_projection.sql",
    import.meta.url,
  ),
  "utf8",
);
const postgrest = readFileSync(
  new URL("../lib/supabase/postgrest.ts", import.meta.url),
  "utf8",
);

describe("v3 thermal anomaly database projection", () => {
  it("is a bounded forced-RLS traversal exposed only to the server reader", () => {
    expect(migration).toContain(
      "create or replace function api.thermal_anomalies_v3",
    );
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain("set statement_timeout = '5s'");
    expect(migration).toContain("from ingest.firms_detection_details as detail");
    expect(migration).toContain("truth.thermal_anomaly_assessments");
    expect(migration).toContain("operator(extensions.&&)");
    expect(migration).toContain("extensions.st_intersects");
    expect(migration).not.toMatch(/execute\s+format/u);
  });

  it("enforces canonical cell, two cutoffs, fixed history, and row bounds", () => {
    expect(migration).toContain("p_z < 7 or p_z > 11");
    expect(migration).toContain("between 8 and 80 kilometres");
    expect(migration).toContain("p_as_of > p_known_at");
    expect(migration).toContain("interval '31 days'");
    expect(migration).toContain("p_as_of - interval '7 days'");
    expect(migration).toContain("p_limit > 101");
    expect(migration).toContain("detail.retrieved_at <= p_known_at");
    expect(migration).toContain("candidate.as_of <= p_as_of");
    expect(migration).toContain("candidate.known_at <= p_known_at");
    expect(migration).toContain("candidate.recorded_at <= p_known_at");
    expect(migration).toContain("candidate.version_no desc");
  });

  it("requires reviewed public gates and cannot publish negative semantics", () => {
    expect(migration).toContain("source.slug = 'nasa-firms'");
    expect(migration).toContain("source.license_status = 'approved'");
    expect(migration).toContain("source.redistribution_allowed is true");
    expect(migration).toContain("product.assessment_enabled");
    expect(migration).toContain(
      "'detected', 'awaiting_later_assessment', 'unknown'",
    );
    expect(migration).not.toMatch(
      /assessment_state[^\n]*(?:no_anomaly|resolved|all_clear)/u,
    );
    expect(migration).toContain("notification_eligible boolean");
    expect(migration).toContain("incident_resolution_eligible boolean");
  });

  it("revokes default execution, allowlists PostgREST, and rolls back narrowly", () => {
    expect(migration).toMatch(
      /revoke execute on function api\.thermal_anomalies_v3[\s\S]*?from public,[\s\S]*?service_role, firewatch_discovery_reader/u,
    );
    expect(migration).toMatch(
      /grant execute on function api\.thermal_anomalies_v3[\s\S]*?to firewatch_discovery_reader/u,
    );
    expect(postgrest).toContain('"thermal_anomalies_v3"');
    expect(rollback).toContain(
      "drop function if exists api.thermal_anomalies_v3",
    );
    expect(rollback).toContain(
      "drop index if exists truth.thermal_anomaly_assessments_projection_cutoff_idx",
    );
    expect(rollback).not.toContain("drop role");
  });
});
