import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseMeteoalarm,
  summarizeAlerts,
} from "../app/api/alerts/meteoalarm";

const fixture = readFileSync(
  join(__dirname, "fixtures", "meteoalarm-spain.xml"),
  "utf8",
);

// The fixture entries expire 2026-07-31; evaluate "now" inside their window.
const NOW = Date.parse("2026-07-30T12:00:00Z");

const forestFireEntry = `
<entry>
  <cap:areaDesc>Test zone</cap:areaDesc>
  <cap:event>Severe forest-fire warning</cap:event>
  <cap:expires>2026-07-31T18:59:59+00:00</cap:expires>
  <cap:severity>Severe</cap:severity>
  <cap:message_type>Alert</cap:message_type>
  <cap:status>Actual</cap:status>
</entry>`;

const expiredEntry = `
<entry>
  <cap:areaDesc>Old zone</cap:areaDesc>
  <cap:event>Extreme high-temperature warning</cap:event>
  <cap:expires>2026-07-29T00:00:00+00:00</cap:expires>
  <cap:severity>Extreme</cap:severity>
  <cap:message_type>Alert</cap:message_type>
  <cap:status>Actual</cap:status>
</entry>`;

describe("parseMeteoalarm", () => {
  it("parses live-feed heat warnings with severity and area", () => {
    const entries = parseMeteoalarm(fixture, NOW);
    expect(entries).toHaveLength(2);
    expect(entries.every((entry) => entry.kind === "heat")).toBe(true);
    expect(entries.map((entry) => entry.severity).sort()).toEqual([
      "Moderate",
      "Severe",
    ]);
    expect(entries[0]?.areaDesc.length).toBeGreaterThan(0);
  });

  it("classifies forest-fire events and drops expired entries", () => {
    const entries = parseMeteoalarm(
      fixture.replace("</feed>", `${forestFireEntry}${expiredEntry}</feed>`),
      NOW,
    );
    expect(entries).toHaveLength(3);
    expect(entries.filter((entry) => entry.kind === "forest-fire")).toHaveLength(
      1,
    );
  });
});

describe("summarizeAlerts", () => {
  it("buckets counts and max severity per kind", () => {
    const entries = parseMeteoalarm(
      fixture.replace("</feed>", `${forestFireEntry}</feed>`),
      NOW,
    );
    const summary = summarizeAlerts(entries);
    expect(summary.total).toBe(3);
    expect(summary.heat).toEqual({ count: 2, maxSeverity: "Severe" });
    expect(summary.forestFire).toEqual({ count: 1, maxSeverity: "Severe" });
  });
});
