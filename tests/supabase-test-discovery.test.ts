import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const databaseTestsDirectory = new URL(
  "../supabase/tests/database/",
  import.meta.url,
);

describe("Supabase pgTAP discovery", () => {
  it("keeps database tests on the CLI-discoverable .test.sql convention", () => {
    const filenames = readdirSync(databaseTestsDirectory).sort();
    const discoverable = filenames.filter((name) => name.endsWith(".test.sql"));
    const legacyUndiscoverable = filenames.filter((name) =>
      name.endsWith("_test.sql"),
    );

    expect(discoverable).toEqual([
      "cmr_catalog_projection.test.sql",
      "cmr_collector_runtime.test.sql",
      "discovery_reader_timeout.test.sql",
      "firms_persistence_foundation.test.sql",
      "firms_shadow_collector_runtime.test.sql",
      "global_candidate_projection.test.sql",
      "http_exchanges.test.sql",
      "initial_truth_foundation.test.sql",
      "thermal_anomaly_v3_projection.test.sql",
      "v3_nearby_incident_projection.test.sql",
      "viirs_firemask_assessability_foundation.test.sql",
    ]);
    expect(legacyUndiscoverable).toEqual([]);
  });
});
