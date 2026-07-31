import { describe, expect, it } from "vitest";

import {
  candidateAreaFeatureCollection,
  candidateMapMarker,
  describeExploreMapSnapshot,
} from "../app/explore/explore-globe-model";
import {
  globalDiscoveryCursorSchema,
  type ExploreDiscoveryResponse,
} from "../lib/firewatch/v3";
import { SYNTHETIC_MARSEILLE_EXPLORE } from "./fixtures/global-discovery-v3";

function copy<Value>(value: Value): Value {
  return structuredClone(value);
}

describe("Explore aggregate globe model", () => {
  it("derives marker centers and outlines only from public aggregate cells", () => {
    const candidate = SYNTHETIC_MARSEILLE_EXPLORE.candidates[0];
    if (!candidate) throw new Error("Synthetic candidate is required.");

    const marker = candidateMapMarker(candidate);
    const collection = candidateAreaFeatureCollection(
      SYNTHETIC_MARSEILLE_EXPLORE,
      candidate.candidateId,
    );

    expect(marker).toEqual({
      candidateId: candidate.candidateId,
      cell: candidate.displayArea.cell,
      center: [
        (candidate.displayArea.bounds.west +
          candidate.displayArea.bounds.east) /
          2,
        (candidate.displayArea.bounds.south +
          candidate.displayArea.bounds.north) /
          2,
      ],
    });
    expect(collection.features).toHaveLength(1);
    expect(collection.features[0]).toMatchObject({
      id: candidate.candidateId,
      properties: {
        candidateId: candidate.candidateId,
        cell: candidate.displayArea.cell,
        selected: true,
      },
      geometry: { type: "Polygon" },
    });
    expect(Object.keys(collection.features[0]?.properties ?? {}).sort()).toEqual(
      ["candidateId", "cell", "selected"],
    );
    expect(JSON.stringify(collection.features[0]?.properties)).not.toMatch(
      /provider|observation|detection|payload|source/iu,
    );
  });

  it("keeps loading and transport failure separate from wildfire truth", () => {
    expect(
      describeExploreMapSnapshot({
        requestStatus: "loading",
        response: null,
      }),
    ).toMatchObject({
      tone: "neutral",
      title: "Loading candidate snapshot",
    });
    expect(
      describeExploreMapSnapshot({ requestStatus: "error", response: null }),
    ).toMatchObject({
      tone: "critical",
      title: "Discovery unavailable",
    });
  });

  it("makes valid-empty, indeterminate, and unconfigured states explicit", () => {
    const validEmpty = copy(SYNTHETIC_MARSEILLE_EXPLORE);
    validEmpty.candidates = [];
    validEmpty.result = {
      state: "valid-empty",
      messageCode: "no_known_candidates_in_scope",
      assessment: "candidate_discovery_only",
      allClearAssessment: "not_assessed",
    };
    expect(
      describeExploreMapSnapshot({
        requestStatus: "ready",
        response: validEmpty,
      }),
    ).toMatchObject({
      tone: "positive",
      title: "No known candidates in this window",
    });

    const partial = copy(validEmpty);
    partial.coverage = {
      state: "partial",
      policyVersion: validEmpty.coverage.policyVersion,
      scope: copy(validEmpty.coverage.scope),
      checkedAt: "2026-07-31T17:04:00.000Z",
      requiredPartitionCount: 3,
      completedPartitionCount: 2,
    };
    partial.result = { state: "indeterminate" };
    expect(
      describeExploreMapSnapshot({
        requestStatus: "ready",
        response: partial,
      }),
    ).toMatchObject({
      tone: "warning",
      title: "Candidate finding indeterminate",
    });

    const unconfigured: ExploreDiscoveryResponse = copy(partial);
    unconfigured.coverage = {
      state: "unconfigured",
      policyVersion: validEmpty.coverage.policyVersion,
      scope: copy(validEmpty.coverage.scope),
    };
    expect(
      describeExploreMapSnapshot({
        requestStatus: "ready",
        response: unconfigured,
      }),
    ).toMatchObject({
      tone: "neutral",
      title: "Discovery unconfigured",
    });
  });

  it("labels retained last-good candidates without claiming a current read", () => {
    const notice = describeExploreMapSnapshot({
      requestStatus: "error",
      response: SYNTHETIC_MARSEILLE_EXPLORE,
    });

    expect(notice.title).toBe("1 aggregate candidate cell");
    expect(notice.detail).toContain("current read failed");
    expect(notice.detail).toContain("last complete snapshot");
  });

  it("labels a bounded continuation page as an incomplete globe view", () => {
    const boundedPage = copy(SYNTHETIC_MARSEILLE_EXPLORE);
    boundedPage.page = {
      limit: 1,
      isFirstPage: true,
      hasMore: true,
      nextCursor: globalDiscoveryCursorSchema.parse(
        "eyJ2IjoxLCJpZCI6InN5bnRoZXRpYyJ9",
      ),
    };

    const notice = describeExploreMapSnapshot({
      requestStatus: "ready",
      response: boundedPage,
    });

    expect(notice.title).toBe("1 aggregate candidate cell shown");
    expect(notice.detail).toContain("only the current bounded page");
    expect(notice.detail).toContain("more candidate cells are available");
  });
});
