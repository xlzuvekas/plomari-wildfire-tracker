import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  ExplorePageClient,
  loadExploreGlobeModule,
} from "../app/explore/ExplorePageClient";
import { synchronizeCandidateMarkerSelection } from "../app/explore/ExploreGlobe";
import { resolveExplorePageOptions } from "../app/explore/explore-page-options";

const exploreClientSource = readFileSync(
  new URL("../app/explore/ExplorePageClient.tsx", import.meta.url),
  "utf8",
);
const exploreGlobeSource = readFileSync(
  new URL("../app/explore/ExploreGlobe.tsx", import.meta.url),
  "utf8",
);
const exploreGlobeStyles = readFileSync(
  new URL("../app/explore/ExploreGlobe.module.css", import.meta.url),
  "utf8",
);
const explorePageStyles = readFileSync(
  new URL("../app/explore/ExplorePage.module.css", import.meta.url),
  "utf8",
);

describe("Explore route options", () => {
  it("allows synthetic data only through an explicit development query", () => {
    expect(
      resolveExplorePageOptions({ fixture: "synthetic" }, "development")
        .fixtureMode,
    ).toBe(true);
    expect(
      resolveExplorePageOptions({ fixture: "synthetic" }, "production")
        .fixtureMode,
    ).toBe(false);
    expect(
      resolveExplorePageOptions({ fixture: "fixture" }, "development")
        .fixtureMode,
    ).toBe(false);
    expect(
      resolveExplorePageOptions(
        { fixture: ["synthetic", "synthetic"] },
        "development",
      ).fixtureMode,
    ).toBe(false);
  });

  it("accepts only one exact canonical cell as a confirmation suggestion", () => {
    expect(
      resolveExplorePageOptions({ cell: "wm/10/587/391" }, "production")
        .initialSuggestedCell,
    ).toBe("wm/10/587/391");
    expect(
      resolveExplorePageOptions({ cell: "wm/010/0587/0391" }, "production")
        .initialSuggestedCell,
    ).toBeNull();
    expect(
      resolveExplorePageOptions(
        { cell: ["wm/10/587/391", "wm/10/518/352"] },
        "production",
      ).initialSuggestedCell,
    ).toBeNull();
  });
});

describe("Explore route shell", () => {
  it("renders an accessible production controller with explicit privacy and coverage boundaries", () => {
    const markup = renderToStaticMarkup(
      <ExplorePageClient
        fixtureMode={false}
        initialSuggestedCell="wm/10/587/391"
      />,
    );

    expect(markup).toContain("Wildfire discovery");
    expect(markup).toContain("Persisted HTTP reads");
    expect(markup).toContain("Local incident map");
    expect(markup).toContain('role="group"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain("Find my coarse area");
    expect(markup).toContain("Confirm suggestion");
    expect(markup).toContain("Only that cell key leaves this device");
    expect(markup).toContain(
      "Not-assessed, unconfigured, partial, stale, and unavailable",
    );
    expect(markup).not.toContain("Synthetic development data");
    expect(markup).not.toMatch(/latitude|longitude|accuracy/iu);
  });

  it("keeps device coordinates out of browser persistence", () => {
    expect(exploreClientSource).toContain(
      "coarseAreaCellForLocation(\n            position.coords.latitude,\n            position.coords.longitude,",
    );
    expect(exploreClientSource).not.toMatch(
      /localStorage|sessionStorage|indexedDB|document\.cookie/iu,
    );
  });

  it("loads the MapLibre renderer only for Explore and keeps provider calls out of the browser", () => {
    expect(exploreClientSource).toContain('() => import("./ExploreGlobe")');
    expect(exploreClientSource).toContain('mode === "explore" ? (');
    expect(exploreGlobeSource).toContain('await import("maplibre-gl")');
    expect(exploreGlobeSource).not.toMatch(/leaflet|FIRMS_MAP_KEY/iu);
    expect(exploreGlobeSource).not.toMatch(
      /fetch\(|axios|XMLHttpRequest|supabase\.from/iu,
    );
    expect(exploreGlobeSource).toContain("aggregate display-cell bounds");
    expect(exploreGlobeSource).toContain("failIfMajorPerformanceCaveat");
  });

  it("contains a rejected globe chunk without replacing the candidate list", async () => {
    await expect(
      loadExploreGlobeModule(async () => {
        throw new Error("chunk unavailable");
      }),
    ).resolves.toEqual({ status: "error" });
    expect(exploreClientSource).toContain(
      "The authoritative, keyboard-accessible candidate list remains available below.",
    );
    expect(exploreClientSource).toMatch(
      /<LazyExploreGlobe[\s\S]*<DiscoveryPanel/u,
    );
  });

  it("configures the versioned worker before map construction and retries a pre-load selection when ready", () => {
    const importIndex = exploreGlobeSource.indexOf(
      'await import("maplibre-gl")',
    );
    const workerIndex = exploreGlobeSource.indexOf(
      "maplibre.setWorkerUrl(MAPLIBRE_WORKER_URL)",
    );
    const mapIndex = exploreGlobeSource.indexOf("new maplibre.Map({");

    expect(importIndex).toBeGreaterThanOrEqual(0);
    expect(workerIndex).toBeGreaterThan(importIndex);
    expect(mapIndex).toBeGreaterThan(workerIndex);
    expect(exploreGlobeSource).toContain(
      '"/vendor/maplibre-gl/6.1.0/maplibre-gl-worker.mjs"',
    );
    expect(exploreGlobeSource).toContain(
      "}, [mapRevision, onSelectionChange, response, selectionId]);",
    );
  });

  it("updates marker selection without replacing or removing the focused element", () => {
    const attributes = new Map<string, string>();
    const element = {
      dataset: {
        candidateId: "0198f502-a99a-7000-8000-000000000001",
        cell: "wm/7/67/45",
        selected: "false",
      },
      setAttribute: (name: string, value: string) => attributes.set(name, value),
    } as unknown as HTMLButtonElement;
    const remove = vi.fn();
    const marker = {
      getElement: () => element,
      remove,
    };

    synchronizeCandidateMarkerSelection(
      [marker],
      "0198f502-a99a-7000-8000-000000000001",
    );

    expect(marker.getElement()).toBe(element);
    expect(remove).not.toHaveBeenCalled();
    expect(element.dataset.selected).toBe("true");
    expect(attributes.get("aria-pressed")).toBe("true");
    expect(attributes.get("aria-label")).toBe(
      "Selected unconfirmed candidate in aggregate cell wm/7/67/45",
    );
    expect(exploreGlobeSource).toContain(
      "}, [mapRevision, onSelectionChange, response]);",
    );
  });

  it("releases a partially initialized renderer before showing the list fallback", () => {
    const catchIndex = exploreGlobeSource.indexOf(
      "initializationFailed = true;\n        teardownMapRuntime();",
    );
    const fallbackIndex = exploreGlobeSource.indexOf(
      'kind: "unsupported",\n          label:\n            "The globe renderer could not start.',
    );

    expect(catchIndex).toBeGreaterThanOrEqual(0);
    expect(fallbackIndex).toBeGreaterThan(catchIndex);
    expect(exploreGlobeSource).toContain("observer?.disconnect();");
    expect(exploreGlobeSource).toContain("marker.remove();");
    expect(exploreGlobeSource).toContain("map?.remove();");
    expect(exploreGlobeSource).toContain("mapRef.current = null;");
    expect(exploreGlobeSource).toContain("maplibreRef.current = null;");
  });

  it("hides covered globe markers from pointer and keyboard interaction", () => {
    expect(exploreGlobeSource).toContain("opacityWhenCovered: 0");
    expect(exploreGlobeStyles).toMatch(
      /:global\(\.maplibregl-marker-covered\)\s*\{[^}]*visibility:\s*hidden;[^}]*pointer-events:\s*none;/u,
    );
  });

  it("preserves a useful mobile viewport, touch targets, resize handling, and visible credit", () => {
    expect(exploreGlobeStyles).toContain("@media (max-width: 30rem)");
    expect(exploreGlobeStyles).toMatch(
      /\.viewport\s*\{[^}]*height:\s*min\(54vh, 23rem\);[^}]*min-height:\s*18\.5rem;/u,
    );
    expect(exploreGlobeStyles).toMatch(
      /\.marker\s*\{[^}]*width:\s*2\.75rem;[^}]*height:\s*2\.75rem;/u,
    );
    expect(exploreGlobeSource).toContain("new ResizeObserver");
    expect(exploreGlobeSource).toContain("map.resize()");
    expect(exploreGlobeSource).toContain(
      "Tiles © Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    );
    expect(exploreGlobeStyles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(exploreGlobeStyles).toMatch(
      /\.footer\s*\{[^}]*font-size:\s*0\.625rem;/u,
    );
    expect(exploreGlobeStyles).not.toMatch(/@keyframes|animation:/u);
  });

  it("collapses controls before results on mobile without visually reordering the DOM", () => {
    const markup = renderToStaticMarkup(
      <ExplorePageClient fixtureMode={false} initialSuggestedCell={null} />,
    );
    const detailsIndex = markup.indexOf("<details");
    const summaryIndex = markup.indexOf("<summary");
    const resultsIndex = markup.indexOf('id="discovery-results"');

    expect(detailsIndex).toBeGreaterThanOrEqual(0);
    expect(summaryIndex).toBeGreaterThan(detailsIndex);
    expect(resultsIndex).toBeGreaterThan(summaryIndex);
    expect(markup.slice(detailsIndex, summaryIndex)).not.toContain(" open");
    expect(markup).toContain("Discovery controls");
    expect(exploreClientSource).toContain(
      'const COMPACT_CONTROLS_QUERY = "(max-width: 52rem)"',
    );
    expect(explorePageStyles).toMatch(
      /@media \(max-width: 52rem\)[\s\S]*?\.controlsSummary\s*\{[^}]*min-height:\s*2\.75rem;[^}]*display:\s*flex;/u,
    );
    expect(explorePageStyles).toMatch(
      /@media not all and \(max-width: 52rem\)[\s\S]*?\.controlsDisclosure\s*>\s*\.controlsBody\s*\{[^}]*display:\s*block;/u,
    );
    expect(explorePageStyles).not.toMatch(/\border\s*:/u);
  });
});
