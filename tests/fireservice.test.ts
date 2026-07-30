import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { parseFireServiceBoard } from "../app/api/updates/fireservice.ts";

const fixture = readFileSync(
  new URL("./fixtures/fireservice-board.html", import.meta.url),
  "utf8",
);

test("parses the Plomari row from a real board snapshot", () => {
  assert.deepEqual(parseFireServiceBoard(fixture), {
    status: "in-progress",
    statusLabel: "IN PROGRESS",
    municipality: "Lesvos · Plomari",
    incidentType: "Wildfire incident",
    sourceAge: "24 λεπτα",
  });
});

test("maps a different status heading and tolerates a missing age line", () => {
  const html =
    "<html><body><h3>ΛΗΞΗ (4)</h3>" +
    "<table><tr><td>Δ. ΛΕΣΒΟΥ - ΠΛΩΜΑΡΙΟΥ</td></tr></table></body></html>";
  assert.deepEqual(parseFireServiceBoard(html), {
    status: "ended",
    statusLabel: "ENDED",
    municipality: "Lesvos · Plomari",
    incidentType: "Wildfire incident",
    sourceAge: null,
  });
});

test("throws when the Plomari row is missing so the source degrades to error", () => {
  assert.throws(
    () => parseFireServiceBoard("<html><body>unrelated page</body></html>"),
    /Plomari row not found/,
  );
});

test("throws when no status heading precedes the Plomari row", () => {
  assert.throws(
    () =>
      parseFireServiceBoard(
        "<html><body><td>Δ. ΛΕΣΒΟΥ - ΠΛΩΜΑΡΙΟΥ</td></body></html>",
      ),
    /Plomari status not parsed/,
  );
});
