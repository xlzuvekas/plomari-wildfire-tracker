import { createHash } from "node:crypto";

import {
  FIRMS_COORDINATE_IDENTITY_DECIMALS,
  FIRMS_PASS_GAP_MINUTES,
} from "./constants";
import type { IsoDateTime, JsonValue } from "./schemas";

function canonicalizeJson(value: JsonValue): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Canonical JSON cannot contain non-finite numbers");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeJson).join(",")}]`;
  }

  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([key, entry]) =>
        `${JSON.stringify(key)}:${canonicalizeJson(entry as JsonValue)}`,
    )
    .join(",")}}`;
}

export function stableJsonStringify(value: JsonValue): string {
  return canonicalizeJson(value);
}

export function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function hashJson(value: JsonValue): string {
  return sha256Text(stableJsonStringify(value));
}

export function normalizeCanonicalUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new TypeError("Canonical source URLs must use HTTPS");
  }

  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  url.pathname = url.pathname.replace(/\/{2,}/g, "/");
  if (url.pathname !== "/") {
    url.pathname = url.pathname.replace(/\/$/, "");
  }

  const sortedParameters = [...url.searchParams.entries()].sort(
    ([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue),
  );
  url.search = "";
  sortedParameters.forEach(([key, entry]) => url.searchParams.append(key, entry));

  return url.toString();
}

export type SourceItemIdentityInput = {
  readonly sourceKey: string;
  readonly externalId: string | null;
  readonly canonicalUrl: string | null;
  readonly sensorNaturalKey: string | null;
  readonly normalizedTimestamp: string | null;
  readonly payloadHash: string;
};

export function sourceItemSemanticKey(
  input: SourceItemIdentityInput,
): string {
  if (input.externalId) {
    return `${input.sourceKey}|external|${input.externalId.trim()}`;
  }
  if (input.canonicalUrl) {
    return `${input.sourceKey}|url|${normalizeCanonicalUrl(
      input.canonicalUrl,
    )}`;
  }
  if (input.sensorNaturalKey) {
    return `${input.sourceKey}|sensor|${input.sensorNaturalKey}`;
  }
  return [
    input.sourceKey,
    "fallback",
    input.normalizedTimestamp ?? "unknown-time",
    input.payloadHash,
  ].join("|");
}

export type FirmsDetectionIdentityInput = {
  readonly product: string;
  readonly satellite: string;
  readonly observedAt: IsoDateTime;
  readonly latitude: number;
  readonly longitude: number;
  readonly scanKm: number;
  readonly trackKm: number;
};

function fixedIdentityNumber(value: number, decimals: number): string {
  if (!Number.isFinite(value)) {
    throw new TypeError("Identity inputs must be finite numbers");
  }
  return value.toFixed(decimals);
}

export function firmsDetectionNaturalKey(
  detection: FirmsDetectionIdentityInput,
): string {
  return [
    detection.product.trim().toLowerCase(),
    detection.satellite.trim().toLowerCase(),
    detection.observedAt,
    fixedIdentityNumber(
      detection.latitude,
      FIRMS_COORDINATE_IDENTITY_DECIMALS,
    ),
    fixedIdentityNumber(
      detection.longitude,
      FIRMS_COORDINATE_IDENTITY_DECIMALS,
    ),
    fixedIdentityNumber(detection.scanKm, 3),
    fixedIdentityNumber(detection.trackKm, 3),
  ].join("|");
}

export type FirmsPass = {
  readonly product: string;
  readonly satellite: string;
  readonly passStart: IsoDateTime;
  readonly detections: readonly FirmsDetectionIdentityInput[];
  readonly naturalKey: string;
};

export function firmsPassNaturalKey(
  product: string,
  satellite: string,
  passStart: IsoDateTime,
): string {
  return [
    product.trim().toLowerCase(),
    satellite.trim().toLowerCase(),
    passStart,
  ].join("|");
}

export function groupFirmsDetectionsIntoPasses(
  detections: readonly FirmsDetectionIdentityInput[],
): readonly FirmsPass[] {
  const groupedByPlatform = new Map<
    string,
    FirmsDetectionIdentityInput[]
  >();

  detections.forEach((detection) => {
    const key = `${detection.product.trim().toLowerCase()}|${detection.satellite
      .trim()
      .toLowerCase()}`;
    const group = groupedByPlatform.get(key) ?? [];
    group.push(detection);
    groupedByPlatform.set(key, group);
  });

  const maximumGapMs = FIRMS_PASS_GAP_MINUTES * 60 * 1_000;
  const passes: FirmsPass[] = [];

  groupedByPlatform.forEach((platformDetections) => {
    const sorted = [...platformDetections].sort(
      (left, right) =>
        Date.parse(left.observedAt) - Date.parse(right.observedAt),
    );
    let current: FirmsDetectionIdentityInput[] = [];

    const commitCurrent = () => {
      if (current.length === 0) return;
      const first = current[0];
      passes.push({
        product: first.product,
        satellite: first.satellite,
        passStart: first.observedAt,
        detections: current,
        naturalKey: firmsPassNaturalKey(
          first.product,
          first.satellite,
          first.observedAt,
        ),
      });
      current = [];
    };

    sorted.forEach((detection) => {
      const previous = current[current.length - 1];
      if (
        previous &&
        Date.parse(detection.observedAt) - Date.parse(previous.observedAt) >
          maximumGapMs
      ) {
        commitCurrent();
      }
      current.push(detection);
    });
    commitCurrent();
  });

  return passes.sort(
    (left, right) => Date.parse(left.passStart) - Date.parse(right.passStart),
  );
}

export type RevisionDecision =
  | { readonly kind: "identical"; readonly nextVersionNumber: null }
  | { readonly kind: "correction"; readonly nextVersionNumber: number };

export function decideSourceRevision(
  previous: { readonly versionNumber: number; readonly contentHash: string },
  nextContentHash: string,
): RevisionDecision {
  if (previous.contentHash === nextContentHash) {
    return { kind: "identical", nextVersionNumber: null };
  }
  return {
    kind: "correction",
    nextVersionNumber: previous.versionNumber + 1,
  };
}
