/**
 * Stable domain contracts for the data truth layer.
 *
 * These types deliberately keep source authority, verification, quality,
 * freshness, and materiality separate. Do not replace them with a single
 * numeric confidence or "truth" score.
 */

export type Uuid = string;
export type IsoDateTime = string;
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | { readonly [key: string]: JsonValue }
  | readonly JsonValue[];

export const sourceKinds = [
  "official_alert",
  "official_status",
  "official_context",
  "sensor",
  "measurement",
  "model",
  "public_broadcaster",
  "publisher",
  "field_report",
] as const;

export type SourceKind = (typeof sourceKinds)[number];

export const authorityScopes = [
  "protective_instruction",
  "incident_status",
  "road_status",
  "thermal_anomaly",
  "weather_measurement",
  "weather_model",
  "satellite_imagery",
  "local_context",
] as const;

export type AuthorityScope = (typeof authorityScopes)[number];

export const timePrecisions = ["exact", "date_only", "unknown"] as const;
export type TimePrecision = (typeof timePrecisions)[number];

export const ingestionStatuses = [
  "running",
  "success",
  "not_modified",
  "partial",
  "failed",
] as const;
export type IngestionStatus = (typeof ingestionStatuses)[number];

export const validationStates = [
  "accepted",
  "quarantined",
  "rejected",
] as const;
export type ValidationState = (typeof validationStates)[number];

export const assertionTypes = [
  "observation",
  "report",
  "model",
  "instruction",
  "interpretation",
] as const;
export type AssertionType = (typeof assertionTypes)[number];

export const assertionStates = [
  "active",
  "superseded",
  "retracted",
  "disputed",
] as const;
export type AssertionState = (typeof assertionStates)[number];

export const eventTypes = [
  "protective_instruction",
  "official_status_transition",
  "thermal_detection",
  "thermal_pass",
  "road_condition",
  "settlement_threat",
  "smoke_observation",
  "weather_observation",
  "weather_model_change",
  "response_update",
  "source_correction",
] as const;
export type EventType = (typeof eventTypes)[number];

export const eventLifecycles = [
  "active",
  "superseded",
  "resolved",
  "retracted",
  "disputed",
] as const;
export type EventLifecycle = (typeof eventLifecycles)[number];

export const verificationStates = [
  "official",
  "corroborated",
  "single_source",
  "unverified",
  "contradicted",
] as const;
export type VerificationState = (typeof verificationStates)[number];

export const evidenceRelationships = [
  "supports",
  "updates",
  "contradicts",
  "retracts",
  "supersedes",
] as const;
export type EvidenceRelationship = (typeof evidenceRelationships)[number];

export const materialityLevels = ["critical", "high", "medium", "low"] as const;
export type Materiality = (typeof materialityLevels)[number];

export const sourceHealthStates = [
  "healthy",
  "stale",
  "failed",
  "rate_limited",
  "authentication_failed",
  "unconfigured",
  "disabled",
  "unknown",
] as const;
export type SourceHealthState = (typeof sourceHealthStates)[number];

export type GeoJsonGeometry =
  | {
      readonly type: "Point";
      readonly coordinates: readonly [longitude: number, latitude: number];
    }
  | {
      readonly type: "LineString";
      readonly coordinates: readonly (
        readonly [longitude: number, latitude: number]
      )[];
    }
  | {
      readonly type: "Polygon";
      readonly coordinates: readonly (
        readonly (readonly [longitude: number, latitude: number])[]
      )[];
    }
  | {
      readonly type: "MultiPoint";
      readonly coordinates: readonly (
        readonly [longitude: number, latitude: number]
      )[];
    };

export type SourceDefinition = {
  readonly key: string;
  readonly name: string;
  readonly sourceKind: SourceKind;
  readonly authorityScopes: readonly AuthorityScope[];
  readonly homepageUrl: string;
  readonly dataUrl: string;
  readonly expectedCadenceSeconds: number;
  readonly staleAfterSeconds: number;
  readonly enabledByDefault: boolean;
  readonly credentialEnv?: string;
  readonly adapterName: string;
  readonly contentPolicy:
    | "structured_data"
    | "official_content"
    | "headline_link_excerpt"
    | "derived_model";
  readonly notes: string;
};

export type IngestionRun = {
  readonly id: Uuid;
  readonly sourceKey: string;
  readonly startedAt: IsoDateTime;
  readonly finishedAt: IsoDateTime | null;
  readonly status: IngestionStatus;
  readonly httpStatus: number | null;
  readonly latencyMs: number | null;
  readonly payloadHash: string | null;
  readonly rawObjectKey: string | null;
  readonly itemCount: number;
  readonly errorClass: string | null;
  readonly errorDetailSafe: string | null;
  readonly collectorVersion: string;
};

export type SourceItem = {
  readonly id: Uuid;
  readonly sourceKey: string;
  readonly externalId: string | null;
  readonly canonicalUrl: string | null;
  readonly versionNumber: number;
  readonly supersedesId: Uuid | null;
  readonly contentHash: string;
  readonly title: string | null;
  readonly language: string | null;
  readonly publishedAt: IsoDateTime | null;
  readonly modifiedAt: IsoDateTime | null;
  readonly retrievedAt: IsoDateTime;
  readonly timePrecision: TimePrecision;
  readonly rawExcerpt: string | null;
  readonly rawPayload: Readonly<Record<string, JsonValue>>;
};

export type Observation = {
  readonly id: Uuid;
  readonly incidentId: Uuid;
  readonly sourceItemId: Uuid;
  readonly observationType: string;
  readonly observedAt: IsoDateTime | null;
  readonly effectiveAt: IsoDateTime | null;
  readonly geometry: GeoJsonGeometry | null;
  readonly geometryPrecisionM: number | null;
  readonly measurements: Readonly<Record<string, JsonValue>>;
  readonly quality: Readonly<Record<string, JsonValue>>;
  readonly relevanceMethod:
    | "exact_identifier"
    | "geometry"
    | "keyword"
    | "analyst_link";
  readonly parserVersion: string;
  readonly validationState: ValidationState;
  readonly validationReasons: readonly string[];
};

export type Assertion = {
  readonly id: Uuid;
  readonly incidentId: Uuid;
  readonly observationId: Uuid;
  readonly subjectType: string;
  readonly subjectKey: string;
  readonly predicate: string;
  readonly value: JsonValue;
  readonly assertionType: AssertionType;
  readonly authorityScope: AuthorityScope | null;
  readonly effectiveAt: IsoDateTime | null;
  readonly expiresAt: IsoDateTime | null;
  readonly extractionMethod:
    | "source_field"
    | "deterministic_parser"
    | "assistive_classifier"
    | "analyst";
  readonly extractionVersion: string;
  readonly state: AssertionState;
};

export type CanonicalEvent = {
  readonly id: Uuid;
  readonly incidentId: Uuid;
  readonly eventType: EventType;
  readonly firstEffectiveAt: IsoDateTime | null;
  readonly lastEffectiveAt: IsoDateTime | null;
  readonly geometry: GeoJsonGeometry | null;
  readonly geometryPrecisionM: number | null;
  readonly lifecycle: EventLifecycle;
  readonly verificationState: VerificationState;
  readonly currentSummaryEn: string;
  readonly currentSummaryEl: string;
  readonly reconciliationVersion: string;
};

export type EventEvidence = {
  readonly eventId: Uuid;
  readonly assertionId: Uuid;
  readonly relationship: EvidenceRelationship;
  readonly rationaleCode: string;
  readonly linkedBy: string;
};

export type ProtectiveAction = {
  readonly sourceEventId: Uuid;
  readonly instructionEn: string;
  readonly instructionEl: string;
  readonly sourceLanguageText: string;
  readonly sourceUrl: string;
  readonly issuedAt: IsoDateTime;
  readonly affectedArea: GeoJsonGeometry | null;
  readonly destination: GeoJsonGeometry | null;
};

export type IncidentStateSnapshot = {
  readonly id: Uuid;
  readonly incidentId: Uuid;
  readonly sequence: number;
  readonly calculatedAt: IsoDateTime;
  readonly stateHash: string;
  readonly state: Readonly<Record<string, JsonValue>>;
  readonly rulesetVersion: string;
};

export type MaterialChange = {
  readonly id: Uuid;
  readonly incidentId: Uuid;
  readonly sequence: number;
  readonly changeType: string;
  readonly materiality: Materiality;
  readonly calculatedAt: IsoDateTime;
  readonly beforeSnapshotId: Uuid | null;
  readonly afterSnapshotId: Uuid;
  readonly ruleId: string;
  readonly ruleVersion: number;
  readonly evidenceEventIds: readonly Uuid[];
  readonly summaryEn: string;
  readonly summaryEl: string;
  readonly protectiveAction: ProtectiveAction | null;
  readonly notificationEligible: boolean;
};

export type SourceHealthSample = {
  readonly id: Uuid;
  readonly sourceKey: string;
  readonly sampledAt: IsoDateTime;
  readonly state: SourceHealthState;
  readonly lastAttemptAt: IsoDateTime | null;
  readonly lastSuccessAt: IsoDateTime | null;
  readonly lastChangedPayloadAt: IsoDateTime | null;
  readonly latestSourcePublicationAt: IsoDateTime | null;
  readonly consecutiveFailures: number;
  readonly latencyMs: number | null;
  readonly errorClass: string | null;
};
