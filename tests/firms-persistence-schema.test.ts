import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260731030554_firms_persistence_foundation.sql",
    import.meta.url,
  ),
  "utf8",
);
const rollback = readFileSync(
  new URL(
    "../supabase/rollbacks/20260731030554_firms_persistence_foundation.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("FIRMS persistence schema contract", () => {
  it("bootstraps an inert, license-gated path-secret catalog", () => {
    expect(migration).toContain("'path_secret'");
    expect(migration).toContain("'FIRMS_MAP_KEY'");
    expect(migration).toContain("license_review_required");
    expect(migration).toContain("'restricted'");
    expect(migration).toContain("'unreviewed'");
    expect(migration).toContain("'VIIRS_SNPP_NRT'");
    expect(migration).toContain("'VIIRS_NOAA20_NRT'");
    expect(migration).toContain("'VIIRS_NOAA21_NRT'");
    expect(migration).toContain("'MODIS_NRT'");
    expect(migration).not.toMatch(/insert into core\.adapter_releases/i);
  });

  it("adopts only the exact inert legacy seed bootstrap", () => {
    const adoption = migration.slice(
      migration.indexOf("One early hosted bootstrap ran seed.sql"),
      migration.indexOf(
        "Hosted migration pushes do not execute seed.sql",
      ),
    );

    expect(adoption).toContain("source.sensitivity = 'public'");
    expect(adoption).toContain("and source.is_public");
    expect(adoption).toContain("endpoint.auth_mode = 'query_secret'");
    expect(adoption).toContain("target.visibility = 'public'");
    expect(adoption).toContain("not exists (\n      select 1 from ingest.jobs");
    expect(adoption).toContain(
      "select 1 from ingest.http_exchanges as exchange",
    );
    expect(adoption).toContain("select 1 from truth.source_health as health");
    expect(adoption).toContain("sensitivity = 'restricted'");
    expect(adoption).toContain("auth_mode = 'path_secret'");
    expect(adoption).toContain("set visibility = 'restricted'");
    expect(adoption).toContain(
      "disable trigger endpoints_reject_mutation",
    );
    expect(adoption).toContain("enable trigger endpoints_reject_mutation");
    expect(adoption).toContain("candidate_trigger.tgenabled = 'O'");
    expect(adoption).toContain("from core.incident_bindings as binding");
    expect(adoption).toContain(
      "paused_reason = 'license_review_and_adapter_release_required'",
    );
    expect(adoption).not.toMatch(/delete\s+from/i);
    expect(adoption).not.toMatch(/migration\s+repair/i);
  });

  it("verifies the complete canonical bootstrap after adoption", () => {
    const assertion = migration.slice(
      migration.indexOf("do $$", migration.indexOf("on conflict (product_key)")),
      migration.indexOf("firms_area_logical_request_sha256_v1"),
    );

    expect(assertion).toContain(
      "where provider.public_id = '018f0000-0000-7000-8000-000000000001'",
    );
    expect(assertion).toContain("provider.metadata = '{}'::jsonb");
    expect(assertion).toContain(
      "endpoint_state.paused_reason =\n        'license_review_and_adapter_release_required'",
    );
    expect(assertion).toContain("target_state.cursor_state = '{}'::jsonb");
    expect(assertion).toContain("target_state.last_error is null");
    expect(assertion).toContain(
      "endpoint.license_policy = 'provider_terms_unreviewed'",
    );
    expect(assertion).toContain("endpoint.response_contract = '{");
    expect(assertion).toContain("revision.identity_version = '2.0.0'");
    expect(assertion).toContain(
      "revision.effective_at = timestamptz '2026-07-30 00:00:00+00'",
    );
    expect(assertion).toContain(
      "FIRMS bootstrap requires endpoint immutability enforcement",
    );
  });

  it("stores point detections and reported dimensions without a fabricated footprint", () => {
    const detailTable = migration.slice(
      migration.indexOf("create table ingest.firms_detection_details"),
      migration.indexOf(
        "create index firms_detection_details_product_acquired_idx",
      ),
    );

    expect(detailTable).toContain("extensions.geometry(Point, 4326)");
    expect(detailTable).toContain("source_time_precision = 'minute'");
    expect(detailTable).toContain("normalized_content_sha256");
    expect(detailTable).toContain("scan_km");
    expect(detailTable).toContain("track_km");
    expect(detailTable).toContain("modeled_support_radius_m");
    expect(detailTable).toContain("footprint_orientation_deg is null");
    expect(detailTable).not.toContain("footprint_geom");
  });

  it("binds completion to the explicit 1..5 day network request contract", () => {
    expect(migration).toContain("firms-area-request-v1");
    expect(migration.match(/day_count between 1 and 5/g)).toHaveLength(2);
    expect(migration).toContain("date_request_mode = 'explicit_starting_on'");
    expect(migration).toContain("logical_request_sha256");
    expect(migration).toContain("http_request_fingerprint_sha256");
    expect(migration).toContain("issued_at timestamptz not null");
    expect(migration).toContain("firms_issued_at_token_is_valid_v1");
    expect(migration).toContain("'issued_at', to_char(");
    expect(migration).toContain("response_raw_object_id bigint");
    expect(migration).toContain("response_content_sha256 text");
    expect(migration).toContain("response_retrieved_at timestamptz");
    expect(migration).toContain(
      "firms_query_product_results_response_raw_fkey",
    );
    expect(migration).toContain(
      "exchange.request_fingerprint_sha256 as exchange_fingerprint",
    );
    expect(migration).toContain("accepted_row_count");
    expect(migration).not.toContain("new_detection_count");
    expect(migration).not.toContain("duplicate_detection_count");
    expect(migration).toContain("'operation', 'firms-area-csv'");
    expect(migration).toContain("'scope', 'geographic-area'");
    expect(migration).toContain("^-?(0|[1-9][0-9]{0,2})\\.[0-9]{6}$");
    expect(migration).not.toMatch(/date_request_mode\s*=\s*'rolling/i);
  });

  it("normalizes every parser-accepted satellite alias without losing the raw token", () => {
    expect(migration).toContain("source_satellite_raw text not null");
    expect(migration).toContain("firms_source_satellite_code_v1");
    expect(migration).toContain(
      "source_satellite_code text generated always as",
    );
    for (const alias of [
      "N",
      "SNPP",
      "S-NPP",
      "SUOMI-NPP",
      "N20",
      "NOAA-20",
      "N21",
      "NOAA-21",
      "A",
      "AQUA",
      "T",
      "TERRA",
    ]) {
      expect(migration).toContain(`'${alias}'`);
    }
  });

  it("revalidates accepted details against the issued AOI and UTC date window", () => {
    const responseValidator = migration.slice(
      migration.indexOf("create or replace function ingest.validate_firms_response_row"),
      migration.indexOf(
        "revoke execute on function ingest.validate_firms_response_row",
      ),
    );

    expect(responseValidator).toContain(
      "ingest.firms_detection_is_within_request_v1",
    );
    expect(responseValidator).toContain("detail.latitude as detail_latitude");
    expect(responseValidator).toContain("detail.acquired_date as detail_acquired_date");
  });

  it("makes a negative assessment structurally impossible", () => {
    const assessmentTable = migration.slice(
      migration.indexOf("create table truth.thermal_anomaly_assessments"),
      migration.indexOf(
        "create index thermal_anomaly_assessments_detection_as_of_idx",
      ),
    );

    expect(assessmentTable).toContain(
      "'detected', 'awaiting_later_assessment', 'unknown'",
    );
    expect(assessmentTable).not.toContain("no_anomaly_returned");
    expect(assessmentTable).not.toContain("resolved");
    expect(assessmentTable).toContain(
      "notification_eligible boolean generated always as (false)",
    );
    expect(assessmentTable).toContain(
      "incident_resolution_eligible boolean generated always as (false)",
    );
    expect(assessmentTable).toContain(
      "reason_code = 'cmr_coverage_only_anomaly_not_assessed'",
    );
    expect(assessmentTable).toContain("cmr_observation_cursor is not null");
    expect(assessmentTable).toContain("failed_product_result_id is not null");
    expect(assessmentTable).toContain(
      "firms_completion_health_cursor is not null",
    );
    expect(migration).toContain("sensor_assessability = 'unknown'");
    expect(migration).toContain(
      "negative_assessment_eligible boolean generated always as (false)",
    );
  });

  it("keeps all new evidence private, forced-RLS, and append-only", () => {
    for (const table of [
      "core.firms_products",
      "ingest.firms_detection_details",
      "ingest.firms_response_rows",
      "ingest.firms_query_product_results",
      "ingest.firms_query_completions",
      "truth.thermal_anomaly_assessments",
    ]) {
      expect(migration).toContain(
        `alter table ${table} enable row level security;`,
      );
      expect(migration).toContain(
        `alter table ${table} force row level security;`,
      );
    }

    expect(migration).not.toMatch(/create (?:or replace )?view api\./i);
    expect(migration).not.toContain("raw_payload");
    expect(migration).toContain("from public, anon, authenticated, service_role");
  });

  it("ships a fail-closed rollback that never deletes evidence", () => {
    expect(rollback).toContain(
      "refusing FIRMS rollback: immutable runtime or evidence rows exist",
    );
    expect(rollback).toContain(
      "refusing FIRMS rollback: deployed adapter or successor target revision exists",
    );
    expect(rollback).not.toMatch(
      /delete from (?:ingest|truth)\.(?:firms|thermal_anomaly)/i,
    );
    expect(rollback).toContain("Keep path_secret in the endpoint auth allowlist");
  });
});
