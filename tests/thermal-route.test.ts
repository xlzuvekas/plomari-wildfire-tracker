import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "../app/api/thermal/route";

const NOW_MS = Date.parse("2026-07-30T14:00:00Z");
const CSV_HEADER =
  "latitude,longitude,acq_date,acq_time,satellite,confidence,frp,scan,track,daynight,version";

function csv(...rows: string[]) {
  return [CSV_HEADER, ...rows].join("\n");
}

function row({
  date = "2026-07-30",
  time = "0035",
  satellite = "NOAA-20",
  confidence = "n",
  lat = "38.989",
  lon = "26.382",
}: {
  date?: string;
  time?: string;
  satellite?: string;
  confidence?: string;
  lat?: string;
  lon?: string;
} = {}) {
  return `${lat},${lon},${date},${time},${satellite},${confidence},12.5,0.4,0.4,N,2.0NRT`;
}

function datasetId(url: string) {
  if (url.includes("VIIRS_NOAA20_NRT") || url.includes("J1_VIIRS")) {
    return "VIIRS_NOAA20_NRT";
  }
  if (url.includes("VIIRS_NOAA21_NRT") || url.includes("J2_VIIRS")) {
    return "VIIRS_NOAA21_NRT";
  }
  if (url.includes("VIIRS_SNPP_NRT") || url.includes("SUOMI_VIIRS")) {
    return "VIIRS_SNPP_NRT";
  }
  if (url.includes("MODIS_NRT") || url.includes("MODIS_C6_1")) {
    return "MODIS_NRT";
  }
  throw new Error(`Unexpected FIRMS URL in test: ${url}`);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GET /api/thermal", () => {
  it("rejects cache-busting or duplicate query parameters before any upstream call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    for (const url of [
      "http://localhost/api/thermal?nonce=1",
      "http://localhost/api/thermal?date=2026-07-29&date=2026-07-30",
      "http://localhost/api/thermal?date=2026-07-29&nonce=1",
    ]) {
      const response = await GET(new Request(url));
      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("no-store");
      await expect(response.json()).resolves.toMatchObject({
        error: "unsupported_query",
      });
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("merges a fresher official Europe download and adds MODIS without exposing the MAP_KEY", async () => {
    vi.stubEnv("FIRMS_MAP_KEY", "server-only-test-key");
    vi.spyOn(Date, "now").mockReturnValue(NOW_MS);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: Parameters<typeof fetch>[0]) => {
        const url = String(input);
        const dataset = datasetId(url);
        const isDownload = url.includes("/data/active_fire/");

        if (dataset === "VIIRS_NOAA20_NRT") {
          return new Response(
            isDownload
              ? csv(row({ time: "0035" }))
              : csv(
                  row({
                    date: "2026-07-29",
                    time: "2341",
                  }),
                ),
            { headers: { "Content-Type": "text/csv" } },
          );
        }
        if (dataset === "MODIS_NRT") {
          return new Response(
            csv(
              row({
                date: "2026-07-29",
                time: "1406",
                satellite: "Aqua",
                confidence: "95",
              }),
            ),
            { headers: { "Content-Type": "text/csv" } },
          );
        }
        return new Response(csv(), {
          headers: { "Content-Type": "text/csv" },
        });
      }),
    );

    const response = await GET(new Request("http://localhost/api/thermal"));
    const payload = await response.json();
    const noaa20 = payload.datasets.find(
      (dataset: { id: string }) => dataset.id === "VIIRS_NOAA20_NRT",
    );
    const modis = payload.detections.find(
      (detection: { product: string }) => detection.product === "MODIS_NRT",
    );

    expect(payload.status).toBe("ok");
    expect(payload.complete).toBe(true);
    expect(payload.datasets).toHaveLength(4);
    expect(noaa20).toMatchObject({
      status: "ok",
      records: 2,
      latestObservedAt: "2026-07-30T00:35:00Z",
      provenance: {
        fallbackUsed: true,
        supplementalRecordCount: 1,
        lagMinutesRecovered: 54,
        selectedSources: ["area-api", "europe-24h-download"],
      },
    });
    expect(modis).toMatchObject({
      satellite: "Aqua",
      confidenceCode: "u",
      confidence: "95%",
    });
    expect(
      payload.detections.filter(
        (detection: { product: string }) => detection.product === "MODIS_NRT",
      ),
    ).toHaveLength(1);
    expect(JSON.stringify(payload)).not.toContain("server-only-test-key");
  });

  it("keeps distinct satellites and their detecting passes separate", async () => {
    vi.stubEnv("FIRMS_MAP_KEY", "server-only-test-key");
    vi.spyOn(Date, "now").mockReturnValue(NOW_MS);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: Parameters<typeof fetch>[0]) => {
        const url = String(input);
        if (datasetId(url) !== "MODIS_NRT") {
          return new Response(csv(), {
            headers: { "Content-Type": "text/csv" },
          });
        }
        return new Response(
          csv(
            row({ time: "1200", satellite: "Terra", confidence: "95" }),
            row({ time: "1200", satellite: "Aqua", confidence: "95" }),
          ),
          { headers: { "Content-Type": "text/csv" } },
        );
      }),
    );

    const response = await GET(new Request("http://localhost/api/thermal"));
    const payload = await response.json();
    const modisDetections = payload.detections.filter(
      (detection: { product: string }) => detection.product === "MODIS_NRT",
    );
    const modisPasses = payload.passes.filter(
      (pass: { product: string }) => pass.product === "MODIS_NRT",
    );

    expect(modisDetections).toHaveLength(2);
    expect(
      modisDetections
        .map((detection: { satellite: string }) => detection.satellite)
        .sort(),
    ).toEqual(["Aqua", "Terra"]);
    expect(
      new Set(
        modisDetections.map((detection: { id: string }) => detection.id),
      ).size,
    ).toBe(2);
    expect(modisPasses).toHaveLength(2);
    expect(new Set(modisPasses.map((pass: { id: string }) => pass.id)).size)
      .toBe(2);
  });

  it("serves bounded Europe data as a visibly degraded fallback when Area API fails", async () => {
    vi.stubEnv("FIRMS_MAP_KEY", "server-only-test-key");
    vi.spyOn(Date, "now").mockReturnValue(NOW_MS);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: Parameters<typeof fetch>[0]) => {
        const url = String(input);
        if (url.includes("/api/area/csv/")) {
          return new Response("upstream outage", { status: 503 });
        }
        return new Response(
          datasetId(url) === "VIIRS_NOAA20_NRT"
            ? csv(
                row(),
                row({ lat: "40.000", lon: "25.000", time: "0040" }),
              )
            : csv(),
          { headers: { "Content-Type": "text/csv" } },
        );
      }),
    );

    const response = await GET(new Request("http://localhost/api/thermal"));
    const payload = await response.json();
    const noaa20 = payload.datasets.find(
      (dataset: { id: string }) => dataset.id === "VIIRS_NOAA20_NRT",
    );

    expect(payload.status).toBe("partial");
    expect(payload.complete).toBe(false);
    expect(payload.detections).toHaveLength(1);
    expect(noaa20).toMatchObject({
      status: "ok",
      degraded: true,
      provenance: {
        fallbackUsed: true,
        selectedSources: ["europe-24h-download"],
        sources: [
          { id: "area-api", status: "error", errorCode: "upstream_http" },
          { id: "europe-24h-download", status: "ok", errorCode: null },
        ],
      },
    });
    expect(payload.errors).toHaveLength(4);
    expect(payload.errors[0]).toMatchObject({
      deliverySource: "area-api",
      code: "upstream_http",
    });
  });

  it("never substitutes the rolling Europe file into a historical calendar day", async () => {
    vi.stubEnv("FIRMS_MAP_KEY", "server-only-test-key");
    vi.spyOn(Date, "now").mockReturnValue(NOW_MS);
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      expect(url).toContain("/api/area/csv/");
      expect(url).not.toContain("/data/active_fire/");
      return new Response(
        csv(row({ date: "2026-07-29", time: "2341" })),
        { headers: { "Content-Type": "text/csv" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      new Request("http://localhost/api/thermal?date=2026-07-29"),
    );
    const payload = await response.json();

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(payload.status).toBe("ok");
    expect(payload.complete).toBe(true);
    expect(payload.datasets[0].provenance.sources[1]).toMatchObject({
      id: "europe-24h-download",
      status: "not-applicable",
    });
    expect(response.headers.get("cache-control")).toContain("s-maxage=3600");
  });

  it("uses the public server-side fallback in live mode when the key is absent", async () => {
    vi.stubEnv("FIRMS_MAP_KEY", "");
    vi.spyOn(Date, "now").mockReturnValue(NOW_MS);
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      expect(url).toContain("/data/active_fire/");
      return new Response(csv(), {
        headers: { "Content-Type": "text/csv" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("http://localhost/api/thermal"));
    const payload = await response.json();

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(payload.status).toBe("partial");
    expect(payload.credential.configured).toBe(false);
    expect(payload.complete).toBe(false);
    expect(payload.errors).toHaveLength(4);
    expect(
      payload.errors.every(
        (error: { code: string }) => error.code === "key_missing",
      ),
    ).toBe(true);
  });

  it("fails closed on oversized historical responses and never caches the error", async () => {
    vi.stubEnv("FIRMS_MAP_KEY", "server-only-test-key");
    vi.spyOn(Date, "now").mockReturnValue(NOW_MS);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(csv(), {
            headers: { "Content-Length": "2000001" },
          }),
      ),
    );

    const response = await GET(
      new Request("http://localhost/api/thermal?date=2026-07-29"),
    );
    const payload = await response.json();

    expect(payload.status).toBe("upstream-error");
    expect(payload.complete).toBe(false);
    expect(payload.errors).toHaveLength(4);
    expect(
      payload.errors.every(
        (error: { code: string }) => error.code === "invalid_response",
      ),
    ).toBe(true);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
