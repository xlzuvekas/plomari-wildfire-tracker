import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { metadata } from "../app/explore/page";
import { GlobalDiscoveryLink } from "../components/firewatch/GlobalDiscoveryLink";

describe("global discovery navigation", () => {
  it("renders an honest localized destination in both map layouts", () => {
    const markup = renderToStaticMarkup(
      <>
        <GlobalDiscoveryLink language="en" variant="desktop" />
        <GlobalDiscoveryLink language="el" variant="mobile" />
      </>,
    );

    expect(markup.match(/href="\/explore"/g)).toHaveLength(2);
    expect(markup).toContain("Global discovery");
    expect(markup).toContain("Partial or unconfigured");
    expect(markup).toContain("Παγκόσμια");
    expect(markup).toContain("Μερική ή μη ρυθμισμένη");
    expect(markup).toContain("Coverage may be partial or unconfigured");
    expect(markup).toContain(
      "Η κάλυψη μπορεί να είναι μερική ή μη ρυθμισμένη",
    );
  });

  it("keeps the global page out of search indexing while discovery is incomplete", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it("reserves four mobile dock columns and a full touch target", () => {
    const css = readFileSync(
      new URL("../app/globals.css", import.meta.url),
      "utf8",
    );
    expect(css).toMatch(
      /\.mobile-dock\s*\{[\s\S]*?grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/,
    );
    expect(css).toMatch(
      /\.mobile-dock \.global-discovery-link--mobile\s*\{[\s\S]*?min-height:\s*52px/,
    );
    expect(css).toMatch(
      /\.global-discovery-link--desktop\s*\{[\s\S]*?left:\s*calc\(max\(20px, env\(safe-area-inset-left\)\) \+ 120px\)[\s\S]*?min-height:\s*44px/,
    );
  });

  it("does not prefetch the heavier global workspace over the incident map", () => {
    const source = readFileSync(
      new URL(
        "../components/firewatch/GlobalDiscoveryLink.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    expect(source).toContain("prefetch={false}");
  });
});
