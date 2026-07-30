const OPEN_METEO_ENDPOINT = "https://api.open-meteo.com/v1/forecast";
const OPEN_METEO_DOCS = "https://open-meteo.com/en/docs";
const AVIATION_WEATHER_ENDPOINT =
  "https://aviationweather.gov/api/data/metar";
const AVIATION_WEATHER_DOCS = "https://aviationweather.gov/data/api/";

const CURRENT_FIELDS = [
  "temperature_2m",
  "relative_humidity_2m",
  "dew_point_2m",
  "surface_pressure",
  "wind_speed_10m",
  "wind_direction_10m",
  "wind_gusts_10m",
  "wind_speed_80m",
  "wind_direction_80m",
  "wind_speed_120m",
  "wind_direction_120m",
  "wind_speed_180m",
  "wind_direction_180m",
].join(",");

const LOCATIONS = [
  {
    id: "fire",
    label: "Plomari fire area",
    lat: 38.989013,
    lon: 26.382489,
  },
  {
    id: "perama",
    label: "Perama",
    lat: 39.0429,
    lon: 26.50556,
  },
] as const;

type JsonRecord = Record<string, unknown>;

type WindLayer = {
  speedKmh: number | null;
  directionDeg: number | null;
};

type NormalizedLocation = {
  id: string;
  label: string;
  lat: number;
  lon: number;
  provider: "open-meteo";
  modelTime: string | null;
  current: {
    time: string | null;
    tempC: number | null;
    rhPct: number | null;
    dewpointC: number | null;
    pressureHpa: number | null;
    pblM: number | null;
    wind10: WindLayer;
    gustKmh: number | null;
    wind80: WindLayer;
    wind120: WindLayer;
    wind180: WindLayer;
  };
};

type NormalizedMetar = {
  station: "LGMT";
  observedAt: string | null;
  raw: string | null;
  directionDeg: number | null;
  speedKt: number | null;
  gustKt: number | null;
  variableFromDeg?: number;
  variableToDeg?: number;
  tempC: number | null;
  dewpointC: number | null;
  pressureHpa: number | null;
};

class UpstreamHttpError extends Error {
  status: number;

  constructor(status: number) {
    super(`HTTP ${status}`);
    this.name = "UpstreamHttpError";
    this.status = status;
  }
}

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function number(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (
    typeof value === "string" &&
    value.trim() !== "" &&
    Number.isFinite(Number(value))
  ) {
    return Number(value);
  }

  return null;
}

function string(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9_000);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new UpstreamHttpError(response.status);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function nearestBoundaryLayerHeight(
  hourlyValue: unknown,
  currentTime: string | null,
): number | null {
  const hourly = record(hourlyValue);
  const times = list(hourly?.time);
  const heights = list(hourly?.boundary_layer_height);

  if (!currentTime || times.length === 0 || heights.length === 0) {
    return null;
  }

  const currentHour = currentTime.slice(0, 13);
  let index = times.findIndex(
    (value) => string(value)?.slice(0, 13) === currentHour,
  );

  if (index === -1) {
    const target = Date.parse(`${currentTime.replace(/Z$/, "")}Z`);
    let closestDistance = Number.POSITIVE_INFINITY;

    times.forEach((value, candidateIndex) => {
      const time = string(value);
      if (!time) return;
      const candidate = Date.parse(`${time.replace(/Z$/, "")}Z`);
      const distance = Math.abs(candidate - target);
      if (Number.isFinite(distance) && distance < closestDistance) {
        index = candidateIndex;
        closestDistance = distance;
      }
    });
  }

  return index >= 0 ? number(heights[index]) : null;
}

function windLayer(
  current: JsonRecord,
  speedField: string,
  directionField: string,
): WindLayer {
  return {
    speedKmh: number(current[speedField]),
    directionDeg: number(current[directionField]),
  };
}

async function fetchLocation(
  location: (typeof LOCATIONS)[number],
): Promise<NormalizedLocation> {
  const params = new URLSearchParams({
    latitude: String(location.lat),
    longitude: String(location.lon),
    current: CURRENT_FIELDS,
    hourly: "boundary_layer_height",
    forecast_days: "1",
    timezone: "Europe/Athens",
    temperature_unit: "celsius",
    wind_speed_unit: "kmh",
  });
  const payload = record(
    await fetchJson(`${OPEN_METEO_ENDPOINT}?${params.toString()}`),
  );
  const current = record(payload?.current);

  if (!payload || !current) {
    throw new Error("invalid response");
  }

  const time = string(current.time);

  return {
    ...location,
    provider: "open-meteo",
    modelTime: time,
    current: {
      time,
      tempC: number(current.temperature_2m),
      rhPct: number(current.relative_humidity_2m),
      dewpointC: number(current.dew_point_2m),
      pressureHpa: number(current.surface_pressure),
      pblM: nearestBoundaryLayerHeight(payload.hourly, time),
      wind10: windLayer(current, "wind_speed_10m", "wind_direction_10m"),
      gustKmh: number(current.wind_gusts_10m),
      wind80: windLayer(current, "wind_speed_80m", "wind_direction_80m"),
      wind120: windLayer(
        current,
        "wind_speed_120m",
        "wind_direction_120m",
      ),
      wind180: windLayer(
        current,
        "wind_speed_180m",
        "wind_direction_180m",
      ),
    },
  };
}

function isoObservationTime(value: unknown): string | null {
  const unixSeconds = number(value);
  if (unixSeconds !== null) {
    const date = new Date(unixSeconds * 1_000);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  const text = string(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function pressureHpa(value: unknown, raw: string | null): number | null {
  const parsed = number(value);
  if (parsed !== null) {
    return parsed < 100 ? Math.round(parsed * 33.8639 * 10) / 10 : parsed;
  }

  const qnh = raw?.match(/\bQ(\d{4})\b/);
  return qnh ? Number(qnh[1]) : null;
}

function normalizeMetar(value: unknown): NormalizedMetar | null {
  const reports = list(value)
    .map(record)
    .filter((report): report is JsonRecord => report !== null)
    .sort((a, b) => (number(b.obsTime) ?? 0) - (number(a.obsTime) ?? 0));
  const latest = reports[0];

  if (!latest) return null;

  const raw = string(latest.rawOb);
  const variableDirection = raw?.match(/\b(\d{3})V(\d{3})\b/);

  return {
    station: "LGMT",
    observedAt:
      isoObservationTime(latest.obsTime) ??
      isoObservationTime(latest.reportTime),
    raw,
    directionDeg: number(latest.wdir),
    speedKt: number(latest.wspd),
    gustKt: number(latest.wgst),
    ...(variableDirection
      ? {
          variableFromDeg: Number(variableDirection[1]),
          variableToDeg: Number(variableDirection[2]),
        }
      : {}),
    tempC: number(latest.temp),
    dewpointC: number(latest.dewp),
    pressureHpa: pressureHpa(latest.altim, raw),
  };
}

function safeError(source: string, error: unknown): string {
  if (error instanceof UpstreamHttpError) {
    return `${source}: upstream returned HTTP ${error.status}`;
  }
  if (error instanceof Error && error.name === "AbortError") {
    return `${source}: upstream request timed out`;
  }
  return `${source}: upstream data is temporarily unavailable`;
}

export async function GET(request: Request) {
  if (new URL(request.url).searchParams.size > 0) {
    return Response.json(
      {
        error: "unsupported_query",
        message: "The wind endpoint does not accept query parameters.",
      },
      {
        status: 400,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  const errors: string[] = [];
  const [locationResults, metarResult] = await Promise.all([
    Promise.allSettled(LOCATIONS.map((location) => fetchLocation(location))),
    Promise.allSettled([
      fetchJson(
        `${AVIATION_WEATHER_ENDPOINT}?ids=LGMT&format=json&hours=2`,
      ).then(normalizeMetar),
    ]),
  ]);

  const locations: NormalizedLocation[] = [];
  locationResults.forEach((result, index) => {
    if (result.status === "fulfilled") {
      locations.push(result.value);
    } else {
      const location = LOCATIONS[index];
      if (location === undefined) {
        errors.push("Open-Meteo: internal location/result mismatch");
        return;
      }
      errors.push(safeError(`Open-Meteo ${location.label}`, result.reason));
    }
  });

  let metar: NormalizedMetar | null = null;
  const result = metarResult[0];
  if (result.status === "fulfilled") {
    metar = result.value;
    if (!metar) {
      errors.push("AviationWeather LGMT: no recent observation was returned");
    }
  } else {
    errors.push(safeError("AviationWeather LGMT", result.reason));
  }

  return Response.json(
    {
      generatedAt: new Date().toISOString(),
      sources: {
        openMeteo: {
          data: OPEN_METEO_ENDPOINT,
          documentation: OPEN_METEO_DOCS,
        },
        aviationWeather: {
          data: AVIATION_WEATHER_ENDPOINT,
          documentation: AVIATION_WEATHER_DOCS,
        },
      },
      locations,
      metar,
      errors,
    },
    {
      headers: {
        "Cache-Control":
          "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
      },
    },
  );
}
