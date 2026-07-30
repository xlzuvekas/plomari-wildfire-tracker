import { describe, expect, it } from "vitest";

import {
  SOURCE_REGISTRY,
  validateSourceRegistry,
} from "../../lib/truth/source-registry";
import {
  adapterFixtureSchema,
  adapterNames,
  replayAdapterFixture,
} from "../../lib/truth/v1";
import { ADAPTER_FIXTURES } from "../fixtures/adapter-fixtures";
import { IDS } from "../fixtures/canonical-entities";

const failureScenarios = new Set([
  "timeout",
  "authentication",
  "quota",
  "malformed_payload",
]);

function fixtureById(id: string) {
  const fixture = ADAPTER_FIXTURES.find((candidate) => candidate.id === id);
  if (!fixture) throw new Error(`Missing test fixture ${id}`);
  return fixture;
}

describe("source registry and adapter fixture corpus", () => {
  it("validates the complete source registry", () => {
    expect(validateSourceRegistry()).toEqual([]);
  });

  it("keeps source keys and fixture ids unique", () => {
    expect(new Set(SOURCE_REGISTRY.map((source) => source.key)).size).toBe(
      SOURCE_REGISTRY.length,
    );
    expect(new Set(ADAPTER_FIXTURES.map((fixture) => fixture.id)).size).toBe(
      ADAPTER_FIXTURES.length,
    );
  });

  it("validates every fixture envelope", () => {
    ADAPTER_FIXTURES.forEach((fixture) => {
      expect(() => adapterFixtureSchema.parse(fixture)).not.toThrow();
    });
  });

  it("provides at least one success and failure fixture for every source", () => {
    SOURCE_REGISTRY.forEach((source) => {
      const fixtures = ADAPTER_FIXTURES.filter(
        (fixture) => fixture.sourceKey === source.key,
      );
      expect(
        fixtures.some((fixture) => fixture.scenario === "success"),
        `${source.key} is missing a success fixture`,
      ).toBe(true);
      expect(
        fixtures.some((fixture) => failureScenarios.has(fixture.scenario)),
        `${source.key} is missing a failure fixture`,
      ).toBe(true);
    });
  });

  it("covers every registered adapter family", () => {
    adapterNames.forEach((adapterName) => {
      expect(
        ADAPTER_FIXTURES.some(
          (fixture) => fixture.adapterName === adapterName,
        ),
        `${adapterName} has no fixtures`,
      ).toBe(true);
    });
  });

  it("covers required cross-corpus scenarios", () => {
    const scenarios = new Set<string>(
      ADAPTER_FIXTURES.map((fixture) => fixture.scenario),
    );
    [
      "success",
      "zero_result",
      "correction",
      "malformed_time",
      "future_time",
      "partial_failure",
      "timeout",
      "authentication",
      "quota",
      "malformed_payload",
    ].forEach((scenario) => expect(scenarios.has(scenario)).toBe(true));
  });

  it("contains no authorization headers or obvious secret-bearing URLs", () => {
    ADAPTER_FIXTURES.forEach((fixture) => {
      const headers = Object.keys(fixture.request.headers).map((header) =>
        header.toLowerCase(),
      );
      expect(headers).not.toContain("authorization");
      expect(fixture.request.url).not.toMatch(
        /(?:token|api[_-]?key|bearer)=/i,
      );
    });
  });
});

describe("deterministic fixture replay", () => {
  it("replays each source success fixture into a valid source item", () => {
    SOURCE_REGISTRY.forEach((source) => {
      const fixture = ADAPTER_FIXTURES.find(
        (candidate) =>
          candidate.sourceKey === source.key &&
          candidate.scenario === "success",
      );
      if (!fixture) throw new Error(`Missing ${source.key} success fixture`);

      const result = replayAdapterFixture(fixture, {
        sourceItemId: IDS.sourceItem,
        priorSourceItem: null,
        recordedAt: "2026-07-30T00:30:01Z",
      });
      expect(result.semanticDelta).toBe("created");
      expect(result.sourceItem?.sourceKey).toBe(source.key);
      expect(result.contentHash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  it("replaying an identical FIRMS fixture 100 times creates no delta", () => {
    const fixture = fixtureById("firms-noaa20-success");
    const first = replayAdapterFixture(fixture, {
      sourceItemId: IDS.sourceItem,
      priorSourceItem: null,
      recordedAt: "2026-07-30T00:30:01Z",
    });
    expect(first.sourceItem).not.toBeNull();

    for (let replay = 0; replay < 100; replay += 1) {
      const repeated = replayAdapterFixture(fixture, {
        sourceItemId: IDS.sourceItem,
        priorSourceItem: {
          id: IDS.sourceItem,
          versionNumber: 1,
          contentHash: first.contentHash!,
        },
        recordedAt: "2026-07-30T00:30:01Z",
      });
      expect(repeated.semanticKey).toBe(first.semanticKey);
      expect(repeated.contentHash).toBe(first.contentHash);
      expect(repeated.semanticDelta).toBe("none");
      expect(repeated.sourceItem).toBeNull();
    }
  });

  it("creates an immutable second version for a correction", () => {
    const first = replayAdapterFixture(
      fixtureById("fire-service-board-success"),
      {
        sourceItemId: IDS.sourceItem,
        priorSourceItem: null,
        recordedAt: "2026-07-30T00:30:01Z",
      },
    );
    const corrected = replayAdapterFixture(
      fixtureById("fire-service-board-correction"),
      {
        sourceItemId: "0198a1b2-c3d4-7e5f-8a9b-001122334412",
        priorSourceItem: {
          id: IDS.sourceItem,
          versionNumber: 1,
          contentHash: first.contentHash!,
        },
        recordedAt: "2026-07-30T00:35:01Z",
      },
    );

    expect(corrected.semanticKey).toBe(first.semanticKey);
    expect(corrected.semanticDelta).toBe("corrected");
    expect(corrected.sourceItem?.versionNumber).toBe(2);
    expect(corrected.sourceItem?.supersedesId).toBe(IDS.sourceItem);
  });

  it("treats a successful zero-row FIRMS response as no detections, not all-clear", () => {
    const result = replayAdapterFixture(
      fixtureById("firms-noaa20-zero-result"),
      {
        sourceItemId: IDS.sourceItem,
        priorSourceItem: null,
        recordedAt: "2026-07-30T00:30:01Z",
      },
    );

    expect(result.ingestionStatus).toBe("success");
    expect(result.sourceItem).toBeNull();
    expect(result.semanticDelta).toBe("none");
    expect(result.protectiveActionCount).toBe(0);
  });

  it("cannot promote a publisher evacuation headline into an official action", () => {
    const publisherFixture = fixtureById("stonisi-evacuation-headline");
    const result = replayAdapterFixture(publisherFixture, {
      sourceItemId: IDS.sourceItem,
      priorSourceItem: null,
      recordedAt: "2026-07-30T00:30:01Z",
    });
    expect(result.protectiveActionCount).toBe(0);

    expect(() =>
      replayAdapterFixture(
        {
          ...publisherFixture,
          expected: {
            ...publisherFixture.expected,
            protectiveActionCount: 1,
          },
        },
        {
          sourceItemId: IDS.sourceItem,
          priorSourceItem: null,
          recordedAt: "2026-07-30T00:30:01Z",
        },
      ),
    ).toThrow(/cannot produce an official protective action/);
  });
});
