const FIRMS_AREA_ENDPOINT =
  "https://firms.modaps.eosdis.nasa.gov/api/area/csv";
const FIRMS_DOCS =
  "https://firms.modaps.eosdis.nasa.gov/api/area/";
const FIRMS_VIIRS_DOCS =
  "https://firms.modaps.eosdis.nasa.gov/content/descriptions/FIRMS_VIIRS_Firehotspots.html";

const INCIDENT = {
  lat: 38.989013,
  lon: 26.382489,
  radiusKm: 8,
};

const BOUNDS = {
  west: 26.2,
  south: 38.85,
  east: 26.6,
  north: 39.15,
};

const MAX_AGE_HOURS = 24;
const PASS_GAP_MINUTES = 10;

const DATASETS = [
  { id: "VIIRS_NOAA20_NRT", label: "NOAA-20 VIIRS" },
  { id: "VIIRS_NOAA21_NRT", label: "NOAA-21 VIIRS" },
  { id: "VIIRS_SNPP_NRT", label: "Suomi-NPP VIIRS" },
] as const;

type DatasetConfig = (typeof DATASETS)[number];
type CsvRow = Record<string, string>;
type ThermalStatus = "ok" | "partial" | "unconfigured" | "upstream-error";
type ErrorCode =
  | "key_missing"
  | "key_rejected"
  | "quota_exceeded"
  | "upstream_timeout"
  | "upstream_http"
  | "invalid_response";
type ConfidenceCode = "h" | "n" | "l" | "u";

type ThermalDetection = {
  id: string;
  passId: string;
  lat: number;
  lon: number;
  sensor: string;
  satellite: string;
  product: string;
  version: string | null;
  observedAt: string;
  ageMinutes: number;
  confidence: string;
  confidenceCode: ConfidenceCode;
  frpMw: number | null;
  scanKm: number | null;
  trackKm: number | null;
  daynight: string | null;
  distanceFromIncidentKm: number;
  bearingFromIncidentDeg: number;
  scope: "incident" | "regional";
};

type DatasetResult = {
  id: DatasetConfig["id"];
  label: DatasetConfig["label"];
  status: "ok" | "error";
  records: ThermalDetection[];
  latestObservedAt: string | null;
  errorCode: ErrorCode | null;
};

class UpstreamError extends Error {
  code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

function parseCsvLine(line: string) {
  const values: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      values.push(value);
      value = "";
    } else {
      value += character;
    }
  }

  values.push(value);
  return values;
}

function parseCsv(csv: string): CsvRow[] {
  const [headerLine, ...lines] = csv
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "");

  if (headerLine === undefined) {
    throw new UpstreamError("invalid_response", "FIRMS returned no CSV");
  }

  const headers = parseCsvLine(headerLine).map((header) =>
    header.trim().toLowerCase(),
  );
  const requiredHeaders = [
    "latitude",
    "longitude",
    "acq_date",
    "acq_time",
    "confidence",
  ];
  if (requiredHeaders.some((header) => !headers.includes(header))) {
    throw new UpstreamError(
      "invalid_response",
      "FIRMS CSV was missing required columns",
    );
  }

  return lines.map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(
      headers.map((header, index) => [header, values[index]?.trim() ?? ""]),
    );
  });
}

function finiteNumber(value: string | undefined) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function confidence(value: string | undefined): {
  code: ConfidenceCode;
  label: string;
} {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "h" || normalized === "high") {
    return { code: "h", label: "High" };
  }
  if (normalized === "n" || normalized === "nominal") {
    return { code: "n", label: "Nominal" };
  }
  if (normalized === "l" || normalized === "low") {
    return { code: "l", label: "Low" };
  }
  return { code: "u", label: value?.trim() || "Unknown" };
}

function acquisitionTime(date: string | undefined, time: string | undefined) {
  if (!date || !time) return null;
  const rawDigits = time.replace(/\D/g, "");
  if (rawDigits.length < 3 || rawDigits.length > 4) return null;
  const digits = rawDigits.padStart(4, "0");
  const hour = Number(digits.slice(0, 2));
  const minute = Number(digits.slice(2));
  if (hour > 23 || minute > 59) return null;
  const observedAt = `${date}T${digits.slice(0, 2)}:${digits.slice(2)}:00Z`;
  return Number.isNaN(Date.parse(observedAt)) ? null : observedAt;
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function toDegrees(value: number) {
  return (value * 180) / Math.PI;
}

function distanceKm(
  start: { lat: number; lon: number },
  end: { lat: number; lon: number },
) {
  const radiusKm = 6371;
  const deltaLat = toRadians(end.lat - start.lat);
  const deltaLon = toRadians(end.lon - start.lon);
  const startLat = toRadians(start.lat);
  const endLat = toRadians(end.lat);
  const haversine =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(startLat) * Math.cos(endLat) * Math.sin(deltaLon / 2) ** 2;
  return 2 * radiusKm * Math.asin(Math.sqrt(haversine));
}

function bearingDegrees(
  start: { lat: number; lon: number },
  end: { lat: number; lon: number },
) {
  const startLat = toRadians(start.lat);
  const endLat = toRadians(end.lat);
  const deltaLon = toRadians(end.lon - start.lon);
  const y = Math.sin(deltaLon) * Math.cos(endLat);
  const x =
    Math.cos(startLat) * Math.sin(endLat) -
    Math.sin(startLat) * Math.cos(endLat) * Math.cos(deltaLon);
  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle];
  if (upper === undefined) return null;
  const lower = sorted[middle - 1];
  return sorted.length % 2 === 0 && lower !== undefined
    ? (lower + upper) / 2
    : upper;
}

function errorCode(error: unknown): ErrorCode {
  if (error instanceof UpstreamError) return error.code;
  if (error instanceof Error && error.name === "AbortError") {
    return "upstream_timeout";
  }
  return "upstream_http";
}

async function fetchDataset(
  mapKey: string,
  dataset: DatasetConfig,
  nowMs: number,
): Promise<DatasetResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  const area = `${BOUNDS.west},${BOUNDS.south},${BOUNDS.east},${BOUNDS.north}`;

  try {
    // Query two UTC dates, then enforce an exact rolling 24-hour window below.
    const response = await fetch(
      `${FIRMS_AREA_ENDPOINT}/${encodeURIComponent(mapKey)}/${dataset.id}/${area}/2`,
      {
        cache: "no-store",
        headers: { Accept: "text/csv" },
        signal: controller.signal,
      },
    );
    const body = await response.text();
    const preamble = body.slice(0, 500).toLowerCase();

    if (
      response.status === 401 ||
      response.status === 403 ||
      /invalid map.?key|map.?key.*invalid/.test(preamble)
    ) {
      throw new UpstreamError("key_rejected", "FIRMS rejected the MAP_KEY");
    }
    if (
      response.status === 429 ||
      /transaction limit|quota|too many requests/.test(preamble)
    ) {
      throw new UpstreamError("quota_exceeded", "FIRMS quota exceeded");
    }
    if (!response.ok) {
      throw new UpstreamError(
        "upstream_http",
        `FIRMS returned HTTP ${response.status}`,
      );
    }
    if (/^\s*(error|invalid)/i.test(body)) {
      throw new UpstreamError("invalid_response", "FIRMS returned an error");
    }

    const fromMs = nowMs - MAX_AGE_HOURS * 60 * 60 * 1000;
    const records = parseCsv(body)
      .map((row): ThermalDetection | null => {
        const lat = finiteNumber(row.latitude);
        const lon = finiteNumber(row.longitude);
        const observedAt = acquisitionTime(row.acq_date, row.acq_time);
        if (
          lat === null ||
          lon === null ||
          observedAt === null ||
          lat < BOUNDS.south ||
          lat > BOUNDS.north ||
          lon < BOUNDS.west ||
          lon > BOUNDS.east
        ) {
          return null;
        }

        const observedMs = Date.parse(observedAt);
        if (observedMs < fromMs || observedMs > nowMs) {
          return null;
        }

        const satellite = row.satellite || dataset.id;
        const confidenceValue = confidence(row.confidence);
        const incidentDistanceKm = distanceKm(INCIDENT, { lat, lon });
        const passId = `${dataset.id}-${observedAt}`;

        return {
          id: [
            dataset.id,
            observedAt,
            lat.toFixed(5),
            lon.toFixed(5),
          ].join("-"),
          passId,
          lat,
          lon,
          sensor: dataset.label,
          satellite,
          product: dataset.id,
          version: row.version || null,
          observedAt,
          ageMinutes: Math.max(0, Math.round((nowMs - observedMs) / 60_000)),
          confidence: confidenceValue.label,
          confidenceCode: confidenceValue.code,
          frpMw: finiteNumber(row.frp),
          scanKm: finiteNumber(row.scan),
          trackKm: finiteNumber(row.track),
          daynight: row.daynight || null,
          distanceFromIncidentKm: Number(incidentDistanceKm.toFixed(2)),
          bearingFromIncidentDeg: Number(
            bearingDegrees(INCIDENT, { lat, lon }).toFixed(1),
          ),
          scope:
            incidentDistanceKm <= INCIDENT.radiusKm ? "incident" : "regional",
        };
      })
      .filter((detection): detection is ThermalDetection => detection !== null);

    return {
      id: dataset.id,
      label: dataset.label,
      status: "ok",
      records,
      latestObservedAt:
        records
          .map((record) => record.observedAt)
          .sort()
          .at(-1) ?? null,
      errorCode: null,
    };
  } catch (error) {
    return {
      id: dataset.id,
      label: dataset.label,
      status: "error",
      records: [],
      latestObservedAt: null,
      errorCode: errorCode(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function confidenceCounts(detections: ThermalDetection[]) {
  return detections.reduce(
    (counts, detection) => {
      counts[detection.confidenceCode] += 1;
      return counts;
    },
    { h: 0, n: 0, l: 0, u: 0 } satisfies Record<ConfidenceCode, number>,
  );
}

function clusterSatellitePasses(detections: ThermalDetection[]) {
  const lastByProduct = new Map<
    string,
    { observedMs: number; passId: string }
  >();

  return [...detections]
    .sort((left, right) => {
      if (left.product !== right.product) {
        return left.product.localeCompare(right.product);
      }
      return Date.parse(left.observedAt) - Date.parse(right.observedAt);
    })
    .map((detection) => {
      const observedMs = Date.parse(detection.observedAt);
      const previous = lastByProduct.get(detection.product);
      const samePass =
        previous &&
        observedMs - previous.observedMs <= PASS_GAP_MINUTES * 60_000;
      const passId = samePass
        ? previous.passId
        : `${detection.product}-${detection.observedAt}`;
      lastByProduct.set(detection.product, { observedMs, passId });
      return { ...detection, passId };
    })
    .sort(
      (left, right) =>
        Date.parse(right.observedAt) - Date.parse(left.observedAt),
    );
}

function responseHeaders() {
  return {
    "Cache-Control":
      "public, max-age=15, s-maxage=120, stale-while-revalidate=180",
  };
}

export async function GET() {
  const requestStartedAt = new Date().toISOString();
  const nowMs = Date.now();
  const mapKey = process.env.FIRMS_MAP_KEY?.trim();
  const query = {
    bounds: BOUNDS,
    incidentCenter: { lat: INCIDENT.lat, lon: INCIDENT.lon },
    incidentRadiusKm: INCIDENT.radiusKm,
    from: new Date(nowMs - MAX_AGE_HOURS * 60 * 60 * 1000).toISOString(),
    to: new Date(nowMs).toISOString(),
    maxAgeHours: MAX_AGE_HOURS,
  };

  if (!mapKey) {
    return Response.json(
      {
        schemaVersion: 2,
        status: "unconfigured" satisfies ThermalStatus,
        requestStartedAt,
        retrievedAt: new Date().toISOString(),
        query,
        credential: {
          env: "FIRMS_MAP_KEY",
          configured: false,
        },
        latestObservedAt: null,
        latestIncidentObservedAt: null,
        observationAgeMinutes: null,
        complete: false,
        datasets: DATASETS.map((dataset) => ({
          id: dataset.id,
          label: dataset.label,
          status: "unconfigured",
          records: 0,
          latestObservedAt: null,
          errorCode: "key_missing" satisfies ErrorCode,
        })),
        summary: {
          incidentRecords: 0,
          regionalRecords: 0,
          passCount: 0,
          byConfidence: { h: 0, n: 0, l: 0, u: 0 },
        },
        passes: [],
        detections: [],
        errors: [
          {
            code: "key_missing" satisfies ErrorCode,
            dataset: null,
            message: "FIRMS server key is not configured",
          },
        ],
        source: {
          name: "NASA FIRMS",
          docs: FIRMS_DOCS,
          semantics: FIRMS_VIIRS_DOCS,
          appPollSeconds: 300,
          upstreamRefreshMinutes: 15,
          globalNrtLatencyMaxHours: 3,
          observationCadenceNote:
            "Orbital snapshots; the three-satellite constellation typically provides several looks per day, not a continuous live feed.",
        },
      },
      { headers: responseHeaders() },
    );
  }

  const results = await Promise.all(
    DATASETS.map((dataset) => fetchDataset(mapKey, dataset, nowMs)),
  );
  const successful = results.filter((result) => result.status === "ok");
  const failed = results.filter((result) => result.status === "error");
  const status: ThermalStatus =
    successful.length === DATASETS.length
      ? "ok"
      : successful.length > 0
        ? "partial"
        : "upstream-error";

  const detections = clusterSatellitePasses(
    results
      .flatMap((result) => result.records)
      .filter(
        (detection, index, rows) =>
          rows.findIndex((candidate) => candidate.id === detection.id) ===
          index,
      ),
  );
  const incidentDetections = detections.filter(
    (detection) => detection.scope === "incident",
  );

  const passes = Array.from(
    detections.reduce((groups, detection) => {
      const current = groups.get(detection.passId) ?? [];
      current.push(detection);
      groups.set(detection.passId, current);
      return groups;
    }, new Map<string, ThermalDetection[]>()),
  )
    .flatMap(([id, records]) => {
      const first = records[0];
      if (first === undefined) return [];
      const frpValues = records
        .map((record) => record.frpMw)
        .filter((value): value is number => value !== null);
      const incidentRecordCount = records.filter(
        (record) => record.scope === "incident",
      ).length;
      return [
        {
          id,
          platform: first.sensor,
          satellite: first.satellite,
          product: first.product,
          observedAt: first.observedAt,
          ageMinutes: first.ageMinutes,
          recordCount: records.length,
          incidentRecordCount,
          byConfidence: confidenceCounts(records),
          maxFrpMw: frpValues.length ? Math.max(...frpValues) : null,
          medianFrpMw: median(frpValues),
          dayNight: first.daynight,
        },
      ];
    })
    .sort(
      (left, right) =>
        Date.parse(right.observedAt) - Date.parse(left.observedAt),
    );

  const latestObservedAt = detections[0]?.observedAt ?? null;
  const latestIncidentObservedAt =
    incidentDetections[0]?.observedAt ?? null;
  const retrievedAt = new Date().toISOString();

  return Response.json(
    {
      schemaVersion: 2,
      status,
      requestStartedAt,
      retrievedAt,
      query,
      credential: {
        env: "FIRMS_MAP_KEY",
        configured: true,
      },
      latestObservedAt,
      latestIncidentObservedAt,
      observationAgeMinutes: latestIncidentObservedAt
        ? Math.max(
            0,
            Math.round(
              (Date.parse(retrievedAt) - Date.parse(latestIncidentObservedAt)) /
                60_000,
            ),
          )
        : null,
      complete: failed.length === 0,
      datasets: results.map((result) => ({
        id: result.id,
        label: result.label,
        status: result.status,
        records: result.records.length,
        latestObservedAt: result.latestObservedAt,
        errorCode: result.errorCode,
      })),
      summary: {
        incidentRecords: incidentDetections.length,
        regionalRecords: detections.length - incidentDetections.length,
        passCount: passes.filter((pass) => pass.incidentRecordCount > 0).length,
        byConfidence: confidenceCounts(incidentDetections),
      },
      passes,
      detections,
      errors: failed.map((result) => ({
        code: result.errorCode,
        dataset: result.id,
        message: `${result.label} unavailable`,
      })),
      source: {
        name: "NASA FIRMS",
        docs: FIRMS_DOCS,
        semantics: FIRMS_VIIRS_DOCS,
        appPollSeconds: 300,
        upstreamRefreshMinutes: 15,
        globalNrtLatencyMaxHours: 3,
        observationCadenceNote:
          "Orbital snapshots; the three-satellite constellation typically provides several looks per day, not a continuous live feed.",
      },
    },
    { headers: responseHeaders() },
  );
}
