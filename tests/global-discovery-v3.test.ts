import { describe, expect, expectTypeOf, it } from "vitest";

import {
  GLOBAL_DISCOVERY_MAX_CURSOR_LENGTH,
  GLOBAL_DISCOVERY_POLICY_VERSION,
  GLOBAL_DISCOVERY_SCHEMA_VERSION,
  coarseAreaScopeSchema,
  exploreDiscoveryRequestSchema,
  exploreDiscoveryResponseSchema,
  globalDiscoveryCursorSchema,
  discoveryTimeContextSchema,
  nearbyDiscoveryRequestSchema,
  nearbyDiscoveryResponseForRequestSchema,
  nearbyDiscoveryResponseSchema,
  nearbyIncidentSchema,
  exploreDiscoveryResponseForRequestSchema,
  publicTemporalValueSchema,
  wildfireCandidateSchema,
  type ExploreDiscoveryResponse,
  type GlobalDiscoveryClient,
  type NearbyDiscoveryResponse,
} from "../lib/firewatch/v3";
import {
  SYNTHETIC_GLOBAL_DISCOVERY_FIXTURES,
  SYNTHETIC_MARSEILLE_EXPLORE,
  SYNTHETIC_PARIS_VALID_EMPTY,
  SYNTHETIC_PARIS_WINTER_VALID_EMPTY,
  SYNTHETIC_PLOMARI_NEARBY,
} from "./fixtures/global-discovery-v3";

function copy<Value>(value: Value): Value {
  return structuredClone(value);
}

function franceFixtureText() {
  return JSON.stringify([
    SYNTHETIC_MARSEILLE_EXPLORE,
    SYNTHETIC_PARIS_VALID_EMPTY,
  ]);
}

describe("v3 global discovery contracts", () => {
  it("accepts sanitized Plomari, Marseille, and Paris fixtures", () => {
    expect(
      exploreDiscoveryResponseSchema.parse(SYNTHETIC_MARSEILLE_EXPLORE),
    ).toEqual(SYNTHETIC_MARSEILLE_EXPLORE);
    expect(
      nearbyDiscoveryResponseSchema.parse(SYNTHETIC_PLOMARI_NEARBY),
    ).toEqual(SYNTHETIC_PLOMARI_NEARBY);
    expect(
      nearbyDiscoveryResponseSchema.parse(SYNTHETIC_PARIS_VALID_EMPTY),
    ).toEqual(SYNTHETIC_PARIS_VALID_EMPTY);
    expect(
      nearbyDiscoveryResponseSchema.parse(
        SYNTHETIC_PARIS_WINTER_VALID_EMPTY,
      ),
    ).toEqual(SYNTHETIC_PARIS_WINTER_VALID_EMPTY);
  });

  it("keeps candidates structurally distinct from canonical incidents", () => {
    const candidate = SYNTHETIC_MARSEILLE_EXPLORE.candidates[0];
    const incident = SYNTHETIC_PLOMARI_NEARBY.incidents[0];
    expect(candidate).toBeDefined();
    expect(incident).toBeDefined();
    expect(wildfireCandidateSchema.safeParse(incident).success).toBe(false);
    expect(nearbyIncidentSchema.safeParse(candidate).success).toBe(false);
    expect(
      nearbyDiscoveryResponseSchema.safeParse(
        SYNTHETIC_MARSEILLE_EXPLORE,
      ).success,
    ).toBe(false);
    expect(
      exploreDiscoveryResponseSchema.safeParse(SYNTHETIC_PLOMARI_NEARBY)
        .success,
    ).toBe(false);
    expect(candidate).not.toHaveProperty("incidentId");
    expect(candidate).not.toHaveProperty("lifecycle");
    expect(incident).not.toHaveProperty("candidateId");
    expect(incident).not.toHaveProperty("classification");
    expect(incident).not.toHaveProperty("verification");
  });

  it("represents every coverage state without collapsing result meaning", () => {
    const validEmpty = copy(SYNTHETIC_MARSEILLE_EXPLORE);
    validEmpty.candidates = [];
    validEmpty.result = {
      state: "valid-empty",
      messageCode: "no_known_candidates_in_scope",
      assessment: "candidate_discovery_only",
      allClearAssessment: "not_assessed",
    };

    const stale = copy(SYNTHETIC_MARSEILLE_EXPLORE);
    stale.coverage = {
      state: "stale",
      policyVersion: GLOBAL_DISCOVERY_POLICY_VERSION,
      scope: copy(SYNTHETIC_MARSEILLE_EXPLORE.coverage.scope),
      checkedAt: "2026-07-31T17:04:00.000Z",
      freshnessDeadline: "2026-07-31T16:45:00.000Z",
      coveredEventWindow: {
        from: "2026-07-30T17:00:00.000Z",
        through: "2026-07-31T17:00:00.000Z",
      },
      lastCompleteAt: "2026-07-31T16:30:00.000Z",
      requiredPartitionCount: 3,
      completedPartitionCount: 3,
    };

    const partial = copy(SYNTHETIC_MARSEILLE_EXPLORE);
    partial.coverage = {
      state: "partial",
      policyVersion: GLOBAL_DISCOVERY_POLICY_VERSION,
      scope: copy(SYNTHETIC_MARSEILLE_EXPLORE.coverage.scope),
      checkedAt: "2026-07-31T17:04:00.000Z",
      requiredPartitionCount: 3,
      completedPartitionCount: 2,
    };

    const unavailable = copy(SYNTHETIC_MARSEILLE_EXPLORE);
    unavailable.coverage = {
      state: "unavailable",
      policyVersion: GLOBAL_DISCOVERY_POLICY_VERSION,
      scope: copy(SYNTHETIC_MARSEILLE_EXPLORE.coverage.scope),
      checkedAt: "2026-07-31T17:04:00.000Z",
      retryAfterSeconds: 300,
    };
    unavailable.result = { state: "indeterminate" };
    unavailable.candidates = [];

    const disabled = copy(unavailable);
    disabled.coverage = {
      state: "disabled",
      policyVersion: GLOBAL_DISCOVERY_POLICY_VERSION,
      scope: copy(SYNTHETIC_MARSEILLE_EXPLORE.coverage.scope),
    };

    const unconfigured = copy(unavailable);
    unconfigured.coverage = {
      state: "unconfigured",
      policyVersion: GLOBAL_DISCOVERY_POLICY_VERSION,
      scope: copy(SYNTHETIC_MARSEILLE_EXPLORE.coverage.scope),
    };

    const fixtures = [
      SYNTHETIC_MARSEILLE_EXPLORE,
      validEmpty,
      stale,
      partial,
      unavailable,
      disabled,
      unconfigured,
    ];
    expect(
      fixtures.map((fixture) =>
        exploreDiscoveryResponseSchema.safeParse(fixture).success,
      ),
    ).toEqual([true, true, true, true, true, true, true]);
    expect([
      SYNTHETIC_MARSEILLE_EXPLORE.coverage.state,
      SYNTHETIC_PARIS_VALID_EMPTY.result.state,
      ...fixtures.slice(2).map((fixture) => fixture.coverage.state),
    ]).toEqual([
      "complete",
      "valid-empty",
      "stale",
      "partial",
      "unavailable",
      "disabled",
      "unconfigured",
    ]);
    expect(stale.result.state).toBe("items");
    expect(partial.result.state).toBe("items");
  });

  it("permits valid-empty only for a complete first-page proof", () => {
    const emptyPartial = copy(SYNTHETIC_PARIS_VALID_EMPTY);
    emptyPartial.coverage = {
      state: "partial",
      policyVersion: GLOBAL_DISCOVERY_POLICY_VERSION,
      scope: copy(SYNTHETIC_PARIS_VALID_EMPTY.coverage.scope),
      checkedAt: "2026-07-31T15:04:00.000Z",
      requiredPartitionCount: 3,
      completedPartitionCount: 2,
    };
    expect(
      nearbyDiscoveryResponseSchema.safeParse(emptyPartial).success,
    ).toBe(false);

    emptyPartial.result = { state: "indeterminate" };
    expect(
      nearbyDiscoveryResponseSchema.safeParse(emptyPartial).success,
    ).toBe(true);

    const emptyComplete = copy(SYNTHETIC_PARIS_VALID_EMPTY);
    emptyComplete.result = { state: "indeterminate" };
    expect(
      nearbyDiscoveryResponseSchema.safeParse(emptyComplete).success,
    ).toBe(false);

    const nonemptyValidEmpty = copy(SYNTHETIC_PLOMARI_NEARBY);
    nonemptyValidEmpty.result = copy(SYNTHETIC_PARIS_VALID_EMPTY.result);
    expect(
      nearbyDiscoveryResponseSchema.safeParse(nonemptyValidEmpty).success,
    ).toBe(false);

    const laterPage = copy(SYNTHETIC_PARIS_VALID_EMPTY);
    laterPage.page.isFirstPage = false;
    expect(
      nearbyDiscoveryResponseSchema.safeParse(laterPage).success,
    ).toBe(false);
  });

  it("uses safe machine semantics for the Paris empty result", () => {
    expect(SYNTHETIC_PARIS_VALID_EMPTY.result).toEqual({
      state: "valid-empty",
      messageCode: "no_known_incidents_in_area",
      assessment: "known_incident_discovery_only",
      allClearAssessment: "not_assessed",
    });
    const text = JSON.stringify(SYNTHETIC_PARIS_VALID_EMPTY).toLowerCase();
    expect(text).not.toContain("no_fire");
    expect(text).not.toContain("fire_out");
    expect(text).not.toContain('"safe"');

    const globalEmpty = copy(SYNTHETIC_MARSEILLE_EXPLORE);
    globalEmpty.candidates = [];
    globalEmpty.result = {
      state: "valid-empty",
      messageCode: "no_known_candidates_in_scope",
      assessment: "candidate_discovery_only",
      allClearAssessment: "not_assessed",
    };
    expect(exploreDiscoveryResponseSchema.safeParse(globalEmpty).success).toBe(
      true,
    );
    expect(
      exploreDiscoveryResponseSchema.safeParse({
        ...globalEmpty,
        result: SYNTHETIC_PARIS_VALID_EMPTY.result,
      }).success,
    ).toBe(false);
  });

  it("requires canonical coarse-area geometry and rejects raw location input", () => {
    const scope = copy(SYNTHETIC_PARIS_VALID_EMPTY.scope);
    scope.bounds.west += 0.001;
    expect(coarseAreaScopeSchema.safeParse(scope).success).toBe(false);

    const request = {
      schemaVersion: GLOBAL_DISCOVERY_SCHEMA_VERSION,
      kind: "nearby-incidents",
      cell: SYNTHETIC_PARIS_VALID_EMPTY.scope.cell,
      time: {
        asOf: SYNTHETIC_PARIS_VALID_EMPTY.time.asOf,
        knownAt: SYNTHETIC_PARIS_VALID_EMPTY.time.knownAt,
      },
      page: {},
    };
    expect(nearbyDiscoveryRequestSchema.parse(request).page).toEqual({
      limit: 50,
      after: null,
    });
    expect(
      nearbyDiscoveryRequestSchema.safeParse({
        ...request,
        lat: 48.8566,
        lon: 2.3522,
      }).success,
    ).toBe(false);
    expect(
      nearbyDiscoveryRequestSchema.safeParse({
        ...request,
        cell: "wm/6/1/1",
      }).success,
    ).toBe(false);
    expect(
      nearbyDiscoveryRequestSchema.safeParse({
        ...request,
        cell: "wm/010/0518/0352",
      }).success,
    ).toBe(false);
    expect(
      exploreDiscoveryRequestSchema.safeParse({
        schemaVersion: GLOBAL_DISCOVERY_SCHEMA_VERSION,
        kind: "explore-candidates",
        cell: request.cell,
        time: request.time,
        page: {},
      }).success,
    ).toBe(false);
    expect(
      nearbyDiscoveryRequestSchema.safeParse({
        ...request,
        time: {
          asOf: "2026-07-31T15:06:00.000Z",
          knownAt: "2026-07-31T15:05:00.000Z",
        },
      }).success,
    ).toBe(false);
    expect(
      nearbyDiscoveryRequestSchema.safeParse({
        ...request,
        time: {
          asOf: "2026-07-31T15:00:00Z",
          knownAt: "2026-07-31T15:05:00Z",
        },
      }).success,
    ).toBe(false);

    const globalEmpty = copy(SYNTHETIC_MARSEILLE_EXPLORE);
    globalEmpty.candidates = [];
    globalEmpty.result = {
      state: "valid-empty",
      messageCode: "no_known_candidates_in_scope",
      assessment: "candidate_discovery_only",
      allClearAssessment: "not_assessed",
    };
    expect(exploreDiscoveryResponseSchema.safeParse(globalEmpty).success).toBe(
      true,
    );
    expect(
      exploreDiscoveryResponseSchema.safeParse({
        ...globalEmpty,
        scope: { ...globalEmpty.scope, cells: [] },
      }).success,
    ).toBe(false);
  });

  it("keeps cursors opaque, bounded, and internally consistent", () => {
    const cursor = globalDiscoveryCursorSchema.parse(
      "c3ludGhldGljX2N1cnNvcg",
    );
    expect(globalDiscoveryCursorSchema.safeParse("short").success).toBe(false);
    expect(
      globalDiscoveryCursorSchema.safeParse("a+b/cursor-value").success,
    ).toBe(false);
    expect(
      globalDiscoveryCursorSchema.safeParse(
        "a".repeat(GLOBAL_DISCOVERY_MAX_CURSOR_LENGTH + 1),
      ).success,
    ).toBe(false);

    const paged = copy(SYNTHETIC_MARSEILLE_EXPLORE);
    paged.page = {
      limit: 1,
      isFirstPage: true,
      hasMore: true,
      nextCursor: cursor,
    };
    expect(exploreDiscoveryResponseSchema.safeParse(paged).success).toBe(true);

    paged.page.hasMore = false;
    expect(exploreDiscoveryResponseSchema.safeParse(paged).success).toBe(false);
  });

  it("binds responses to request scope, cutoffs, limit, and cursor position", () => {
    const nearbyRequest = nearbyDiscoveryRequestSchema.parse({
      schemaVersion: GLOBAL_DISCOVERY_SCHEMA_VERSION,
      kind: "nearby-incidents",
      cell: SYNTHETIC_PARIS_VALID_EMPTY.scope.cell,
      time: {
        asOf: SYNTHETIC_PARIS_VALID_EMPTY.time.asOf,
        knownAt: SYNTHETIC_PARIS_VALID_EMPTY.time.knownAt,
      },
      page: {},
    });
    const nearbyBound = nearbyDiscoveryResponseForRequestSchema(nearbyRequest);
    expect(nearbyBound.safeParse(SYNTHETIC_PARIS_VALID_EMPTY).success).toBe(
      true,
    );
    expect(nearbyBound.safeParse(SYNTHETIC_PLOMARI_NEARBY).success).toBe(
      false,
    );

    const wrongScope = copy(SYNTHETIC_PARIS_VALID_EMPTY);
    wrongScope.scope = copy(SYNTHETIC_PLOMARI_NEARBY.scope);
    wrongScope.time.timeZone.id = wrongScope.scope.timeZone;
    wrongScope.time.timeZone.utcOffsetMinutesAtAsOf = 180;
    wrongScope.coverage.scope = copy(
      SYNTHETIC_PLOMARI_NEARBY.coverage.scope,
    );
    expect(nearbyDiscoveryResponseSchema.safeParse(wrongScope).success).toBe(
      true,
    );
    expect(nearbyBound.safeParse(wrongScope).success).toBe(false);

    const wrongCutoff = copy(SYNTHETIC_PARIS_VALID_EMPTY);
    wrongCutoff.time.knownAt = "2026-07-31T15:04:59.000Z";
    expect(nearbyBound.safeParse(wrongCutoff).success).toBe(false);

    const wrongLimit = copy(SYNTHETIC_PARIS_VALID_EMPTY);
    wrongLimit.page.limit = 25;
    expect(nearbyBound.safeParse(wrongLimit).success).toBe(false);

    const cursor = globalDiscoveryCursorSchema.parse(
      "c3ludGhldGljX3NlY29uZF9wYWdl",
    );
    const cursorRequest = nearbyDiscoveryRequestSchema.parse({
      schemaVersion: GLOBAL_DISCOVERY_SCHEMA_VERSION,
      kind: "nearby-incidents",
      cell: SYNTHETIC_PLOMARI_NEARBY.scope.cell,
      time: {
        asOf: SYNTHETIC_PLOMARI_NEARBY.time.asOf,
        knownAt: SYNTHETIC_PLOMARI_NEARBY.time.knownAt,
      },
      page: { after: cursor },
    });
    const laterPage = copy(SYNTHETIC_PLOMARI_NEARBY);
    laterPage.page.isFirstPage = false;
    const cursorBound = nearbyDiscoveryResponseForRequestSchema(cursorRequest);
    expect(cursorBound.safeParse(laterPage).success).toBe(true);
    laterPage.page.isFirstPage = true;
    expect(cursorBound.safeParse(laterPage).success).toBe(false);

    const exploreRequest = exploreDiscoveryRequestSchema.parse({
      schemaVersion: GLOBAL_DISCOVERY_SCHEMA_VERSION,
      kind: "explore-candidates",
      time: {
        asOf: SYNTHETIC_MARSEILLE_EXPLORE.time.asOf,
        knownAt: SYNTHETIC_MARSEILLE_EXPLORE.time.knownAt,
      },
      page: {},
    });
    expect(
      exploreDiscoveryResponseForRequestSchema(exploreRequest).safeParse(
        SYNTHETIC_MARSEILLE_EXPLORE,
      ).success,
    ).toBe(true);
  });

  it("defines and enforces stable keyset ordering", () => {
    const outOfOrder = copy(SYNTHETIC_MARSEILLE_EXPLORE);
    const laterKnownCandidate = copy(outOfOrder.candidates[0]);
    if (!laterKnownCandidate) {
      throw new Error("Synthetic Marseille candidate is missing");
    }
    laterKnownCandidate.candidateId =
      "01900000-0000-7000-8000-000000000202";
    laterKnownCandidate.times.knownAt = "2026-07-31T16:56:00.000Z";
    outOfOrder.candidates.push(laterKnownCandidate);
    expect(
      exploreDiscoveryResponseSchema.safeParse(outOfOrder).success,
    ).toBe(false);

    outOfOrder.candidates.reverse();
    expect(exploreDiscoveryResponseSchema.safeParse(outOfOrder).success).toBe(
      true,
    );

    const uppercaseId = copy(SYNTHETIC_MARSEILLE_EXPLORE);
    const uppercaseCandidate = uppercaseId.candidates[0];
    if (!uppercaseCandidate) {
      throw new Error("Synthetic Marseille candidate is missing");
    }
    uppercaseCandidate.candidateId =
      "01900000-0000-7000-8000-00000000020A";
    expect(
      exploreDiscoveryResponseSchema.safeParse(uppercaseId).success,
    ).toBe(false);
  });

  it("preserves exact, date-only, and unknown public event-time precision", () => {
    expect(
      publicTemporalValueSchema.safeParse({
        precision: "date_only",
        date: "2026-07-31",
      }).success,
    ).toBe(true);
    expect(
      publicTemporalValueSchema.safeParse({ precision: "unknown" }).success,
    ).toBe(true);
    expect(
      publicTemporalValueSchema.safeParse({
        precision: "unknown",
        instant: "2026-07-31T00:00:00.000Z",
      }).success,
    ).toBe(false);

    const dateOnlyCandidate = copy(
      SYNTHETIC_MARSEILLE_EXPLORE.candidates[0],
    );
    if (!dateOnlyCandidate) {
      throw new Error("Synthetic Marseille candidate is missing");
    }
    dateOnlyCandidate.times.firstObservedAt = {
      precision: "date_only",
      date: "2026-07-30",
    };
    dateOnlyCandidate.times.latestObservedAt = {
      precision: "date_only",
      date: "2026-07-31",
    };
    expect(wildfireCandidateSchema.safeParse(dateOnlyCandidate).success).toBe(
      true,
    );
    dateOnlyCandidate.times.firstObservedAt.date = "2026-08-01";
    expect(wildfireCandidateSchema.safeParse(dateOnlyCandidate).success).toBe(
      false,
    );

    const impreciseIncident = copy(SYNTHETIC_PLOMARI_NEARBY.incidents[0]);
    if (!impreciseIncident) {
      throw new Error("Synthetic Plomari incident is missing");
    }
    impreciseIncident.times.startedAt = { precision: "unknown" };
    impreciseIncident.times.latestObservedAt = {
      precision: "date_only",
      date: "2026-07-31",
    };
    expect(nearbyIncidentSchema.safeParse(impreciseIncident).success).toBe(
      true,
    );
  });

  it("enforces event-time, knowledge-time, freshness, and time-zone meaning", () => {
    expect(
      discoveryTimeContextSchema.safeParse({
        ...SYNTHETIC_PARIS_VALID_EMPTY.time,
        asOf: "2026-07-31T15:06:00.000Z",
      }).success,
    ).toBe(false);

    const futureObservation = copy(SYNTHETIC_MARSEILLE_EXPLORE);
    const candidate = futureObservation.candidates[0];
    if (!candidate) throw new Error("Synthetic Marseille candidate is missing");
    candidate.times.latestObservedAt = {
      precision: "exact",
      instant: "2026-07-31T17:01:00.000Z",
    };
    candidate.times.knownAt = "2026-07-31T17:02:00.000Z";
    expect(
      exploreDiscoveryResponseSchema.safeParse(futureObservation).success,
    ).toBe(false);

    const futureDateOnly = copy(SYNTHETIC_MARSEILLE_EXPLORE);
    const dateOnlyCandidate = futureDateOnly.candidates[0];
    if (!dateOnlyCandidate) {
      throw new Error("Synthetic Marseille candidate is missing");
    }
    dateOnlyCandidate.times.latestObservedAt = {
      precision: "date_only",
      date: "2026-08-01",
    };
    expect(
      exploreDiscoveryResponseSchema.safeParse(futureDateOnly).success,
    ).toBe(false);

    const beforeWindow = copy(SYNTHETIC_MARSEILLE_EXPLORE);
    const oldCandidate = beforeWindow.candidates[0];
    if (!oldCandidate) {
      throw new Error("Synthetic Marseille candidate is missing");
    }
    oldCandidate.times.firstObservedAt = {
      precision: "date_only",
      date: "2026-07-28",
    };
    oldCandidate.times.latestObservedAt = {
      precision: "date_only",
      date: "2026-07-29",
    };
    expect(
      exploreDiscoveryResponseSchema.safeParse(beforeWindow).success,
    ).toBe(false);

    const futureKnowledge = copy(SYNTHETIC_PLOMARI_NEARBY);
    const incident = futureKnowledge.incidents[0];
    if (!incident) throw new Error("Synthetic Plomari incident is missing");
    incident.times.knownAt = "2026-07-31T18:06:00.000Z";
    expect(
      nearbyDiscoveryResponseSchema.safeParse(futureKnowledge).success,
    ).toBe(false);

    const expiredComplete = copy(SYNTHETIC_PARIS_VALID_EMPTY);
    if (expiredComplete.coverage.state !== "complete") {
      throw new Error("Synthetic Paris coverage is not complete");
    }
    expiredComplete.coverage.freshnessDeadline =
      "2026-07-31T15:04:30.000Z";
    expect(
      nearbyDiscoveryResponseSchema.safeParse(expiredComplete).success,
    ).toBe(false);

    const invalidZone = copy(SYNTHETIC_PARIS_VALID_EMPTY);
    invalidZone.time.timeZone.id = "Europe/Not_A_Zone";
    expect(
      nearbyDiscoveryResponseSchema.safeParse(invalidZone).success,
    ).toBe(false);

    const wrongZoneBasis = copy(SYNTHETIC_PARIS_VALID_EMPTY);
    wrongZoneBasis.time.timeZone.basis = "display-preference";
    expect(
      nearbyDiscoveryResponseSchema.safeParse(wrongZoneBasis).success,
    ).toBe(false);

    const unboundGlobalPreference = copy(SYNTHETIC_MARSEILLE_EXPLORE);
    unboundGlobalPreference.time.timeZone = {
      id: "Europe/Paris",
      basis: "display-preference",
      utcOffsetMinutesAtAsOf: 120,
    };
    expect(
      exploreDiscoveryResponseSchema.safeParse(unboundGlobalPreference)
        .success,
    ).toBe(false);

    const wrongScopeZone = copy(SYNTHETIC_PARIS_VALID_EMPTY);
    wrongScopeZone.time.timeZone.id = "Europe/Athens";
    expect(
      nearbyDiscoveryResponseSchema.safeParse(wrongScopeZone).success,
    ).toBe(false);

    const invalidWindow = copy(SYNTHETIC_PARIS_VALID_EMPTY);
    invalidWindow.time.observedWindow.to =
      "2026-07-31T14:59:59.000Z";
    expect(
      nearbyDiscoveryResponseSchema.safeParse(invalidWindow).success,
    ).toBe(false);
  });

  it("binds complete coverage to scope and the full event window", () => {
    const shortStart = copy(SYNTHETIC_PARIS_VALID_EMPTY);
    if (shortStart.coverage.state !== "complete") {
      throw new Error("Synthetic Paris coverage is not complete");
    }
    shortStart.coverage.coveredEventWindow.from =
      "2026-07-30T15:00:00.001Z";
    expect(nearbyDiscoveryResponseSchema.safeParse(shortStart).success).toBe(
      false,
    );

    const shortEnd = copy(SYNTHETIC_PARIS_VALID_EMPTY);
    if (shortEnd.coverage.state !== "complete") {
      throw new Error("Synthetic Paris coverage is not complete");
    }
    shortEnd.coverage.coveredEventWindow.through =
      "2026-07-31T14:59:59.999Z";
    expect(nearbyDiscoveryResponseSchema.safeParse(shortEnd).success).toBe(
      false,
    );

    const uncheckedFuture = copy(SYNTHETIC_PARIS_VALID_EMPTY);
    if (uncheckedFuture.coverage.state !== "complete") {
      throw new Error("Synthetic Paris coverage is not complete");
    }
    uncheckedFuture.coverage.checkedAt = "2026-07-31T14:59:59.999Z";
    expect(
      nearbyDiscoveryResponseSchema.safeParse(uncheckedFuture).success,
    ).toBe(false);

    const wrongScope = copy(SYNTHETIC_PARIS_VALID_EMPTY);
    wrongScope.coverage.scope = {
      kind: "coarse-area",
      gridVersion: wrongScope.scope.gridVersion,
      cell: SYNTHETIC_PLOMARI_NEARBY.scope.cell,
    };
    expect(nearbyDiscoveryResponseSchema.safeParse(wrongScope).success).toBe(
      false,
    );
  });

  it("validates cutoff offsets for summer and winter DST", () => {
    expect(
      nearbyDiscoveryResponseSchema.safeParse(SYNTHETIC_PARIS_VALID_EMPTY)
        .success,
    ).toBe(true);
    expect(
      nearbyDiscoveryResponseSchema.safeParse(
        SYNTHETIC_PARIS_WINTER_VALID_EMPTY,
      ).success,
    ).toBe(true);

    const wrongWinterOffset = copy(SYNTHETIC_PARIS_WINTER_VALID_EMPTY);
    wrongWinterOffset.time.timeZone.utcOffsetMinutesAtAsOf = 120;
    expect(
      nearbyDiscoveryResponseSchema.safeParse(wrongWinterOffset).success,
    ).toBe(false);
  });

  it("rejects date-only observations after item knowledge time", () => {
    const candidate = copy(SYNTHETIC_MARSEILLE_EXPLORE.candidates[0]);
    if (!candidate) throw new Error("Missing Marseille candidate");
    candidate.times.firstObservedAt = { precision: "unknown" };
    candidate.times.latestObservedAt = {
      precision: "date_only",
      date: "2026-08-01",
    };
    expect(wildfireCandidateSchema.safeParse(candidate).success).toBe(false);

    const response = copy(SYNTHETIC_PLOMARI_NEARBY);
    const incident = response.incidents[0];
    if (!incident || response.coverage.state !== "complete") {
      throw new Error("Missing complete synthetic Plomari incident");
    }
    response.time.asOf = "2026-08-02T18:00:00.000Z";
    response.time.knownAt = "2026-08-02T18:05:00.000Z";
    response.time.observedWindow = {
      from: "2026-08-01T18:00:00.000Z",
      to: "2026-08-02T18:00:00.000Z",
    };
    response.coverage.checkedAt = "2026-08-02T18:04:00.000Z";
    response.coverage.freshnessDeadline = "2026-08-02T18:20:00.000Z";
    response.coverage.coveredEventWindow = {
      from: "2026-08-01T18:00:00.000Z",
      through: "2026-08-02T18:00:00.000Z",
    };
    incident.times.startedAt = { precision: "unknown" };
    incident.times.latestObservedAt = {
      precision: "date_only",
      date: "2026-08-02",
    };
    incident.times.knownAt = "2026-08-01T18:01:00.000Z";
    expect(nearbyDiscoveryResponseSchema.safeParse(response).success).toBe(
      false,
    );
  });

  it("keeps France fixtures free of Plomari-specific localization", () => {
    const text = franceFixtureText();
    expect(text).not.toContain("Plomari");
    expect(text).not.toContain("Europe/Athens");
    expect(text).not.toContain("el-GR");
    expect(text).not.toContain("112");
    expect(text).not.toMatch(/[\u0370-\u03ff]/u);

    const parisOffset = new Intl.DateTimeFormat("en", {
      timeZone: SYNTHETIC_PARIS_VALID_EMPTY.time.timeZone.id,
      timeZoneName: "longOffset",
    })
      .formatToParts(Date.parse(SYNTHETIC_PARIS_VALID_EMPTY.time.asOf))
      .find((part) => part.type === "timeZoneName")?.value;
    expect(parisOffset).toBe("GMT+02:00");
  });

  it("keeps synthetic fixtures credential- and identity-safe", () => {
    const serialized = JSON.stringify(SYNTHETIC_GLOBAL_DISCOVERY_FIXTURES);
    expect(serialized).not.toMatch(/sk-(?:or|live|test)-/iu);
    expect(serialized).not.toMatch(/bearer\s+/iu);
    expect(serialized).not.toMatch(/service[_-]?role/iu);
    expect(serialized).not.toMatch(/authorization/iu);
    expect(serialized).not.toMatch(/supabase\.co/iu);
    expect(serialized).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu);

    const prohibitedLocationKeys = new Set([
      "lat",
      "lon",
      "latitude",
      "longitude",
      "accuracyM",
      "address",
    ]);
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (value === null || typeof value !== "object") return;
      Object.entries(value).forEach(([key, nested]) => {
        expect(prohibitedLocationKeys.has(key)).toBe(false);
        visit(nested);
      });
    };
    visit(SYNTHETIC_GLOBAL_DISCOVERY_FIXTURES);
  });

  it("exposes one client interface with mode-specific results", async () => {
    const client: GlobalDiscoveryClient = {
      async exploreCandidates() {
        return {
          kind: "snapshot",
          transport: "live",
          data: SYNTHETIC_MARSEILLE_EXPLORE,
        };
      },
      async nearbyIncidents() {
        return {
          kind: "snapshot",
          transport: "cache-fallback",
          data: SYNTHETIC_PARIS_VALID_EMPTY,
        };
      },
    };
    const exploreRequest = exploreDiscoveryRequestSchema.parse({
      schemaVersion: GLOBAL_DISCOVERY_SCHEMA_VERSION,
      kind: "explore-candidates",
      time: {
        asOf: SYNTHETIC_MARSEILLE_EXPLORE.time.asOf,
        knownAt: SYNTHETIC_MARSEILLE_EXPLORE.time.knownAt,
      },
      page: {},
    });
    const nearbyRequest = nearbyDiscoveryRequestSchema.parse({
      schemaVersion: GLOBAL_DISCOVERY_SCHEMA_VERSION,
      kind: "nearby-incidents",
      cell: SYNTHETIC_PARIS_VALID_EMPTY.scope.cell,
      time: {
        asOf: SYNTHETIC_PARIS_VALID_EMPTY.time.asOf,
        knownAt: SYNTHETIC_PARIS_VALID_EMPTY.time.knownAt,
      },
      page: {},
    });

    const explore = await client.exploreCandidates(exploreRequest);
    const nearby = await client.nearbyIncidents(nearbyRequest);
    expect(explore.kind).toBe("snapshot");
    expect(nearby.kind).toBe("snapshot");
    if (explore.kind === "snapshot") {
      expectTypeOf(explore.data).toMatchTypeOf<ExploreDiscoveryResponse>();
      expect(explore.data.kind).toBe("explore-candidates");
    }
    if (nearby.kind === "snapshot") {
      expectTypeOf(nearby.data).toMatchTypeOf<NearbyDiscoveryResponse>();
      expect(nearby.data.kind).toBe("nearby-incidents");
      expect(nearby.transport).toBe("cache-fallback");
    }
  });
});
