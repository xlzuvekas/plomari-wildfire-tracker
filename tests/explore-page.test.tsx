import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ExplorePageClient } from "../app/explore/ExplorePageClient";
import { resolveExplorePageOptions } from "../app/explore/explore-page-options";

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
    expect(markup).toContain("Unconfigured, partial, stale, and unavailable");
    expect(markup).not.toContain("Synthetic development data");
    expect(markup).not.toMatch(/latitude|longitude|accuracy/iu);
  });
});
