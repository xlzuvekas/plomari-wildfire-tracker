import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    __dirname,
    "..",
    "supabase",
    "migrations",
    "20260731190000_open_meteo_air_quality_bootstrap.sql",
  ),
  "utf8",
);

describe("open-meteo air-quality bootstrap migration", () => {
  it("registers the source and endpoint fully disabled", () => {
    expect(migration).toContain("'open-meteo-air-quality'");
    expect(migration).toContain("insert into ingest.endpoint_state");
    expect(migration).toMatch(/select endpoint\.id, false/u);
    expect(migration).not.toMatch(/enabled\s*=\s*true/iu);
    expect(migration).not.toMatch(/cron\.schedule/u);
  });

  it("labels the product modeled and preserves pollutant fields", () => {
    expect(migration).toContain("'modeled'");
    expect(migration).toContain("'modeled_air_quality'");
    expect(migration).toContain('"basis":"modeled"');
    expect(migration).toContain('"pollutantFields"');
    expect(migration).toContain('"providerIndexFields"');
    expect(migration).toMatch(/never an on-site measurement/iu);
  });

  it("keeps the license unreviewed and blocks adapter or target creation", () => {
    expect(migration).toContain("'unreviewed'");
    expect(migration).toContain(
      "air-quality bootstrap must not create collection targets",
    );
    expect(migration).toContain(
      "air-quality bootstrap must not create or adopt an adapter release",
    );
  });

  it("pins UTC semantics into the endpoint contract", () => {
    expect(migration).toContain('"timezone":"UTC"');
    expect(migration).toContain('"requiredUtcOffsetSeconds":0');
  });
});
