import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { MobileLocationSummary } from "../components/firewatch";
import {
  initialArchivedAlertCollapsed,
  readBrowserPreference,
  writeBrowserPreference,
} from "../lib/firewatch/incident-ui";

const pageSource = readFileSync(
  new URL(
    "../app/incidents/plomari-2026-07-29/PlomariIncidentClient.tsx",
    import.meta.url,
  ),
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

  test("keeps archived-alert initialization usable when browser storage is blocked", () => {
    expect(
      readBrowserPreference(() => {
        throw new DOMException("Blocked", "SecurityError");
      }),
    ).toBeNull();
    expect(
      writeBrowserPreference(() => {
        throw new DOMException("Blocked", "SecurityError");
      }),
    ).toBe(false);
    expect(pageSource).toContain("setAlertPreferenceReady(true)");
    expect(pageSource).toContain("readBrowserPreference(() =>");
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
    expect(markup).not.toContain("aria-live");
    expect(markup).not.toMatch(/latitude|longitude|accuracyM|\b(?:lat|lon)=/iu);
    expect(pageSource.match(/id="layers-sheet"/gu)).toHaveLength(1);
    expect(pageSource).toContain('setLayerTab("location")');
    expect(pageSource).toContain("buttonRef={locationSummaryElement}");
    expect(pageSource).toContain('querySelector<HTMLButtonElement>(".sheet-close")');
    expect(pageSource).toContain("locationSummaryElement.current?.focus()");
    expect(pageSource).toContain("locateControlElement.current?.focus()");
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
      /\.has-locate-readout:not\(\.has-mobile-sheet\) \.leaflet-control-attribution\s*\{[^}]*margin-bottom:\s*calc\(var\(--mobile-dock\) \+ 76px\) !important;/u,
    );
    expect(globalStyles).toMatch(
      /\.has-locate-readout \.scenario-hud\s*\{[^}]*display:\s*none;/u,
    );
    expect(globalStyles).toMatch(
      /@media \(max-width: 1180px\) and \(max-height: 520px\) and \(orientation: landscape\)[\s\S]*?\.layer-hud,[\s\S]*?100dvh - var\(--mobile-head\) - var\(--mobile-dock\) - 8px[\s\S]*?\.locate-summary\s*\{[^}]*height:\s*44px;/u,
    );
    expect(globalStyles).toMatch(
      /\.has-mobile-sheet \.evacuation-banner,[\s\S]*?\.has-mobile-sheet \.evacuation-collapsed\s*\{[^}]*visibility:\s*hidden;/u,
    );
    expect(globalStyles).toContain("env(safe-area-inset-left, 0px)");
    expect(globalStyles).toContain("env(safe-area-inset-right, 0px)");
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

  test("maps the End key to the fixed archive snapshot", () => {
    expect(pageSource).toMatch(
      /event\.key === "End"[\s\S]*?event\.preventDefault\(\);[\s\S]*?updateAsOfFromRange\(asOfRangeMaximum\)/u,
    );
    expect(pageSource).toContain("step={AS_OF_STEP_MS}");
    expect(pageSource).toContain("max={asOfRangeMaximum}");
    expect(pageSource).toContain("value={asOfEpoch ?? asOfRangeMaximum}");
    expect(pageSource).toContain(
      "const asOfRangeMaximum = INCIDENT_ARCHIVE_AS_OF_EPOCH",
    );
    expect(pageSource).toContain("LATEST EVIDENCE");
    expect(pageSource).not.toContain("RETURN TO NOW");
  });

  test("keeps operational timestamp copy explicit", () => {
    expect(pageSource).not.toMatch(/\bEEST\b|\bEET\b/u);
    expect(pageSource).toContain("fieldReportLabel");
    expect(pageSource).toContain("officialAlertIssuedLabel");
    expect(pageSource).toContain("fieldReportContext");
    expect(pageSource).toMatch(
      /markerHtml\(\s*"report",\s*localize\([\s\S]*?`FIELD REPORT/u,
    );
    expect(pageSource).toContain("const observedEpoch = timestampEpoch(value)");
    expect(globalStyles).toMatch(
      /\.map-marker b small\s*\{[^}]*font-size:\s*0\.75rem;/u,
    );
    expect(globalStyles).toMatch(
      /\.map-marker--report\s*\{[^}]*flex-direction:\s*row-reverse;[^}]*white-space:\s*normal;/u,
    );
  });

  test("never turns unavailable or incomplete thermal coverage into reassurance", () => {
    expect(pageSource).not.toContain("No hotspots in the current window");
    expect(pageSource).not.toContain(
      "No satellite hotspots in the current window",
    );
    expect(pageSource).toContain("Checking FIRMS thermal observations");
    expect(pageSource).toContain(
      "WAITING FOR FIRST FIRMS RESPONSE · NO ASSESSMENT YET",
    );
    expect(pageSource).toMatch(
      /\{thermalLoading[\s\S]*?WAITING FOR FIRST FIRMS RESPONSE[\s\S]*?: thermalUnavailable[\s\S]*?: thermalDetections\.length === 0/u,
    );
    expect(pageSource).toContain(
      "Thermal observations unavailable · no assessment",
    );
    expect(pageSource).toContain(
      "Thermal coverage stale or incomplete · no assessment",
    );
    expect(pageSource).toContain(
      "No FIRMS detections returned · not an all-clear",
    );
  });

  test("rejects malformed historical thermal windows instead of normalizing them", () => {
    expect(pageSource).not.toContain("Date.parse(payload.query");
    expect(pageSource).toContain(
      'throw new Error("Invalid historical thermal query window")',
    );
  });
});
