import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260801010500_bound_discovery_reader_statement_timeout.sql",
    import.meta.url,
  ),
  "utf8",
);
const rollback = readFileSync(
  new URL(
    "../supabase/rollbacks/20260801010500_bound_discovery_reader_statement_timeout.sql",
    import.meta.url,
  ),
  "utf8",
);
const continuousIntegration = readFileSync(
  new URL("../.github/workflows/ci.yml", import.meta.url),
  "utf8",
);

describe("discovery reader transaction timeout", () => {
  it("sets the role boundary before RPC execution and clears weaker function settings", () => {
    expect(migration).toContain(
      "alter role firewatch_discovery_reader\n  set statement_timeout = '4s'",
    );
    expect(migration).toMatch(
      /alter function api\.nearby_incidents_v3\([\s\S]*?\) reset statement_timeout;/u,
    );
    expect(migration).not.toMatch(
      /alter function api\.thermal_anomalies_v3\([\s\S]*?set statement_timeout/u,
    );
    expect(migration).toContain("notify pgrst, 'reload config'");
    expect(migration).toContain("notify pgrst, 'reload schema'");
  });

  it("restores the prior role and Nearby function settings without touching evidence", () => {
    expect(rollback).toContain(
      "alter role firewatch_discovery_reader\n  reset statement_timeout",
    );
    expect(rollback).toMatch(
      /alter function api\.nearby_incidents_v3\([\s\S]*?\) set statement_timeout = '5s';/u,
    );
    expect(rollback).not.toMatch(/\b(?:delete|drop|truncate)\b/u);
    expect(rollback).toContain("notify pgrst, 'reload config'");
    expect(rollback).toContain("notify pgrst, 'reload schema'");
  });

  it("starts PostgREST before executing the real HTTP timeout probe in CI", () => {
    expect(continuousIntegration).toContain("- run: supabase start");
    expect(continuousIntegration).not.toContain("- run: supabase db start");
    expect(continuousIntegration.indexOf("- run: supabase start")).toBeLessThan(
      continuousIntegration.indexOf("- run: npm run test:discovery-timeout"),
    );
  });
});
