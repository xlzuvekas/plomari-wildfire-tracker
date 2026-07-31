import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ExplorePageClient } from "../app/explore/ExplorePageClient";
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
    expect(exploreClientSource).toContain("dynamic(");
    expect(exploreClientSource).toContain('mode === "explore" ? (');
    expect(exploreGlobeSource).toContain('await import("maplibre-gl")');
    expect(exploreGlobeSource).not.toMatch(/leaflet|FIRMS_MAP_KEY/iu);
    expect(exploreGlobeSource).not.toMatch(
      /fetch\(|axios|XMLHttpRequest|supabase\.from/iu,
    );
    expect(exploreGlobeSource).toContain("aggregate display-cell bounds");
    expect(exploreGlobeSource).toContain("failIfMajorPerformanceCaveat");
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
    expect(exploreGlobeStyles).not.toMatch(/@keyframes|animation:/u);
  });
});
