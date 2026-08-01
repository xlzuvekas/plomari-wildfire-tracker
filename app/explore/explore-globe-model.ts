import type {
  ExploreDiscoveryResponse,
  WildfireCandidate,
} from "../../lib/firewatch/v3";

type Position = [longitude: number, latitude: number];

export type CandidateAreaFeature = {
  type: "Feature";
  id: string;
  properties: {
    candidateId: string;
    cell: string;
    selected: boolean;
  };
  geometry:
    | { type: "Polygon"; coordinates: Position[][] }
    | { type: "MultiPolygon"; coordinates: Position[][][] };
};

export type CandidateAreaFeatureCollection = {
  type: "FeatureCollection";
  features: CandidateAreaFeature[];
};

export type CandidateMapMarker = Readonly<{
  candidateId: WildfireCandidate["candidateId"];
  cell: WildfireCandidate["displayArea"]["cell"];
  center: Position;
}>;

export type ExploreMapSnapshot = Readonly<{
  requestStatus: "loading" | "ready" | "error";
  response: ExploreDiscoveryResponse | null;
}>;

export type ExploreMapNotice = Readonly<{
  tone: "neutral" | "positive" | "warning" | "critical";
  title: string;
  detail: string;
}>;

const UTC_CUTOFF_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZoneName: "short",
});

/**
 * Keeps the map's evidence clocks explicit and cache-stable. Relative age is
 * never substituted for the full UTC calendar date and semantic cutoff.
 */
export function describeExploreSnapshotCutoffs(
  response: ExploreDiscoveryResponse | null,
): string | null {
  if (response === null) return null;
  return (
    `Events observed through ${UTC_CUTOFF_FORMATTER.format(Date.parse(response.time.asOf))}` +
    ` · Knowledge snapshot ${UTC_CUTOFF_FORMATTER.format(Date.parse(response.time.knownAt))}`
  );
}

function longitudeMidpoint(west: number, east: number): number {
  if (east >= west) return (west + east) / 2;
  const midpoint = (west + east + 360) / 2;
  return midpoint > 180 ? midpoint - 360 : midpoint;
}

export function candidateMapMarker(
  candidate: WildfireCandidate,
): CandidateMapMarker {
  const { bounds } = candidate.displayArea;
  return {
    candidateId: candidate.candidateId,
    cell: candidate.displayArea.cell,
    center: [
      longitudeMidpoint(bounds.west, bounds.east),
      (bounds.south + bounds.north) / 2,
    ],
  };
}

function boundsGeometry(
  candidate: WildfireCandidate,
): CandidateAreaFeature["geometry"] {
  const { east, north, south, west } = candidate.displayArea.bounds;
  if (east >= west) {
    return {
      type: "Polygon",
      coordinates: [
        [
          [west, south],
          [east, south],
          [east, north],
          [west, north],
          [west, south],
        ],
      ],
    };
  }
  return {
    type: "MultiPolygon",
    coordinates: [
      [
        [
          [west, south],
          [180, south],
          [180, north],
          [west, north],
          [west, south],
        ],
      ],
      [
        [
          [-180, south],
          [east, south],
          [east, north],
          [-180, north],
          [-180, south],
        ],
      ],
    ],
  };
}

/**
 * Produces map geometry exclusively from the v3 aggregate candidate response.
 * No provider observation, precise browser location, or raw detection enters
 * this model.
 */
export function candidateAreaFeatureCollection(
  response: ExploreDiscoveryResponse | null,
  selectedCandidateId: string | null,
): CandidateAreaFeatureCollection {
  return {
    type: "FeatureCollection",
    features: (response?.candidates ?? []).map((candidate) => ({
      type: "Feature",
      id: candidate.candidateId,
      properties: {
        candidateId: candidate.candidateId,
        cell: candidate.displayArea.cell,
        selected: candidate.candidateId === selectedCandidateId,
      },
      geometry: boundsGeometry(candidate),
    })),
  };
}

export function describeExploreMapSnapshot(
  snapshot: ExploreMapSnapshot,
): ExploreMapNotice {
  const { requestStatus, response } = snapshot;
  if (response === null) {
    return requestStatus === "loading"
      ? {
          tone: "neutral",
          title: "Loading candidate snapshot",
          detail:
            "The globe can load independently. Candidate cells will appear after the persisted v3 read completes.",
        }
      : {
          tone: "critical",
          title: "Discovery unavailable",
          detail:
            "No candidate snapshot is available. The semantic status and controls remain usable below the globe.",
        };
  }

  const retainedSnapshot =
    requestStatus === "loading"
      ? " Refreshing now; the map is showing the previous validated snapshot with its original coverage status."
      : requestStatus === "error"
        ? " The current read failed; the map is showing the previous validated snapshot with its original coverage status."
        : "";

  switch (response.coverage.state) {
    case "disabled":
      return {
        tone: "neutral",
        title: "Discovery disabled",
        detail:
          "Global candidate collection is intentionally disabled for this policy. The basemap is context only.",
      };
    case "unconfigured":
      return {
        tone: "neutral",
        title: "Discovery unconfigured",
        detail:
          "No persisted global source pack is configured. The basemap does not imply that an area was checked.",
      };
    case "unavailable":
      return {
        tone: "critical",
        title: "Candidate coverage unavailable",
        detail:
          "The latest coverage pass could not be completed. Do not interpret an empty map as an all-clear.",
      };
    case "partial":
      return {
        tone: "warning",
        title: "Candidate finding indeterminate",
        detail:
          `Only ${response.coverage.completedPartitionCount}/${response.coverage.requiredPartitionCount} policy partitions were checked. Empty regions are not an all-clear.${retainedSnapshot}`,
      };
    case "not_assessed":
      return {
        tone: "warning",
        title: "Coverage not assessed",
        detail:
          `Persisted records may be displayed, but this snapshot does not prove global coverage.${retainedSnapshot}`,
      };
    case "stale":
      return {
        tone: "warning",
        title: "Candidate coverage stale",
        detail:
          `Candidate cells come from an expired coverage window. Recheck the full date and time in the list.${retainedSnapshot}`,
      };
    case "complete":
      break;
  }

  if (response.candidates.length > 0) {
    const boundedPageNotice = response.page.hasMore
      ? " This globe shows only the current bounded page; more candidate cells are available beyond it."
      : "";
    return {
      tone: "positive",
      title: `${response.candidates.length} aggregate candidate ${
        response.candidates.length === 1 ? "cell" : "cells"
      }${response.page.hasMore ? " shown" : ""}`,
      detail:
        "Markers and outlines are coarse Firewatch display cells, not raw satellite detections or confirmed incidents." +
        boundedPageNotice +
        retainedSnapshot,
    };
  }
  if (response.result.state === "valid-empty") {
    return {
      tone: "positive",
      title: "No known candidates in this window",
      detail:
        "The assessed candidate window is empty. This is not an all-clear or proof that no wildfire exists." +
        retainedSnapshot,
    };
  }
  return {
    tone: "warning",
    title: "Candidate finding indeterminate",
    detail:
      "The available snapshot cannot support an empty finding. Empty regions are not an all-clear." +
      retainedSnapshot,
  };
}
