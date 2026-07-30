import { SOURCE_REGISTRY } from "../../lib/truth/source-registry";
import type { AdapterFixture } from "../../lib/truth/v1";

const CAPTURED_AT = "2026-07-30T00:30:00Z";

function successBodyForAdapter(
  adapterName: AdapterFixture["adapterName"],
  sourceKey: string,
): string {
  switch (adapterName) {
    case "fire-service-board":
      return '<tr data-incident="plomari"><td>Πλωμάρι</td><td>ΣΕ ΕΞΕΛΙΞΗ</td></tr>';
    case "x-official-account":
      return JSON.stringify({
        data: [
          {
            id: `${sourceKey}-post-1`,
            created_at: "2026-07-29T13:58:00Z",
            text:
              sourceKey === "112-greece"
                ? "Δασική πυρκαγιά στην περιοχή Πλωμάρι. Ακολουθείτε τις οδηγίες των Αρχών."
                : "Ενισχύθηκαν οι πυροσβεστικές δυνάμεις στο Πλωμάρι.",
          },
        ],
      });
    case "rss-official-context":
    case "rss-publisher":
      return `<?xml version="1.0"?><rss><channel><item><guid>${sourceKey}-1</guid><title>Ενημέρωση για το Πλωμάρι</title><pubDate>Wed, 29 Jul 2026 17:00:00 +0300</pubDate><link>https://example.org/${sourceKey}/1</link></item></channel></rss>`;
    case "firms-area-csv":
      return "latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,frp\n38.9751,26.3662,341.2,0.39,0.36,2026-07-29,1542,N20,VIIRS,n,8.1";
    case "gibs-imagery-metadata":
      return JSON.stringify({
        layer: "VIIRS_SNPP_CorrectedReflectance_TrueColor",
        date: "2026-07-29",
        available: true,
      });
    case "open-meteo-forecast":
      return JSON.stringify({
        timezone: "Europe/Athens",
        hourly_units: {
          wind_speed_10m: "km/h",
          wind_direction_10m: "°",
          wind_gusts_10m: "km/h",
        },
        hourly: {
          time: ["2026-07-30T03:00"],
          wind_speed_10m: [31],
          wind_direction_10m: [24],
          wind_gusts_10m: [55],
        },
      });
    case "aviation-weather-metar":
      return JSON.stringify([
        {
          icaoId: "LGMT",
          obsTime: 1785371400,
          wdir: 30,
          wspd: 22,
          wgst: 34,
          rawOb: "LGMT 300030Z 03022G34KT CAVOK 27/17 Q1008",
        },
      ]);
  }
}

const baseFixtures: AdapterFixture[] = SOURCE_REGISTRY.flatMap((source) => [
  {
    fixtureVersion: 1,
    id: `${source.key}-success`,
    identityKey: `${source.key}-record-1`,
    sourceKey: source.key,
    adapterName: source.adapterName,
    scenario: "success",
    capturedAt: CAPTURED_AT,
    request: {
      method: "GET",
      url: source.dataUrl,
      headers: { accept: "application/json,text/csv,application/rss+xml,text/html" },
    },
    transport: {
      kind: "http",
      status: 200,
      headers: { "content-type": "application/octet-stream" },
      body: successBodyForAdapter(source.adapterName, source.key),
    },
    expected: {
      ingestionStatus: "success",
      itemCount: 1,
      validationState: "accepted",
      reasonCodes: [],
      semanticDelta: true,
      protectiveActionCount: source.key === "112-greece" ? 1 : 0,
    },
  },
  {
    fixtureVersion: 1,
    id: `${source.key}-timeout`,
    sourceKey: source.key,
    adapterName: source.adapterName,
    scenario: "timeout",
    capturedAt: CAPTURED_AT,
    request: {
      method: "GET",
      url: source.dataUrl,
      headers: {} as Record<string, string>,
    },
    transport: {
      kind: "timeout",
      safeMessage: "Upstream did not respond before the adapter deadline.",
    },
    expected: {
      ingestionStatus: "failed",
      itemCount: 0,
      validationState: null,
      reasonCodes: [],
      semanticDelta: false,
      protectiveActionCount: 0,
    },
  },
]);

const scenarioFixtures: AdapterFixture[] = [
  {
    fixtureVersion: 1,
    id: "firms-noaa20-zero-result",
    sourceKey: "firms-noaa20",
    adapterName: "firms-area-csv",
    scenario: "zero_result",
    capturedAt: CAPTURED_AT,
    request: {
      method: "GET",
      url: "https://firms.modaps.eosdis.nasa.gov/api/area/csv",
      headers: {},
    },
    transport: {
      kind: "http",
      status: 200,
      headers: { "content-type": "text/csv" },
      body: "latitude,longitude,scan,track,acq_date,acq_time,satellite,confidence,frp",
    },
    expected: {
      ingestionStatus: "success",
      itemCount: 0,
      validationState: "accepted",
      reasonCodes: [],
      semanticDelta: false,
      protectiveActionCount: 0,
    },
  },
  {
    fixtureVersion: 1,
    id: "fire-service-board-correction",
    identityKey: "fire-service-board-record-1",
    sourceKey: "fire-service-board",
    adapterName: "fire-service-board",
    scenario: "correction",
    capturedAt: "2026-07-30T00:35:00Z",
    request: {
      method: "GET",
      url: "https://www.fireservice.gr/apps/fire2019/symvanta/page.php",
      headers: {},
    },
    transport: {
      kind: "http",
      status: 200,
      headers: { "content-type": "text/html" },
      body: '<tr data-incident="plomari"><td>Πλωμάρι</td><td>ΜΕΡΙΚΟΣ ΕΛΕΓΧΟΣ</td></tr>',
    },
    expected: {
      ingestionStatus: "success",
      itemCount: 1,
      validationState: "accepted",
      reasonCodes: [],
      semanticDelta: true,
      protectiveActionCount: 0,
    },
  },
  {
    fixtureVersion: 1,
    id: "civil-protection-malformed-time",
    sourceKey: "civil-protection",
    adapterName: "rss-official-context",
    scenario: "malformed_time",
    capturedAt: CAPTURED_AT,
    request: {
      method: "GET",
      url: "https://civilprotection.gov.gr/deltia-tupou.rss",
      headers: {},
    },
    transport: {
      kind: "http",
      status: 200,
      headers: { "content-type": "application/rss+xml" },
      body: "<rss><channel><item><pubDate>tomorrow-ish</pubDate></item></channel></rss>",
    },
    expected: {
      ingestionStatus: "partial",
      itemCount: 1,
      validationState: "quarantined",
      reasonCodes: ["invalid_timestamp"],
      semanticDelta: false,
      protectiveActionCount: 0,
    },
  },
  {
    fixtureVersion: 1,
    id: "open-meteo-plomari-future-time",
    sourceKey: "open-meteo-plomari",
    adapterName: "open-meteo-forecast",
    scenario: "future_time",
    capturedAt: CAPTURED_AT,
    request: {
      method: "GET",
      url: "https://api.open-meteo.com/v1/forecast",
      headers: {},
    },
    transport: {
      kind: "http",
      status: 200,
      headers: { "content-type": "application/json" },
      body: '{"hourly":{"time":["2026-08-30T03:00"],"wind_speed_10m":[30]}}',
    },
    expected: {
      ingestionStatus: "partial",
      itemCount: 1,
      validationState: "quarantined",
      reasonCodes: ["future_timestamp"],
      semanticDelta: false,
      protectiveActionCount: 0,
    },
  },
  {
    fixtureVersion: 1,
    id: "stonisi-partial-failure",
    sourceKey: "stonisi",
    adapterName: "rss-publisher",
    scenario: "partial_failure",
    capturedAt: CAPTURED_AT,
    request: {
      method: "GET",
      url: "https://feeds.feedburner.com/stonisigr",
      headers: {},
    },
    transport: {
      kind: "http",
      status: 206,
      headers: { "content-type": "application/rss+xml" },
      body: "<rss><channel><item><guid>valid-1</guid></item><item>",
    },
    expected: {
      ingestionStatus: "partial",
      itemCount: 1,
      validationState: "accepted",
      reasonCodes: ["parser_schema_drift"],
      semanticDelta: true,
      protectiveActionCount: 0,
    },
  },
  {
    fixtureVersion: 1,
    id: "112-greece-authentication",
    sourceKey: "112-greece",
    adapterName: "x-official-account",
    scenario: "authentication",
    capturedAt: CAPTURED_AT,
    request: {
      method: "GET",
      url: "https://x.com/112Greece",
      headers: {},
    },
    transport: {
      kind: "authentication",
      status: 401,
      safeMessage: "The optional official-account API credential was rejected.",
    },
    expected: {
      ingestionStatus: "failed",
      itemCount: 0,
      validationState: null,
      reasonCodes: [],
      semanticDelta: false,
      protectiveActionCount: 0,
    },
  },
  {
    fixtureVersion: 1,
    id: "firms-noaa21-quota",
    sourceKey: "firms-noaa21",
    adapterName: "firms-area-csv",
    scenario: "quota",
    capturedAt: CAPTURED_AT,
    request: {
      method: "GET",
      url: "https://firms.modaps.eosdis.nasa.gov/api/area/csv",
      headers: {},
    },
    transport: {
      kind: "quota",
      status: 429,
      retryAfterSeconds: 300,
      safeMessage: "FIRMS quota exhausted; retain the last successful state.",
    },
    expected: {
      ingestionStatus: "failed",
      itemCount: 0,
      validationState: null,
      reasonCodes: [],
      semanticDelta: false,
      protectiveActionCount: 0,
    },
  },
  {
    fixtureVersion: 1,
    id: "nasa-gibs-malformed-payload",
    sourceKey: "nasa-gibs",
    adapterName: "gibs-imagery-metadata",
    scenario: "malformed_payload",
    capturedAt: CAPTURED_AT,
    request: {
      method: "GET",
      url: "https://gibs.earthdata.nasa.gov/",
      headers: {},
    },
    transport: {
      kind: "http",
      status: 200,
      headers: { "content-type": "text/html" },
      body: "<html><title>temporary error</title></html>",
    },
    expected: {
      ingestionStatus: "failed",
      itemCount: 0,
      validationState: "rejected",
      reasonCodes: ["invalid_structure"],
      semanticDelta: false,
      protectiveActionCount: 0,
    },
  },
  {
    fixtureVersion: 1,
    id: "stonisi-evacuation-headline",
    sourceKey: "stonisi",
    adapterName: "rss-publisher",
    scenario: "success",
    capturedAt: CAPTURED_AT,
    request: {
      method: "GET",
      url: "https://feeds.feedburner.com/stonisigr",
      headers: {},
    },
    transport: {
      kind: "http",
      status: 200,
      headers: { "content-type": "application/rss+xml" },
      body: "<rss><channel><item><title>Εκκενώστε τώρα το Πλωμάρι</title><link>https://www.stonisi.gr/example</link></item></channel></rss>",
    },
    expected: {
      ingestionStatus: "success",
      itemCount: 1,
      validationState: "accepted",
      reasonCodes: [],
      semanticDelta: true,
      protectiveActionCount: 0,
    },
  },
];

export const ADAPTER_FIXTURES: readonly AdapterFixture[] = Object.freeze([
  ...baseFixtures,
  ...scenarioFixtures,
]);
