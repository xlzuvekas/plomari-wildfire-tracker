import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260801073832_v3_global_explore_candidate_cells.sql",
    import.meta.url,
  ),
  "utf8",
);
const rollback = readFileSync(
  new URL(
    "../supabase/rollbacks/20260801073832_v3_global_explore_candidate_cells.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("inert v3 global candidate projection schema", () => {
  it("keeps identity independent from detections and physically indexes the public keyset", () => {
    expect(migration).toContain("public_id core.uuid_v7 not null unique");
    expect(migration).toContain("semantic_key_sha256 text generated always as");
    expect(migration).toMatch(
      /global_candidate_projection_items_page_idx[\s\S]*?snapshot_id,[\s\S]*?item_known_at desc,[\s\S]*?candidate_public_id desc/u,
    );
    expect(migration).not.toMatch(
      /from\s+(?:ingest\.firms_detection_details|truth\.thermal_anomaly_assessments)/u,
    );
  });

  it("publishes only immutable forced-RLS snapshots without enabling a writer", () => {
    for (const table of [
      "global_candidate_cells",
      "global_candidate_projection_runs",
      "global_candidate_projection_items",
    ]) {
      expect(migration).toContain(
        `alter table truth.${table} force row level security;`,
      );
    }
    expect(migration).toContain("execute function core.reject_mutation()");
    expect(migration).not.toMatch(
      /grant\s+(?:insert|update|delete|all)\s+on\s+truth\.global_candidate/iu,
    );
    expect(migration).not.toMatch(/create\s+trigger[^;]*materializ/iu);
  });

  it("exposes only the bounded, snapshot-bound reader RPC", () => {
    expect(migration).toContain(
      "create or replace function api.explore_candidate_cells_v3(",
    );
    expect(migration).toContain("p_observed_from <> p_as_of - interval '7 days'");
    expect(migration).toContain("limit p_limit");
    expect(migration).toContain("firewatch_snapshot_changed_v1");
    expect(migration).toMatch(
      /revoke execute on function api\.explore_candidate_cells_v3\([\s\S]*?anon, authenticated, service_role, firewatch_discovery_reader;/u,
    );
    expect(migration).toMatch(
      /grant execute on function api\.explore_candidate_cells_v3\([\s\S]*?to firewatch_discovery_reader;/u,
    );
  });

  it("ships an exact reverse-order rollback", () => {
    expect(rollback).toContain(
      "drop function if exists api.explore_candidate_cells_v3(",
    );
    expect(rollback).toContain(
      "drop table if exists truth.global_candidate_projection_items;",
    );
    expect(rollback).toContain(
      "drop table if exists truth.global_candidate_projection_runs;",
    );
    expect(rollback).toContain(
      "drop table if exists truth.global_candidate_cells;",
    );
  });
});
