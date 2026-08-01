import { describe, expect, it, vi } from "vitest";

import { parseAreaCellKey } from "../lib/firewatch/map-context";
import {
  decodeGlobalCandidateCursor,
  encodeGlobalCandidateCursor,
  GLOBAL_CANDIDATE_CURSOR_VERSION,
} from "../lib/firewatch/v3/global-discovery-cursor.server";
import {
  readGlobalCandidateProjectionPage,
  readNearbyIncidentRows,
  sanitizeIncidentDisplayNames,
  type GlobalCandidateProjectionItem,
  type GlobalCandidateProjectionRow,
  type NearbyIncidentReadRow,
} from "../lib/supabase/global-discovery-read-model";

const CELL = (() => {
  const cell = parseAreaCellKey("wm/10/587/391");
  if (cell === null) throw new Error("Fixture cell is invalid");
  return cell;
})();

const ENVIRONMENT = {
  url: "https://project.supabase.co",
  publishableKey: "sb_publishable_test_value_1234567890",
} as const;
const DISCOVERY_KEY = `sb_secret_${"a".repeat(48)}`;
const CURSOR_ENVIRONMENT = {
  SUPABASE_DISCOVERY_READER_KEY: DISCOVERY_KEY,
} as const;
const SNAPSHOT_ID = "01900000-0000-7000-8000-000000000200";
const SNAPSHOT_DIGEST = "b".repeat(64);
const GATE_DIGEST = "c".repeat(64);

const GLOBAL_INPUT = {
  observedFrom: "2026-07-24T12:00:00.000Z",
  asOf: "2026-07-31T12:00:00.000Z",
  knownAt: "2026-07-31T12:05:00.000Z",
  limit: 51,
} as const;

const snapshotFields = {
  snapshot_id: SNAPSHOT_ID,
  snapshot_as_of: GLOBAL_INPUT.asOf,
  snapshot_known_at: GLOBAL_INPUT.knownAt,
  snapshot_observed_from: GLOBAL_INPUT.observedFrom,
  snapshot_digest: SNAPSHOT_DIGEST,
  publication_gate_digest: GATE_DIGEST,
} as const;

function snapshotRow(): GlobalCandidateProjectionRow {
  return {
    row_kind: "snapshot",
    ...snapshotFields,
    candidate_id: null,
    cell_key: null,
    display_timezone: null,
    signal_kinds: null,
    observation_count: null,
    source_count: null,
    first_observed_at: null,
    latest_observed_at: null,
    item_known_at: null,
  };
}

function candidateRow(
  id: string,
  knownAt: string,
): GlobalCandidateProjectionItem {
  return {
    row_kind: "candidate",
    ...snapshotFields,
    candidate_id: id,
    cell_key: CELL.cellKey,
    display_timezone: "Europe/Athens",
    signal_kinds: ["thermal_detection"],
    observation_count: 2,
    source_count: 1,
    first_observed_at: "2026-07-31T11:40:00.000Z",
    latest_observed_at: "2026-07-31T11:55:00.000Z",
    item_known_at: knownAt,
  };
}

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

describe("Supabase v3 global candidate read model", () => {
  it("reads one bounded immutable projection through only the scoped RPC", async () => {
    const item = candidateRow(
      "01900000-0000-7000-8000-000000000201",
      "2026-07-31T12:04:00.000Z",
    );
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const endpoint = new URL(String(input));
      expect(endpoint.pathname).toBe(
        "/rest/v1/rpc/explore_candidate_cells_v3",
      );
      expect(Object.fromEntries(endpoint.searchParams)).toEqual({
        p_observed_from: GLOBAL_INPUT.observedFrom,
        p_as_of: GLOBAL_INPUT.asOf,
        p_known_at: GLOBAL_INPUT.knownAt,
        p_limit: "51",
      });
      const headers = new Headers(init?.headers);
      expect(headers.get("apikey")).toBe(DISCOVERY_KEY);
      expect(headers.has("authorization")).toBe(false);
      expect(init).toMatchObject({ method: "GET", cache: "no-store" });
      return Response.json([snapshotRow(), item]);
    });

    await expect(
      readGlobalCandidateProjectionPage(GLOBAL_INPUT, {
        environment: ENVIRONMENT,
        fetchImpl,
        apiKey: DISCOVERY_KEY,
      }),
    ).resolves.toEqual({
      snapshot: snapshotFields,
      candidates: [item],
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("keeps no snapshot distinct from a published empty snapshot", async () => {
    await expect(
      readGlobalCandidateProjectionPage(GLOBAL_INPUT, {
        environment: ENVIRONMENT,
        apiKey: DISCOVERY_KEY,
        fetchImpl: async () => Response.json([]),
      }),
    ).resolves.toEqual({ snapshot: null, candidates: [] });
    await expect(
      readGlobalCandidateProjectionPage(GLOBAL_INPUT, {
        environment: ENVIRONMENT,
        apiKey: DISCOVERY_KEY,
        fetchImpl: async () => Response.json([snapshotRow()]),
      }),
    ).resolves.toEqual({ snapshot: snapshotFields, candidates: [] });
  });

  it("fails closed without the named discovery-reader key", async () => {
    vi.stubEnv("SUPABASE_DISCOVERY_READER_KEY", "");
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json([]));
    await expect(
      readGlobalCandidateProjectionPage(GLOBAL_INPUT, {
        environment: ENVIRONMENT,
        fetchImpl,
      }),
    ).rejects.toThrow("not configured");
    expect(fetchImpl).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("binds continuation reads to the immutable snapshot and last tuple", async () => {
    const continuation = {
      snapshotId: SNAPSHOT_ID,
      snapshotDigest: SNAPSHOT_DIGEST,
      publicationGateDigest: GATE_DIGEST,
      afterItemKnownAt: "2026-07-31T12:03:00.000Z",
      afterCandidateId: "01900000-0000-7000-8000-000000000203",
    } as const;
    const item = candidateRow(
      "01900000-0000-7000-8000-000000000202",
      "2026-07-31T12:02:00.000Z",
    );
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      expect(Object.fromEntries(new URL(String(input)).searchParams)).toEqual({
        p_observed_from: GLOBAL_INPUT.observedFrom,
        p_as_of: GLOBAL_INPUT.asOf,
        p_known_at: GLOBAL_INPUT.knownAt,
        p_limit: "51",
        p_snapshot_id: SNAPSHOT_ID,
        p_snapshot_digest: SNAPSHOT_DIGEST,
        p_publication_gate_digest: GATE_DIGEST,
        p_after_item_known_at: continuation.afterItemKnownAt,
        p_after_candidate_id: continuation.afterCandidateId,
      });
      return Response.json([snapshotRow(), item]);
    });
    await expect(
      readGlobalCandidateProjectionPage(
        { ...GLOBAL_INPUT, continuation },
        {
          environment: ENVIRONMENT,
          apiKey: DISCOVERY_KEY,
          fetchImpl,
        },
      ),
    ).resolves.toMatchObject({ candidates: [item] });
  });

  it("maps an exact continuation snapshot mismatch without exposing details", async () => {
    await expect(
      readGlobalCandidateProjectionPage(
        {
          ...GLOBAL_INPUT,
          continuation: {
            snapshotId: SNAPSHOT_ID,
            snapshotDigest: SNAPSHOT_DIGEST,
            publicationGateDigest: GATE_DIGEST,
            afterItemKnownAt: "2026-07-31T12:03:00.000Z",
            afterCandidateId: "01900000-0000-7000-8000-000000000203",
          },
        },
        {
          environment: ENVIRONMENT,
          apiKey: DISCOVERY_KEY,
          fetchImpl: async () =>
            Response.json(
              {
                code: "22023",
                details: "firewatch_snapshot_changed_v1",
                message: "internal message is not part of the public contract",
              },
              { status: 400 },
            ),
        },
      ),
    ).rejects.toMatchObject({ code: "snapshot_changed" });
  });

  it("rejects missing sentinels, cutoff drift, and invalid keyset rows", async () => {
    const first = candidateRow(
      "01900000-0000-7000-8000-000000000201",
      "2026-07-31T12:02:00.000Z",
    );
    const later = candidateRow(
      "01900000-0000-7000-8000-000000000202",
      "2026-07-31T12:03:00.000Z",
    );
    const driftedSnapshot = {
      ...snapshotRow(),
      snapshot_known_at: "2026-07-31T12:04:00.000Z",
    };
    const microsecondTuple = {
      ...first,
      item_known_at: "2026-07-31T12:02:00.000123Z",
    };
    for (const rows of [
      [first],
      [driftedSnapshot],
      [snapshotRow(), first, later],
      [snapshotRow(), first, first],
      [snapshotRow(), microsecondTuple],
    ]) {
      await expect(
        readGlobalCandidateProjectionPage(GLOBAL_INPUT, {
          environment: ENVIRONMENT,
          apiKey: DISCOVERY_KEY,
          fetchImpl: async () => Response.json(rows),
        }),
      ).rejects.toMatchObject({ code: "invalid_response" });
    }
  });

  it("uses a compact single-segment HMAC cursor bound to cutoffs and limit", () => {
    const payload = {
      version: GLOBAL_CANDIDATE_CURSOR_VERSION,
      asOf: GLOBAL_INPUT.asOf,
      knownAt: GLOBAL_INPUT.knownAt,
      limit: 50,
      snapshotId: SNAPSHOT_ID,
      snapshotDigest: SNAPSHOT_DIGEST,
      publicationGateDigest: GATE_DIGEST,
      afterItemKnownAt: "2026-07-31T12:04:00.000Z",
      afterCandidateId: "01900000-0000-7000-8000-000000000201",
    } as const;
    const token = encodeGlobalCandidateCursor(payload, CURSOR_ENVIRONMENT);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(token).not.toContain(".");
    expect(token.length).toBeLessThanOrEqual(512);
    expect(
      decodeGlobalCandidateCursor(
        token,
        {
          asOf: GLOBAL_INPUT.asOf,
          knownAt: GLOBAL_INPUT.knownAt,
          limit: 50,
        },
        CURSOR_ENVIRONMENT,
      ),
    ).toEqual(payload);

    const replacement = token.endsWith("A") ? "B" : "A";
    const tampered = `${token.slice(0, -1)}${replacement}`;
    expect(() =>
      decodeGlobalCandidateCursor(
        tampered,
        {
          asOf: GLOBAL_INPUT.asOf,
          knownAt: GLOBAL_INPUT.knownAt,
          limit: 50,
        },
        CURSOR_ENVIRONMENT,
      ),
    ).toThrow("invalid");
    expect(() =>
      decodeGlobalCandidateCursor(
        token,
        {
          asOf: GLOBAL_INPUT.asOf,
          knownAt: GLOBAL_INPUT.knownAt,
          limit: 49,
        },
        CURSOR_ENVIRONMENT,
      ),
    ).toThrow("invalid");
    expect(() =>
      decodeGlobalCandidateCursor(
        token,
        {
          asOf: GLOBAL_INPUT.asOf,
          knownAt: "2026-07-31T12:05:01.000Z",
          limit: 50,
        },
        CURSOR_ENVIRONMENT,
      ),
    ).toThrow("invalid");
  });
});

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
