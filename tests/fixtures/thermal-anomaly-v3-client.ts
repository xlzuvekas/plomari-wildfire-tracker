import { parseAreaCellKey } from "../../lib/firewatch/map-context";
import {
  THERMAL_ANOMALY_WINDOW_MS,
  type ThermalAnomalyPayload,
} from "../../lib/firewatch/v3/thermal-anomaly-contract";

export const THERMAL_CLIENT_CELL = "wm/10/587/391";
export const THERMAL_CLIENT_AS_OF = "2026-07-31T12:00:00.000Z";
export const THERMAL_CLIENT_KNOWN_AT = "2026-07-31T12:05:00.000Z";

type FixtureOptions = Readonly<{
  cell?: string;
  asOf?: string;
  knownAt?: string;
  limit?: number;
  withItem?: boolean;
  hasMore?: boolean;
  isFirstPage?: boolean;
}>;

export function thermalAnomalyClientFixture(
  options: FixtureOptions = {},
): ThermalAnomalyPayload {
  const cellKey = options.cell ?? THERMAL_CLIENT_CELL;
  const cell = parseAreaCellKey(cellKey);
  if (cell === null) throw new TypeError("Fixture cell is invalid.");
  const asOf = options.asOf ?? THERMAL_CLIENT_AS_OF;
  const knownAt = options.knownAt ?? THERMAL_CLIENT_KNOWN_AT;
  const limit = options.limit ?? 50;
  const withItem = options.withItem ?? false;
  const hasMore = options.hasMore ?? false;
  const anomalies: ThermalAnomalyPayload["anomalies"] = withItem
    ? [
        {
          detectionId: "019a0000-0000-7000-8000-000000000101",
          detailRevision: {
            id: "019a0000-0000-7000-8000-000000000101",
            version: 1,
            role: "assessment-basis",
          },
          contractVersion: "1.1.0",
          identityVersion: "firms-detection-v1",
          source: {
            id: "018f0000-0000-7000-8000-000000000101",
            key: "nasa-firms",
          },
          product: {
            key: "VIIRS_NOAA20_NRT",
            platform: "NOAA-20",
            instrument: "VIIRS",
          },
          times: {
            acquiredAt: "2026-07-31T11:45:00.000Z",
            sourcePrecision: "minute",
            publishedAt: "2026-07-31T11:46:00.000Z",
            retrievedAt: "2026-07-31T11:47:00.000Z",
            detectionRecordedAt: "2026-07-31T11:48:00.000Z",
            itemKnownAt: "2026-07-31T11:50:00.000Z",
            timeZone: "UTC",
          },
          centroid: {
            latitude: 39.001,
            longitude: 26.402,
            meaning: "source-reported-thermal-pixel-centroid",
          },
          pixel: {
            scanKm: 0.375,
            trackKm: 0.375,
            dimensionsMeaning:
              "source-reported-kilometres-without-orientation",
            spatialSupportMethod: "centroid_with_circumscribed_radius_v1",
          },
          confidence: { encoding: "class", value: "high" },
          measurements: {
            brightnessPrimaryK: 370.25,
            brightnessSecondaryK: 302.5,
            brightnessContract: "viirs_bright_ti4_ti5",
            frpMw: 12.25,
            dayNight: "day",
            sourceDatasetVersion: "2.0NRT",
          },
          assessment: {
            assessmentId: "019a0000-0000-7000-8000-000000000201",
            basisDetailRevisionId:
              "019a0000-0000-7000-8000-000000000101",
            state: "detected",
            reason: "firms_detection_observed",
            rule: { id: "firms.initial-detection", version: "1.0.0" },
            asOf: "2026-07-31T11:45:00.000Z",
            knownAt: "2026-07-31T11:49:00.000Z",
            recordedAt: "2026-07-31T11:50:00.000Z",
            claimKind: "thermal_anomaly_observation_only",
            operationalEffect: "none",
            notificationEligible: false,
            officialStatusEligible: false,
            protectiveActionEligible: false,
            incidentResolutionEligible: false,
            limitations: [
              "thermal_detection_not_incident_confirmation",
              "sensor_assessability_unknown",
              "not_official_status",
              "not_protective_guidance",
              "not_incident_resolution",
              "not_all_clear",
            ],
          },
          limitations: [
            "thermal_pixel_not_flame_location",
            "not_incident_confirmation",
            "pixel_orientation_not_source_supplied",
            "not_official_status",
            "not_protective_guidance",
            "not_all_clear",
          ],
        },
      ]
    : [];

  return {
    schemaVersion: 3,
    mode: "persisted",
    scope: {
      kind: "coarse-area",
      gridVersion: cell.gridVersion,
      cell: cell.cellKey,
      bounds: cell.bounds,
    },
    time: {
      asOf,
      knownAt,
      observedWindow: {
        from: new Date(Date.parse(asOf) - THERMAL_ANOMALY_WINDOW_MS).toISOString(),
        to: asOf,
      },
      normalizedTimeZone: "UTC",
      semantics: {
        asOf: "source-acquisition-time-cutoff",
        knownAt: "Firewatch-knowledge-time-cutoff",
        acquiredAt: "source-acquisition-time-minute-precision",
        publishedAt: "source-publication-time-when-supplied",
        retrievedAt: "Firewatch-evidence-retrieval-time",
      },
    },
    coverage: { state: "not_assessed", meaning: "row-availability-only" },
    result: {
      state: withItem ? "items" : "indeterminate",
      count: { scope: "page", value: anomalies.length, relation: "exact" },
      allClearAssessment: "not_assessed",
      message: withItem
        ? "This page contains assessed thermal-pixel observations."
        : "No assessed observations are visible; coverage is not assessed, so this is not an all-clear.",
    },
    safety: {
      thermalPixelMeaning: "satellite-thermal-anomaly-observation",
      flameLocation: false,
      incidentConfirmation: false,
      firePerimeter: false,
      officialStatus: false,
      protectiveAction: false,
      incidentResolution: false,
      allClear: false,
    },
    anomalies,
    page: {
      limit,
      ordering: "acquired-at-desc-detection-id-desc",
      isFirstPage: options.isFirstPage ?? true,
      hasMore,
      nextCursor: hasMore ? "signed-first-page-cursor" : null,
    },
  };
}
