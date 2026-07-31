import { describe, expect, it, vi } from "vitest";

import { parseAreaCellKey } from "../lib/firewatch/map-context";
import {
  readNearbyIncidentRows,
  sanitizeIncidentDisplayNames,
  type NearbyIncidentReadRow,
} from "../lib/supabase/global-discovery-read-model";

const CELL = parseAreaCellKey("wm/10/587/391");
if (CELL === null) throw new Error("Fixture cell is invalid");

const ENVIRONMENT = {
  url: "https://project.supabase.co",
  publishableKey: "sb_publishable_test_value_1234567890",
} as const;
const DISCOVERY_KEY = `sb_secret_${"a".repeat(48)}`;

function row(
  id: string,
  knownAt: string,
  defaultTimeZone = "Europe/Athens",
  resolvedTimeZone = defaultTimeZone,
): NearbyIncidentReadRow {
  return {
    incident_id: id,
    contract_version: "1.1.0",
    slug: `incident-${id.slice(-3)}`,
    name: "Wildfire incident",
    localized_names: { "el-GR": "Πυρκαγιά" },
    default_timezone: defaultTimeZone,
    incident_kind: "wildfire",
    lifecycle: "monitoring",
    started_at: null,
    started_date: null,
    started_precision: "unknown",
    started_timezone: null,
    latest_observed_at: "2026-07-31T11:45:00.000Z",
    latest_observed_date: null,
    latest_observed_precision: "exact",
    latest_observed_timezone: null,
    item_known_at: knownAt,
    resolved_scope_timezone: resolvedTimeZone,
  };
}

const INPUT = {
  cell: CELL,
  observedFrom: "2026-07-24T12:00:00.000Z",
  asOf: "2026-07-31T12:00:00.000Z",
  knownAt: "2026-07-31T12:05:00.000Z",
  scopeTimeZone: "Europe/Athens",
  limit: 51,
} as const;

describe("Supabase v3 Nearby read model", () => {
  it("calls only the allowlisted RPC with bounded, credential-safe fields", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const endpoint = new URL(String(input));
      expect(endpoint.pathname).toBe("/rest/v1/rpc/nearby_incidents_v3");
      expect(Object.fromEntries(endpoint.searchParams)).toEqual({
        p_z: "10",
        p_x: "587",
        p_y: "391",
        p_observed_from: INPUT.observedFrom,
        p_as_of: INPUT.asOf,
        p_known_at: INPUT.knownAt,
        p_limit: "51",
        p_scope_timezone: "Europe/Athens",
      });
      const headers = new Headers(init?.headers);
      expect(headers.get("apikey")).toBe(DISCOVERY_KEY);
      expect(headers.has("authorization")).toBe(false);
      expect(init).toMatchObject({ method: "GET", cache: "no-store" });
      return Response.json([
        row(
          "01900000-0000-7000-8000-000000000102",
          "2026-07-31T11:58:00.000Z",
        ),
      ]);
    });

    const result = await readNearbyIncidentRows(INPUT, {
      environment: ENVIRONMENT,
      fetchImpl,
      apiKey: DISCOVERY_KEY,
    });
    expect(result).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("rejects unordered, duplicate, future, or inconsistent-scope rows", async () => {
    const first = row(
      "01900000-0000-7000-8000-000000000101",
      "2026-07-31T11:57:00.000Z",
    );
    const later = row(
      "01900000-0000-7000-8000-000000000102",
      "2026-07-31T11:58:00.000Z",
    );
    const cases = [
      [first, later],
      [first, first],
      [
        row(
          "01900000-0000-7000-8000-000000000103",
          "2026-07-31T12:06:00.000Z",
        ),
      ],
      [
        row(
          "01900000-0000-7000-8000-000000000104",
          "2026-07-31T11:56:00.000Z",
          "Europe/Paris",
          "Europe/Paris",
        ),
      ],
    ];

    for (const rows of cases) {
      await expect(
        readNearbyIncidentRows(INPUT, {
          environment: ENVIRONMENT,
          fetchImpl: async () => Response.json(rows),
          apiKey: DISCOVERY_KEY,
        }),
      ).rejects.toMatchObject({ code: "invalid_response" });
    }
  });

  it("retains an exact cross-zone incident in one resolved display scope", async () => {
    const crossZone = row(
      "01900000-0000-7000-8000-000000000105",
      "2026-07-31T11:56:00.123Z",
      "Europe/Paris",
      "Europe/Athens",
    );
    await expect(
      readNearbyIncidentRows(INPUT, {
        environment: ENVIRONMENT,
        apiKey: DISCOVERY_KEY,
        fetchImpl: async () => Response.json([crossZone]),
      }),
    ).resolves.toEqual([crossZone]);
  });

  it("fails closed when the scoped reader token is absent", async () => {
    vi.stubEnv("SUPABASE_DISCOVERY_READER_KEY", "");
    await expect(
      readNearbyIncidentRows(INPUT, {
        environment: ENVIRONMENT,
        fetchImpl: async () => Response.json([]),
      }),
    ).rejects.toThrow("not configured");
    vi.unstubAllEnvs();
  });

  it("bounds and sanitizes localized display names", () => {
    const names = sanitizeIncidentDisplayNames({
      name: "Canonical incident name",
      localized_names: {
        "el-GR": "  Ελληνικό όνομα  ",
        "bad tag!": "not exposed",
        und: "cannot replace canonical",
        fr: "Nom français",
        es: "Nombre español",
        de: "Deutscher Name",
        it: "Nome italiano",
        pt: "Nome português",
      },
    });
    expect(names.und).toBe("Canonical incident name");
    expect(names["el-GR"]).toBe("Ελληνικό όνομα");
    expect(names).not.toHaveProperty("bad tag!");
    expect(Object.keys(names)).toHaveLength(6);
  });
});
