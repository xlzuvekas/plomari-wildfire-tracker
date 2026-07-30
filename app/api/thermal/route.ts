const FIRMS_AREA_ENDPOINT =
  "https://firms.modaps.eosdis.nasa.gov/api/area/csv";
const FIRMS_DOCS =
  "https://firms.modaps.eosdis.nasa.gov/api/area/";
const FIRMS_VIIRS_DOCS =
  "https://firms.modaps.eosdis.nasa.gov/content/descriptions/FIRMS_VIIRS_Firehotspots.html";
const FIRMS_MODIS_DOCS =
  "https://firms.modaps.eosdis.nasa.gov/descriptions/FIRMS_MODIS_Firehotspots.html";
const FIRMS_ACTIVE_FIRE_DOWNLOADS =
  "https://firms.modaps.eosdis.nasa.gov/active_fire/";

const FIRMS_SOURCE_TIMEOUT_MS = 12_000;
// The four current Europe files total well under this per-response ceiling.
// Keep the limit on decoded response bytes so a bad upstream response cannot
// consume unbounded serverless memory even when Content-Length is absent.
const MAX_CSV_RESPONSE_BYTES = 2_000_000;

const INCIDENT = {
  lat: 38.989013,
  lon: 26.382489,
  radiusKm: 8,
};

// First UTC calendar day of the incident; historical queries cannot precede it.
const INCIDENT_START_UTC_DATE = "2026-07-29";

const BOUNDS = {
  west: 26.2,
  south: 38.85,
  east: 26.6,
  north: 39.15,
};

const MAX_AGE_HOURS = 24;
const GLOBAL_NRT_LATENCY_MAX_HOURS = 3;
const PASS_GAP_MINUTES = 10;

const DATASETS = [
  {
    id: "VIIRS_NOAA20_NRT",
    label: "NOAA-20 VIIRS",
    europe24hUrl:
      "https://firms.modaps.eosdis.nasa.gov/data/active_fire/viirs-noaa20-nrt/csv/J1_VIIRS_C2_Europe_24h.csv",
  },
  {
    id: "VIIRS_NOAA21_NRT",
    label: "NOAA-21 VIIRS",
    europe24hUrl:
      "https://firms.modaps.eosdis.nasa.gov/data/active_fire/viirs-noaa21-nrt/csv/J2_VIIRS_C2_Europe_24h.csv",
  },
  {
    id: "VIIRS_SNPP_NRT",
    label: "Suomi-NPP VIIRS",
    europe24hUrl:
      "https://firms.modaps.eosdis.nasa.gov/data/active_fire/viirs-snpp-nrt/csv/SUOMI_VIIRS_C2_Europe_24h.csv",
  },
  {
    id: "MODIS_NRT",
    label: "Terra/Aqua MODIS",
    europe24hUrl:
      "https://firms.modaps.eosdis.nasa.gov/data/active_fire/modis-c6.1/csv/MODIS_C6_1_Europe_24h.csv",
  },
] as const;

type DatasetConfig = (typeof DATASETS)[number];
type CsvRow = Record<string, string>;
type ThermalStatus = "ok" | "partial" | "unconfigured" | "upstream-error";
type DatasetStatus = "ok" | "error" | "unconfigured";
type DeliverySourceId = "area-api" | "europe-24h-download";
type DeliverySourceStatus =
  | "ok"
  | "error"
  | "unconfigured"
  | "not-applicable";
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
  status: DatasetStatus;
  records: ThermalDetection[];
  latestObservedAt: string | null;
  errorCode: ErrorCode | null;
  degraded: boolean;
  fallbackUsed: boolean;
  supplementalRecordCount: number;
  lagMinutesRecovered: number | null;
  sources: DatasetSourceResult[];
};

type DatasetSourceResult = {
  id: DeliverySourceId;
  status: DeliverySourceStatus;
  records: ThermalDetection[];
  latestObservedAt: string | null;
  errorCode: ErrorCode | null;
  docs: string;
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
  // MODIS reports a numeric 0-100 confidence rather than the VIIRS
  // low/nominal/high code. Preserve the percentage, but do not invent a
  // categorical cutoff: NASA notes that an optimal cutoff is application-
  // specific.
  const numeric = finiteNumber(normalized);
  if (numeric !== null && numeric >= 0 && numeric <= 100) {
    return { code: "u", label: `${numeric}%` };
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

async function readResponseTextLimited(
  response: Response,
  maxBytes = MAX_CSV_RESPONSE_BYTES,
) {
  const declaredLength = finiteNumber(
    response.headers.get("content-length") ?? undefined,
  );
  if (declaredLength !== null && declaredLength > maxBytes) {
    throw new UpstreamError(
      "invalid_response",
      "FIRMS response exceeded the size limit",
    );
  }

  if (response.body === null) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let body = "";
  let receivedBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // Preserve the bounded-response classification even if the stream
          // has already failed while being cancelled.
        }
        throw new UpstreamError(
          "invalid_response",
          "FIRMS response exceeded the size limit",
        );
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    return body;
  } finally {
    reader.releaseLock();
  }
}

function detectionsFromCsv(
  body: string,
  dataset: DatasetConfig,
  nowMs: number,
  date: string | null,
) {
  const fromMs = date
    ? Date.parse(`${date}T00:00:00Z`)
    : nowMs - MAX_AGE_HOURS * 60 * 60 * 1000;
  const toMs = date
    ? Math.min(fromMs + 24 * 60 * 60 * 1000, nowMs)
    : nowMs;

  return parseCsv(body)
    .map((row): ThermalDetection | null => {
      const lat = finiteNumber(row.latitude);
      const lon = finiteNumber(row.longitude);
      const observedAt = acquisitionTime(row.acq_date, row.acq_time);
      // The Europe download is intentionally filtered again here. Never
      // expose rows merely because the public file's regional label says
      // Europe, and apply the same bounds check to Area API responses.
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
      if (observedMs < fromMs || observedMs > toMs) return null;

      const satellite = row.satellite || dataset.id;
      const confidenceValue = confidence(row.confidence);
      const incidentDistanceKm = distanceKm(INCIDENT, { lat, lon });
      const scanKm = finiteNumber(row.scan);
      const trackKm = finiteNumber(row.track);
      const passId = [dataset.id, satellite, observedAt].join("::");

      return {
        id: [
          dataset.id,
          satellite,
          observedAt,
          lat.toFixed(5),
          lon.toFixed(5),
          scanKm?.toFixed(3) ?? "scan-unknown",
          trackKm?.toFixed(3) ?? "track-unknown",
        ].join("::"),
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
        scanKm,
        trackKm,
        daynight: row.daynight || null,
        distanceFromIncidentKm: Number(incidentDistanceKm.toFixed(2)),
        bearingFromIncidentDeg: Number(
          bearingDegrees(INCIDENT, { lat, lon }).toFixed(1),
        ),
        scope: incidentDistanceKm <= INCIDENT.radiusKm ? "incident" : "regional",
      };
    })
    .filter((detection): detection is ThermalDetection => detection !== null);
}

function latestObservation(records: ThermalDetection[]) {
  return records
    .map((record) => record.observedAt)
    .sort()
    .at(-1) ?? null;
}

async function fetchDatasetSource(
  sourceId: DeliverySourceId,
  url: string,
  docs: string,
  dataset: DatasetConfig,
  nowMs: number,
  date: string | null,
): Promise<DatasetSourceResult> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    FIRMS_SOURCE_TIMEOUT_MS,
  );

  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { Accept: "text/csv" },
      signal: controller.signal,
    });
    const body = await readResponseTextLimited(response);
    const preamble = body.slice(0, 500).toLowerCase();

    if (
      sourceId === "area-api" &&
      (response.status === 401 ||
        response.status === 403 ||
        /invalid map.?key|map.?key.*invalid/.test(preamble))
    ) {
      throw new UpstreamError("key_rejected", "FIRMS rejected the MAP_KEY");
    }
    if (
      sourceId === "area-api" &&
      (response.status === 429 ||
        /transaction limit|quota|too many requests/.test(preamble))
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

    const records = detectionsFromCsv(body, dataset, nowMs, date);

    return {
      id: sourceId,
      status: "ok",
      records,
      latestObservedAt: latestObservation(records),
      errorCode: null,
      docs,
    };
  } catch (error) {
    return {
      id: sourceId,
      status: "error",
      records: [],
      latestObservedAt: null,
      errorCode: errorCode(error),
      docs,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function unavailableSource(
  id: DeliverySourceId,
  status: Extract<DeliverySourceStatus, "unconfigured" | "not-applicable">,
  error: ErrorCode | null,
  docs: string,
): DatasetSourceResult {
  return {
    id,
    status,
    records: [],
    latestObservedAt: null,
    errorCode: error,
    docs,
  };
}

function combineDatasetSources(
  dataset: DatasetConfig,
  sources: DatasetSourceResult[],
): DatasetResult {
  const available = sources.filter((source) => source.status === "ok");
  const applicable = sources.filter(
    (source) => source.status !== "not-applicable",
  );
  const records = available
    .flatMap((source) => source.records)
    .filter(
      (record, index, rows) =>
        rows.findIndex((candidate) => candidate.id === record.id) === index,
    );
  const area = sources.find((source) => source.id === "area-api");
  const download = sources.find(
    (source) => source.id === "europe-24h-download",
  );
  const areaRecordIds = new Set(area?.records.map((record) => record.id) ?? []);
  const supplementalRecordCount =
    download?.records.filter((record) => !areaRecordIds.has(record.id)).length ??
    0;
  const areaLatestMs = area?.latestObservedAt
    ? Date.parse(area.latestObservedAt)
    : null;
  const downloadLatestMs = download?.latestObservedAt
    ? Date.parse(download.latestObservedAt)
    : null;
  const lagMinutesRecovered =
    areaLatestMs !== null &&
    downloadLatestMs !== null &&
    downloadLatestMs > areaLatestMs
      ? Math.round((downloadLatestMs - areaLatestMs) / 60_000)
      : null;
  const status: DatasetStatus =
    available.length > 0
      ? "ok"
      : applicable.every((source) => source.status === "unconfigured")
        ? "unconfigured"
        : "error";
  const firstFailure =
    applicable.find((source) => source.status === "error") ??
    applicable.find((source) => source.status === "unconfigured");

  return {
    id: dataset.id,
    label: dataset.label,
    status,
    records,
    latestObservedAt: latestObservation(records),
    errorCode: status === "ok" ? null : (firstFailure?.errorCode ?? null),
    degraded:
      available.length > 0 &&
      applicable.some((source) => source.status !== "ok"),
    fallbackUsed:
      download?.status === "ok" &&
      (area?.status !== "ok" || supplementalRecordCount > 0),
    supplementalRecordCount,
    lagMinutesRecovered,
    sources,
  };
}

async function fetchDataset(
  mapKey: string | null,
  dataset: DatasetConfig,
  nowMs: number,
  date: string | null,
): Promise<DatasetResult> {
  const area = `${BOUNDS.west},${BOUNDS.south},${BOUNDS.east},${BOUNDS.north}`;
  // Live mode queries two UTC dates, then enforces an exact rolling 24-hour
  // window. Historical mode remains anchored to one UTC calendar day.
  const range = date ? `1/${date}` : "2";
  const areaSource = mapKey
    ? fetchDatasetSource(
        "area-api",
        `${FIRMS_AREA_ENDPOINT}/${encodeURIComponent(mapKey)}/${dataset.id}/${area}/${range}`,
        FIRMS_DOCS,
        dataset,
        nowMs,
        date,
      )
    : Promise.resolve(
        unavailableSource("area-api", "unconfigured", "key_missing", FIRMS_DOCS),
      );
  // The Europe file is a current rolling 24-hour product, not an archive. It
  // must never be used to fill a date-qualified historical response.
  const downloadSource = date
    ? Promise.resolve(
        unavailableSource(
          "europe-24h-download",
          "not-applicable",
          null,
          FIRMS_ACTIVE_FIRE_DOWNLOADS,
        ),
      )
    : fetchDatasetSource(
        "europe-24h-download",
        dataset.europe24hUrl,
        dataset.europe24hUrl,
        dataset,
        nowMs,
        null,
      );
  const sources = await Promise.all([areaSource, downloadSource]);
  return combineDatasetSources(dataset, sources);
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
  const lastByPlatform = new Map<
    string,
    { observedMs: number; passId: string }
  >();

  return [...detections]
    .sort((left, right) => {
      if (left.product !== right.product) {
        return left.product.localeCompare(right.product);
      }
      if (left.satellite !== right.satellite) {
        return left.satellite.localeCompare(right.satellite);
      }
      return Date.parse(left.observedAt) - Date.parse(right.observedAt);
    })
    .map((detection) => {
      const observedMs = Date.parse(detection.observedAt);
      const platformKey = `${detection.product}::${detection.satellite}`;
      const previous = lastByPlatform.get(platformKey);
      const samePass =
        previous &&
        observedMs - previous.observedMs <= PASS_GAP_MINUTES * 60_000;
      const passId = samePass
        ? previous.passId
        : `${platformKey}::${detection.observedAt}`;
      lastByPlatform.set(platformKey, { observedMs, passId });
      return { ...detection, passId };
    })
    .sort(
      (left, right) =>
        Date.parse(right.observedAt) - Date.parse(left.observedAt),
    );
}

function responseHeaders(
  completedHistoricalDay: boolean,
  status: ThermalStatus,
): Record<string, string> {
  if (status === "unconfigured" || status === "upstream-error") {
    return { "Cache-Control": "no-store" };
  }
  // Cache a historical UTC day for longer only after the documented global
  // NRT latency window has elapsed and every applicable source succeeded.
  // Partial or still-settling responses keep the short live policy.
  return {
    "Cache-Control": completedHistoricalDay && status === "ok"
      ? "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400"
      : "public, max-age=15, s-maxage=120, stale-while-revalidate=180",
    "X-Firewatch-Cacheable": "1",
  };
}

export async function GET(request: Request) {
  const requestStartedAt = new Date().toISOString();
  const nowMs = Date.now();
  const mapKey = process.env.FIRMS_MAP_KEY?.trim() || null;

  const searchParams = new URL(request.url).searchParams;
  if (
    searchParams.size > 1 ||
    (searchParams.size === 1 && !searchParams.has("date"))
  ) {
    return Response.json(
      {
        error: "unsupported_query",
        message: "The thermal endpoint accepts only one optional date parameter.",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const rawDate = searchParams.get("date");
  let date: string | null = null;
  if (rawDate !== null) {
    const todayUtc = new Date(nowMs).toISOString().slice(0, 10);
    const parsedDateMs = Date.parse(`${rawDate}T00:00:00Z`);
    const valid =
      /^\d{4}-\d{2}-\d{2}$/.test(rawDate) &&
      !Number.isNaN(parsedDateMs) &&
      new Date(parsedDateMs).toISOString().slice(0, 10) === rawDate &&
      rawDate >= INCIDENT_START_UTC_DATE &&
      rawDate <= todayUtc;
    if (!valid) {
      return Response.json(
        {
          error: "invalid_date",
          message: `date must be a UTC calendar day between ${INCIDENT_START_UTC_DATE} and ${todayUtc}`,
        },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    date = rawDate;
  }
  const dayStartMs = date ? Date.parse(`${date}T00:00:00Z`) : null;
  const completedHistoricalDay =
    dayStartMs !== null &&
    dayStartMs +
      (24 + GLOBAL_NRT_LATENCY_MAX_HOURS) * 60 * 60 * 1000 <=
      nowMs;

  const query = {
    bounds: BOUNDS,
    incidentCenter: { lat: INCIDENT.lat, lon: INCIDENT.lon },
    incidentRadiusKm: INCIDENT.radiusKm,
    mode: date ? ("historical" as const) : ("live" as const),
    date,
    from:
      dayStartMs !== null
        ? new Date(dayStartMs).toISOString()
        : new Date(nowMs - MAX_AGE_HOURS * 60 * 60 * 1000).toISOString(),
    to:
      dayStartMs !== null
        ? new Date(
            Math.min(dayStartMs + 24 * 60 * 60 * 1000, nowMs),
          ).toISOString()
        : new Date(nowMs).toISOString(),
    maxAgeHours: MAX_AGE_HOURS,
  };

  const results = await Promise.all(
    DATASETS.map((dataset) => fetchDataset(mapKey, dataset, nowMs, date)),
  );
  const successful = results.filter((result) => result.status === "ok");
  const failed = results.filter((result) => result.status !== "ok");
  const degraded = results.filter((result) => result.degraded);
  const status: ThermalStatus =
    successful.length === DATASETS.length && degraded.length === 0
      ? "ok"
      : successful.length > 0
        ? "partial"
        : failed.every((result) => result.status === "unconfigured")
          ? "unconfigured"
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
    .map(([id, records]) => {
      const first = records[0];
      if (first === undefined) {
        throw new Error(`Internal error: thermal pass ${id} has no records`);
      }
      const frpValues = records
        .map((record) => record.frpMw)
        .filter((value): value is number => value !== null);
      const incidentRecordCount = records.filter(
        (record) => record.scope === "incident",
      ).length;
      return {
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
      };
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
        configured: mapKey !== null,
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
      complete: failed.length === 0 && degraded.length === 0,
      datasets: results.map((result) => ({
        id: result.id,
        label: result.label,
        status: result.status,
        records: result.records.length,
        latestObservedAt: result.latestObservedAt,
        errorCode: result.errorCode,
        degraded: result.degraded,
        provenance: {
          selectedSources: result.sources
            .filter((source) => source.status === "ok")
            .map((source) => source.id),
          fallbackUsed: result.fallbackUsed,
          supplementalRecordCount: result.supplementalRecordCount,
          lagMinutesRecovered: result.lagMinutesRecovered,
          sources: result.sources.map((source) => ({
            id: source.id,
            status: source.status,
            records: source.records.length,
            latestObservedAt: source.latestObservedAt,
            errorCode: source.errorCode,
            docs: source.docs,
          })),
        },
      })),
      summary: {
        incidentRecords: incidentDetections.length,
        regionalRecords: detections.length - incidentDetections.length,
        passCount: passes.filter((pass) => pass.incidentRecordCount > 0).length,
        byConfidence: confidenceCounts(incidentDetections),
      },
      passes,
      detections,
      errors: results.flatMap((result) =>
        result.sources
          .filter(
            (source) =>
              source.status === "error" || source.status === "unconfigured",
          )
          .map((source) => ({
            code: source.errorCode,
            dataset: result.id,
            deliverySource: source.id,
            message: `${result.label} ${source.id} unavailable`,
          })),
      ),
      source: {
        name: "NASA FIRMS",
        docs: FIRMS_DOCS,
        downloads: FIRMS_ACTIVE_FIRE_DOWNLOADS,
        semantics: FIRMS_VIIRS_DOCS,
        modisSemantics: FIRMS_MODIS_DOCS,
        appPollSeconds: 120,
        upstreamRefreshMinutes: 15,
        globalNrtLatencyMaxHours: GLOBAL_NRT_LATENCY_MAX_HOURS,
        observationCadenceNote:
          "Orbital snapshots; VIIRS and MODIS typically provide several looks per day, not a continuous live feed.",
      },
    },
    { headers: responseHeaders(completedHistoricalDay, status) },
  );
}
