import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { MobileLocationSummary } from "../components/firewatch";
import { initialArchivedAlertCollapsed } from "../lib/firewatch/incident-ui";

const pageSource = readFileSync(
  new URL("../app/page.tsx", import.meta.url),
  "utf8",
);
const globalStyles = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);

describe("incident mobile safety surfaces", () => {
  test("defaults an archived alert to compact only when no mobile preference exists", () => {
    expect(initialArchivedAlertCollapsed(null, true)).toBe(true);
    expect(initialArchivedAlertCollapsed(null, false)).toBe(false);
    expect(initialArchivedAlertCollapsed("0", true)).toBe(false);
    expect(initialArchivedAlertCollapsed("1", false)).toBe(true);
    expect(initialArchivedAlertCollapsed("unexpected", true)).toBe(true);
  });

  test("renders location summary as the control for the existing bounded sheet", () => {
    const markup = renderToStaticMarkup(
      <MobileLocationSummary
        title="GPS ±20 m"
        detail="3.2 km NE · nearest hotspot"
        actionLabel="Details"
        accessibleLabel="Open location details"
        expanded={false}
        onOpen={() => undefined}
      />,
    );

    expect(markup).toContain('class="locate-summary"');
    expect(markup).toContain('aria-controls="layers-sheet"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).not.toMatch(/latitude|longitude|accuracyM|\b(?:lat|lon)=/iu);
    expect(pageSource.match(/id="layers-sheet"/gu)).toHaveLength(1);
    expect(pageSource).toContain('setLayerTab("location")');
  });

  test("caps the mobile GPS entrypoint and keeps detail content in the one sheet", () => {
    expect(globalStyles).toMatch(
      /@media \(max-width: 1180px\)[\s\S]*?\.locate-summary\s*\{[^}]*height:\s*56px;[^}]*max-height:\s*56px;/u,
    );
    expect(globalStyles).toMatch(
      /\.layer-hud,[\s\S]*?max-height:\s*min\([\s\S]*?68dvh/u,
    );
    expect(globalStyles).toMatch(
      /\.has-mobile-sheet \.locate-summary\s*\{[^}]*display:\s*none;/u,
    );
    expect(globalStyles).toMatch(
      /\.command-shell\.alert-collapsed\s*\{[^}]*--mobile-alert:\s*48px;/u,
    );
    expect(globalStyles).toMatch(
      /\.command-shell:not\(\.alert-preference-ready\):not\(\.without-archived-alert\)\s*\{[^}]*--mobile-alert:\s*48px;/u,
    );
    expect(pageSource).toContain(
      'initialArchivedAlertCollapsed(',
    );
  });
});

describe("incident scrubber interaction contract", () => {
  test("commits every pointer and keyboard completion path", () => {
    expect(pageSource).toContain("onPointerDown={beginAsOfPointerScrub}");
    expect(pageSource).toContain("onPointerUp={finishAsOfPointerScrub}");
    expect(pageSource).toContain("onPointerCancel={finishAsOfPointerScrub}");
    expect(pageSource).toContain("onKeyUp={onAsOfKeyUp}");
    expect(pageSource).toContain("onBlur={commitAsOfScrub}");
    expect(pageSource).toContain("setCommittedThermalAsOfEpoch(");
  });

  test("maps the End key through the explicit Live range sentinel", () => {
    expect(pageSource).toMatch(
      /event\.key === "End"[\s\S]*?event\.preventDefault\(\);[\s\S]*?updateAsOfFromRange\(ageEpoch\)/u,
    );
    expect(pageSource).toContain("step={AS_OF_STEP_MS}");
    expect(pageSource).toContain("value={asOfEpoch ?? ageEpoch}");
  });

  test("keeps operational timestamp copy explicit", () => {
    expect(pageSource).not.toMatch(/\bEEST\b|\bEET\b/u);
    expect(pageSource).toContain("fieldReportLabel");
    expect(pageSource).toContain("officialAlertIssuedLabel");
  });
});
