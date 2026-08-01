import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { metadata as layoutMetadata } from "../app/layout";
import manifest from "../app/manifest";
import { metadata as rootMetadata } from "../app/page";

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const rootSource = source("app/page.tsx");
const exploreAliasSource = source("app/explore/page.tsx");
const exploreClientSource = source("app/explore/ExplorePageClient.tsx");
const archiveRouteSource = source(
  "app/incidents/plomari-2026-07-29/page.tsx",
);
const archiveClientSource = source(
  "app/incidents/plomari-2026-07-29/PlomariIncidentClient.tsx",
);

describe("global-first product entry", () => {
  it("makes the existing Explore composition the root and keeps its alias", () => {
    expect(rootSource).toContain("<ExplorePageClient {...options} />");
    expect(exploreAliasSource).toContain("<ExplorePageClient {...options} />");
    expect(rootSource).not.toMatch(/leaflet|PlomariIncidentClient/iu);
    expect(exploreClientSource).toContain(
      'href="/incidents/plomari-2026-07-29"',
    );
    expect(exploreClientSource).toContain("Plomari · 29 Jul archive");
  });

  it("uses global product metadata and a global offline start URL", () => {
    const webManifest = manifest();

    expect(rootMetadata.title).toBe("Global Wildfire Discovery | Firewatch");
    expect(layoutMetadata.title).toBe(
      "Firewatch | Global Wildfire Intelligence",
    );
    expect(webManifest.name).toBe(
      "Firewatch | Global Wildfire Intelligence",
    );
    expect(webManifest.start_url).toBe("/");
    expect(JSON.stringify([rootMetadata, layoutMetadata, webManifest])).not.toMatch(
      /Plomari-first|Plomari Firewatch/iu,
    );
  });
});

describe("Plomari historical archive boundary", () => {
  it("uses the canonical incident slug and separates the Leaflet archive bundle", () => {
    expect(archiveRouteSource).toContain(
      'import PlomariIncidentClient from "./PlomariIncidentClient"',
    );
    expect(archiveClientSource).toContain('await import("leaflet")');
    expect(archiveClientSource).not.toMatch(/maplibre|ExploreGlobe/iu);
    expect(rootSource).not.toMatch(/leaflet|PlomariIncidentClient/iu);
  });

  it("labels the snapshot without inventing an incident resolution", () => {
    expect(archiveRouteSource).toContain(
      'title: "Plomari · 29 July 2026 Incident Archive | Firewatch"',
    );
    expect(archiveRouteSource).toContain(
      "does not assert containment, resolution, or an all-clear",
    );
    expect(archiveClientSource).toContain("FIREWATCH // PLOMARI ARCHIVE");
    expect(archiveClientSource).toContain("LATEST INCLUDED EVIDENCE");
    expect(archiveClientSource).toContain(
      "const INCIDENT_ARCHIVE_AS_OF_AT = FIELD_REPORT_OCCURRED_AT",
    );
    expect(archiveClientSource).toContain("LATEST EVIDENCE");
    expect(archiveClientSource).not.toContain("RETURN TO NOW");
    expect(archiveClientSource).not.toContain("setAsOfEpoch(null)");
  });

  it("starts at a fixed historical cutoff and blocks current-only recurring polls", () => {
    const incidentStart = Date.parse("2026-07-29T10:30:00Z");
    const archiveCutoff = Date.parse("2026-07-29T17:50:00Z");
    const archiveStep = 5 * 60_000;

    expect((archiveCutoff - incidentStart) % archiveStep).toBe(0);
    expect(archiveClientSource).toContain(
      "const AS_OF_STEP_MS = 5 * 60_000",
    );
    expect(archiveClientSource).toMatch(
      /const \[asOfEpoch, setAsOfEpoch\] = useState<number \| null>\(\s*INCIDENT_ARCHIVE_AS_OF_EPOCH/u,
    );
    expect(archiveClientSource).toMatch(
      /useEffect\(\(\) => \{\s*if \(!isLive\) return;[\s\S]*?fetch\("\/api\/wind"\)/u,
    );
    expect(archiveClientSource).toMatch(
      /useEffect\(\(\) => \{\s*if \(!isLive\) return;[\s\S]*?fetch\("\/api\/updates"\)/u,
    );
    expect(archiveClientSource).toMatch(
      /if \(thermalRequestDate === null\) \{\s*document\.addEventListener\("visibilitychange", resume\);/u,
    );
    expect(archiveClientSource).toContain(
      "const asOfRangeMaximum = INCIDENT_ARCHIVE_AS_OF_EPOCH",
    );
    expect(archiveClientSource).toContain(
      "ARCHIVE SNAPSHOT · LIVE FEEDS NOT POLLED",
    );
    expect(archiveClientSource).not.toContain(
      "Return to now to view it",
    );
  });
});
