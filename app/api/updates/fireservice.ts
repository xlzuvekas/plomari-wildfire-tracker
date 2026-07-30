// Explicit .ts extension so the Node test runner can import this module
// without a build step; requires allowImportingTsExtensions in tsconfig.
import { normalizeSearch } from "./text.ts";

export const FIRE_SERVICE_BOARD_URL =
  "https://www.fireservice.gr/apps/fire2019/symvanta/page.php";

export type FireServiceStatus =
  | "in-progress"
  | "partial-control"
  | "full-control"
  | "ended";

export type FireServiceIncident = {
  status: FireServiceStatus;
  statusLabel: string;
  municipality: string;
  incidentType: string;
  sourceAge: string | null;
};

// The official incident board has no API; this parses its HTML by locating
// the Plomari row and taking the last status heading that precedes it.
// Throws when the row or status cannot be found so callers surface a source
// error instead of fabricating data.
export function parseFireServiceBoard(html: string): FireServiceIncident {
  const text = normalizeSearch(html);
  const incidentIndex = text.indexOf("δ. λεσβου - πλωμαριου");
  if (incidentIndex < 0) {
    throw new Error("Plomari row not found");
  }

  const before = text.slice(0, incidentIndex);
  const headings = Array.from(
    before.matchAll(
      /(σε εξελιξη|μερικος ελεγχος|πληρης ελεγχος|ληξη)\s*\(\d+\)/g,
    ),
  );
  const heading = headings.at(-1)?.[1];
  const status =
    heading === "σε εξελιξη"
      ? "in-progress"
      : heading === "μερικος ελεγχος"
        ? "partial-control"
        : heading === "πληρης ελεγχος"
          ? "full-control"
          : heading === "ληξη"
            ? "ended"
            : null;

  if (!status) {
    throw new Error("Plomari status not parsed");
  }

  const after = text.slice(incidentIndex, incidentIndex + 700);
  const sourceAge =
    after.match(
      /τελευταια ενημερωση πριν απο\s+(\d+\s+(?:δευτερολεπτ(?:ο|α)|λεπτ(?:ο|α)|ωρ(?:α|ες)))/,
    )?.[1] ?? null;

  return {
    status,
    statusLabel:
      status === "in-progress"
        ? "IN PROGRESS"
        : status === "partial-control"
          ? "PARTIAL CONTROL"
          : status === "full-control"
            ? "FULL CONTROL"
            : "ENDED",
    municipality: "Lesvos · Plomari",
    incidentType: "Wildfire incident",
    sourceAge,
  };
}
