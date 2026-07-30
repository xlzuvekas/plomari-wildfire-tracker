import { z } from "zod";

import {
  adapterFixtureScenarios,
  adapterNames,
  assertionStates,
  assertionTypes,
  authorityScopes,
  contentPolicies,
  errorClasses,
  eventLifecycles,
  evidenceRelationships,
  extractionMethods,
  ingestionStatuses,
  materialChangeTypes,
  materialityLevels,
  normalizedOfficialStatuses,
  observationTypes,
  protectiveInstructionKinds,
  relevanceMethods,
  roadConditionStates,
  sourceHealthStates,
  sourceKinds,
  timePrecisions,
  validationReasonCodes,
  validationStates,
  verificationStates,
} from "./constants";

const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UTC_INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SOURCE_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VERSION_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,63}$/;
const LANGUAGE_TAG_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

export const uuidV7Schema = z
  .string()
  .regex(UUID_V7_PATTERN, "Expected a UUIDv7 value")
  .describe("Application-generated UUIDv7 identifier");

export const utcInstantSchema = z
  .string()
  .regex(UTC_INSTANT_PATTERN, "Expected an RFC 3339 UTC instant ending in Z")
  .refine((value) => Number.isFinite(Date.parse(value)), "Invalid UTC instant")
  .describe("RFC 3339 UTC instant");

export const localDateSchema = z
  .string()
  .regex(LOCAL_DATE_PATTERN, "Expected a calendar date in YYYY-MM-DD form")
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  }, "Invalid calendar date")
  .describe("Calendar date without a fabricated time");

export const sha256Schema = z
  .string()
  .regex(SHA256_PATTERN, "Expected a lowercase SHA-256 digest");

export const sourceKeySchema = z.string().regex(SOURCE_KEY_PATTERN);
export const versionSchema = z.string().regex(VERSION_PATTERN);
export const httpsUrlSchema = z
  .url()
  .refine((value) => value.startsWith("https://"), "URL must use HTTPS");
export const languageTagSchema = z
  .string()
  .regex(LANGUAGE_TAG_PATTERN, "Expected a BCP-47-style language tag");

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | { readonly [key: string]: JsonValue }
  | readonly JsonValue[];

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

export const sourceKindSchema = z.enum(sourceKinds);
export const authorityScopeSchema = z.enum(authorityScopes);
export const timePrecisionSchema = z.enum(timePrecisions);
export const ingestionStatusSchema = z.enum(ingestionStatuses);
export const validationStateSchema = z.enum(validationStates);
export const validationReasonCodeSchema = z.enum(validationReasonCodes);
export const assertionTypeSchema = z.enum(assertionTypes);
export const assertionStateSchema = z.enum(assertionStates);
export const extractionMethodSchema = z.enum(extractionMethods);
export const relevanceMethodSchema = z.enum(relevanceMethods);
export const eventLifecycleSchema = z.enum(eventLifecycles);
export const verificationStateSchema = z.enum(verificationStates);
export const evidenceRelationshipSchema = z.enum(evidenceRelationships);
export const materialitySchema = z.enum(materialityLevels);
export const materialChangeTypeSchema = z.enum(materialChangeTypes);
export const sourceHealthStateSchema = z.enum(sourceHealthStates);
export const adapterNameSchema = z.enum(adapterNames);
export const adapterFixtureScenarioSchema = z.enum(adapterFixtureScenarios);
export const errorClassSchema = z.enum(errorClasses);

const longitudeSchema = z.number().finite().min(-180).max(180);
const latitudeSchema = z.number().finite().min(-90).max(90);
export const positionSchema = z.tuple([longitudeSchema, latitudeSchema]);

const pointGeometrySchema = z.strictObject({
  type: z.literal("Point"),
  coordinates: positionSchema,
});

const lineStringGeometrySchema = z.strictObject({
  type: z.literal("LineString"),
  coordinates: z.array(positionSchema).min(2),
});

const polygonRingSchema = z
  .array(positionSchema)
  .min(4)
  .refine((ring) => {
    const first = ring[0];
    const last = ring[ring.length - 1];
    return first[0] === last[0] && first[1] === last[1];
  }, "Polygon rings must be closed");

const polygonGeometrySchema = z.strictObject({
  type: z.literal("Polygon"),
  coordinates: z.array(polygonRingSchema).min(1),
});

const multiPointGeometrySchema = z.strictObject({
  type: z.literal("MultiPoint"),
  coordinates: z.array(positionSchema).min(1),
});

const multiPolygonGeometrySchema = z.strictObject({
  type: z.literal("MultiPolygon"),
  coordinates: z.array(z.array(polygonRingSchema).min(1)).min(1),
});

export const geoJsonGeometrySchema = z.discriminatedUnion("type", [
  pointGeometrySchema,
  lineStringGeometrySchema,
  polygonGeometrySchema,
  multiPointGeometrySchema,
  multiPolygonGeometrySchema,
]);

export const temporalValueSchema = z.discriminatedUnion("precision", [
  z.strictObject({
    precision: z.literal("exact"),
    instant: utcInstantSchema,
    sourceValue: z.string().min(1).max(512),
    sourceTimezone: z.string().min(1).max(128).nullable(),
  }),
  z.strictObject({
    precision: z.literal("date_only"),
    date: localDateSchema,
    sourceValue: z.string().min(1).max(512),
    sourceTimezone: z.string().min(1).max(128).nullable(),
  }),
  z.strictObject({
    precision: z.literal("unknown"),
    sourceValue: z.string().min(1).max(512).nullable(),
    sourceTimezone: z.string().min(1).max(128).nullable(),
  }),
]);

export const sourceDefinitionSchema = z
  .strictObject({
    key: sourceKeySchema,
    name: z.string().min(1).max(256),
    sourceKind: sourceKindSchema,
    authorityScopes: z.array(authorityScopeSchema).min(1),
    homepageUrl: httpsUrlSchema,
    dataUrl: httpsUrlSchema,
    expectedCadenceSeconds: z.number().int().positive(),
    staleAfterSeconds: z.number().int().positive(),
    enabledByDefault: z.boolean(),
    credentialEnv: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]*$/)
      .optional(),
    adapterName: adapterNameSchema,
    adapterVersion: versionSchema,
    contentPolicy: z.enum(contentPolicies),
    licensePolicy: z.string().min(1).max(256),
    notes: z.string().min(1).max(2_000),
  })
  .refine(
    (source) => source.staleAfterSeconds >= source.expectedCadenceSeconds,
    {
      message: "Stale threshold must not precede collection cadence",
      path: ["staleAfterSeconds"],
    },
  );

export const ingestionRunSchema = z
  .strictObject({
    id: uuidV7Schema,
    sourceKey: sourceKeySchema,
    startedAt: utcInstantSchema,
    finishedAt: utcInstantSchema.nullable(),
    status: ingestionStatusSchema,
    httpStatus: z.number().int().min(100).max(599).nullable(),
    latencyMs: z.number().int().nonnegative().nullable(),
    payloadHash: sha256Schema.nullable(),
    rawObjectKey: z.string().min(1).max(1_024).nullable(),
    itemCount: z.number().int().nonnegative(),
    errorClass: errorClassSchema.nullable(),
    errorDetailSafe: z.string().min(1).max(1_000).nullable(),
    collectorVersion: versionSchema,
  })
  .superRefine((run, context) => {
    if (run.status === "running" && run.finishedAt !== null) {
      context.addIssue({
        code: "custom",
        message: "A running ingestion must not have finishedAt",
        path: ["finishedAt"],
      });
    }
    if (run.status !== "running" && run.finishedAt === null) {
      context.addIssue({
        code: "custom",
        message: "A terminal ingestion must have finishedAt",
        path: ["finishedAt"],
      });
    }
    if (
      run.finishedAt !== null &&
      Date.parse(run.finishedAt) < Date.parse(run.startedAt)
    ) {
      context.addIssue({
        code: "custom",
        message: "finishedAt must not precede startedAt",
        path: ["finishedAt"],
      });
    }
  });

export const sourceItemSchema = z
  .strictObject({
    id: uuidV7Schema,
    sourceKey: sourceKeySchema,
    externalId: z.string().min(1).max(1_024).nullable(),
    canonicalUrl: httpsUrlSchema.nullable(),
    versionNumber: z.number().int().positive(),
    supersedesId: uuidV7Schema.nullable(),
    contentHash: sha256Schema,
    title: z.string().min(1).max(1_000).nullable(),
    language: languageTagSchema.nullable(),
    publishedTime: temporalValueSchema,
    modifiedTime: temporalValueSchema,
    retrievedAt: utcInstantSchema,
    recordedAt: utcInstantSchema,
    rawExcerpt: z.string().max(2_000).nullable(),
    rawPayload: z.record(z.string(), jsonValueSchema),
  })
  .superRefine((item, context) => {
    if (item.versionNumber === 1 && item.supersedesId !== null) {
      context.addIssue({
        code: "custom",
        message: "Version 1 cannot supersede another source item",
        path: ["supersedesId"],
      });
    }
    if (item.versionNumber > 1 && item.supersedesId === null) {
      context.addIssue({
        code: "custom",
        message: "A revised source item must identify the prior version",
        path: ["supersedesId"],
      });
    }
    if (Date.parse(item.recordedAt) < Date.parse(item.retrievedAt)) {
      context.addIssue({
        code: "custom",
        message: "recordedAt must not precede retrievedAt",
        path: ["recordedAt"],
      });
    }
  });

const observationBaseSchema = z
  .strictObject({
    id: uuidV7Schema,
    incidentId: uuidV7Schema,
    sourceItemId: uuidV7Schema,
    observationType: z.enum(observationTypes),
    observedTime: temporalValueSchema,
    effectiveTime: temporalValueSchema,
    geometry: geoJsonGeometrySchema.nullable(),
    geometryPrecisionM: z.number().finite().nonnegative().nullable(),
    measurements: z.record(z.string(), jsonValueSchema),
    quality: z.record(z.string(), jsonValueSchema),
    relevanceMethod: relevanceMethodSchema,
    parserVersion: versionSchema,
    recordedAt: utcInstantSchema,
    validationState: validationStateSchema,
    validationReasons: z.array(validationReasonCodeSchema),
  })
  .superRefine((observation, context) => {
    if (
      (observation.geometry === null) !==
      (observation.geometryPrecisionM === null)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Geometry and geometry precision must either both be present or both be null",
        path: ["geometryPrecisionM"],
      });
    }
    if (
      observation.validationState === "accepted" &&
      observation.validationReasons.length > 0
    ) {
      context.addIssue({
        code: "custom",
        message: "Accepted observations cannot retain validation reasons",
        path: ["validationReasons"],
      });
    }
    if (
      observation.validationState !== "accepted" &&
      observation.validationReasons.length === 0
    ) {
      context.addIssue({
        code: "custom",
        message: "Quarantined and rejected observations require a reason",
        path: ["validationReasons"],
      });
    }
  });

export const observationSchema = observationBaseSchema;

export const assertionSchema = z
  .strictObject({
    id: uuidV7Schema,
    incidentId: uuidV7Schema,
    observationId: uuidV7Schema,
    subjectType: z.string().min(1).max(128),
    subjectKey: z.string().min(1).max(512),
    predicate: z.string().min(1).max(128),
    value: jsonValueSchema,
    assertionType: assertionTypeSchema,
    authorityScope: authorityScopeSchema.nullable(),
    effectiveTime: temporalValueSchema,
    expiresAt: utcInstantSchema.nullable(),
    extractionMethod: extractionMethodSchema,
    extractionVersion: versionSchema,
    state: assertionStateSchema,
  })
  .superRefine((assertion, context) => {
    if (
      assertion.effectiveTime.precision === "exact" &&
      assertion.expiresAt !== null &&
      Date.parse(assertion.expiresAt) <=
        Date.parse(assertion.effectiveTime.instant)
    ) {
      context.addIssue({
        code: "custom",
        message: "expiresAt must follow effectiveTime",
        path: ["expiresAt"],
      });
    }
  });

const eventBaseShape = {
  id: uuidV7Schema,
  incidentId: uuidV7Schema,
  firstEffectiveTime: temporalValueSchema,
  lastEffectiveTime: temporalValueSchema,
  geometry: geoJsonGeometrySchema.nullable(),
  geometryPrecisionM: z.number().finite().nonnegative().nullable(),
  lifecycle: eventLifecycleSchema,
  verificationState: verificationStateSchema,
  currentSummaryEn: z.string().min(1).max(2_000).nullable(),
  currentSummaryEl: z.string().min(1).max(2_000).nullable(),
  translationState: z.enum(["complete", "partial", "unavailable"]),
  reconciliationVersion: versionSchema,
  recordedAt: utcInstantSchema,
} as const;

const eventBaseSchema = z.strictObject(eventBaseShape);

const protectiveInstructionEventSchema = eventBaseSchema.extend({
  eventType: z.literal("protective_instruction"),
  details: z.strictObject({
    instructionKind: z.enum(protectiveInstructionKinds),
    actionText: z.string().min(1).max(4_000),
    originalLanguage: languageTagSchema,
    originExplicit: z.boolean(),
    destinationExplicit: z.boolean(),
    affectedAreaExplicit: z.boolean(),
  }),
});

const officialStatusEventSchema = eventBaseSchema.extend({
  eventType: z.literal("official_status_transition"),
  details: z.strictObject({
    fromStatus: z.enum(normalizedOfficialStatuses),
    toStatus: z.enum(normalizedOfficialStatuses),
  }),
});

const thermalDetectionEventSchema = eventBaseSchema.extend({
  eventType: z.literal("thermal_detection"),
  details: z.strictObject({
    product: z.string().min(1).max(128),
    satellite: z.string().min(1).max(128),
    frpMw: z.number().finite().nonnegative().nullable(),
    confidence: z.union([z.string().min(1).max(32), z.number().finite()]),
    scanKm: z.number().finite().positive(),
    trackKm: z.number().finite().positive(),
  }),
});

const thermalPassEventSchema = eventBaseSchema.extend({
  eventType: z.literal("thermal_pass"),
  details: z.strictObject({
    product: z.string().min(1).max(128),
    satellite: z.string().min(1).max(128),
    passStart: utcInstantSchema,
    detectionCount: z.number().int().nonnegative(),
  }),
});

const roadConditionEventSchema = eventBaseSchema.extend({
  eventType: z.literal("road_condition"),
  details: z.strictObject({
    roadName: z.string().min(1).max(512),
    state: z.enum(roadConditionStates),
    direction: z.string().min(1).max(512).nullable(),
  }),
});

const settlementThreatEventSchema = eventBaseSchema.extend({
  eventType: z.literal("settlement_threat"),
  details: z.strictObject({
    settlementName: z.string().min(1).max(256),
    reportedRelationship: z.string().min(1).max(1_000),
  }),
});

const smokeObservationEventSchema = eventBaseSchema.extend({
  eventType: z.literal("smoke_observation"),
  details: z.discriminatedUnion("basis", [
    z.strictObject({
      basis: z.literal("observed"),
      description: z.string().min(1).max(1_000),
    }),
    z.strictObject({
      basis: z.literal("modeled"),
      description: z.string().min(1).max(1_000),
      modelVersion: versionSchema,
      inputVersion: versionSchema,
    }),
  ]),
});

const weatherObservationEventSchema = eventBaseSchema.extend({
  eventType: z.literal("weather_observation"),
  details: z.strictObject({
    basis: z.enum(["measured", "modeled"]),
    stationOrModel: z.string().min(1).max(256),
    windSpeedKmh: z.number().finite().nonnegative().nullable(),
    windGustKmh: z.number().finite().nonnegative().nullable(),
    windDirectionDeg: z.number().finite().min(0).lt(360).nullable(),
  }),
});

const weatherModelChangeEventSchema = eventBaseSchema.extend({
  eventType: z.literal("weather_model_change"),
  details: z.strictObject({
    model: z.string().min(1).max(256),
    modelRunAt: utcInstantSchema,
    changeCode: z.string().min(1).max(128),
  }),
});

const responseUpdateEventSchema = eventBaseSchema.extend({
  eventType: z.literal("response_update"),
  details: z.strictObject({
    resourceSummary: z.string().min(1).max(1_000),
  }),
});

const sourceCorrectionEventSchema = eventBaseSchema.extend({
  eventType: z.literal("source_correction"),
  details: z.strictObject({
    priorSourceItemId: uuidV7Schema,
    newSourceItemId: uuidV7Schema,
  }),
});

export const canonicalEventSchema = z
  .discriminatedUnion("eventType", [
    protectiveInstructionEventSchema,
    officialStatusEventSchema,
    thermalDetectionEventSchema,
    thermalPassEventSchema,
    roadConditionEventSchema,
    settlementThreatEventSchema,
    smokeObservationEventSchema,
    weatherObservationEventSchema,
    weatherModelChangeEventSchema,
    responseUpdateEventSchema,
    sourceCorrectionEventSchema,
  ])
  .superRefine((event, context) => {
    if ((event.geometry === null) !== (event.geometryPrecisionM === null)) {
      context.addIssue({
        code: "custom",
        message:
          "Geometry and geometry precision must either both be present or both be null",
        path: ["geometryPrecisionM"],
      });
    }
  });

export const eventEvidenceSchema = z.strictObject({
  eventId: uuidV7Schema,
  assertionId: uuidV7Schema,
  relationship: evidenceRelationshipSchema,
  rationaleCode: z.string().min(1).max(128),
  linkedBy: versionSchema,
});

export const protectiveActionSchema = z.strictObject({
  sourceEventId: uuidV7Schema,
  instructionEn: z.string().min(1).max(4_000).nullable(),
  instructionEl: z.string().min(1).max(4_000).nullable(),
  sourceLanguageText: z.string().min(1).max(4_000),
  sourceLanguage: languageTagSchema,
  sourceUrl: httpsUrlSchema,
  issuedAt: utcInstantSchema,
  origin: geoJsonGeometrySchema.nullable(),
  affectedArea: geoJsonGeometrySchema.nullable(),
  destination: geoJsonGeometrySchema.nullable(),
});

export const incidentStateSnapshotSchema = z.strictObject({
  id: uuidV7Schema,
  incidentId: uuidV7Schema,
  sequence: z.number().int().positive(),
  calculatedAt: utcInstantSchema,
  stateHash: sha256Schema,
  state: z.record(z.string(), jsonValueSchema),
  rulesetVersion: versionSchema,
});

export const materialChangeSchema = z
  .strictObject({
    id: uuidV7Schema,
    incidentId: uuidV7Schema,
    sequence: z.number().int().positive(),
    changeType: materialChangeTypeSchema,
    materiality: materialitySchema,
    calculatedAt: utcInstantSchema,
    beforeSnapshotId: uuidV7Schema.nullable(),
    afterSnapshotId: uuidV7Schema,
    ruleId: z.string().min(1).max(128),
    ruleVersion: z.number().int().positive(),
    evidenceEventIds: z.array(uuidV7Schema).min(1),
    summaryEn: z.string().min(1).max(2_000).nullable(),
    summaryEl: z.string().min(1).max(2_000).nullable(),
    protectiveAction: protectiveActionSchema.nullable(),
    notificationEligible: z.boolean(),
  })
  .superRefine((change, context) => {
    if (
      change.protectiveAction !== null &&
      change.changeType !== "protective_instruction"
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Only a protective-instruction change may contain a protective action",
        path: ["protectiveAction"],
      });
    }
    if (
      change.notificationEligible &&
      change.materiality === "low" &&
      change.protectiveAction !== null
    ) {
      context.addIssue({
        code: "custom",
        message: "A protective action cannot be low materiality",
        path: ["materiality"],
      });
    }
  });

export const sourceHealthSampleSchema = z.strictObject({
  id: uuidV7Schema,
  sourceKey: sourceKeySchema,
  sampledAt: utcInstantSchema,
  state: sourceHealthStateSchema,
  lastAttemptAt: utcInstantSchema.nullable(),
  lastSuccessAt: utcInstantSchema.nullable(),
  lastChangedPayloadAt: utcInstantSchema.nullable(),
  latestSourcePublicationAt: utcInstantSchema.nullable(),
  consecutiveFailures: z.number().int().nonnegative(),
  latencyMs: z.number().int().nonnegative().nullable(),
  errorClass: errorClassSchema.nullable(),
});

const fixtureRequestSchema = z.strictObject({
  method: z.enum(["GET", "POST"]),
  url: httpsUrlSchema,
  headers: z.record(z.string(), z.string()).default({}),
});

const fixtureTransportSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("http"),
    status: z.number().int().min(100).max(599),
    headers: z.record(z.string(), z.string()).default({}),
    body: z.string().max(100_000),
  }),
  z.strictObject({
    kind: z.literal("timeout"),
    safeMessage: z.string().min(1).max(500),
  }),
  z.strictObject({
    kind: z.literal("authentication"),
    status: z.union([z.literal(401), z.literal(403)]),
    safeMessage: z.string().min(1).max(500),
  }),
  z.strictObject({
    kind: z.literal("quota"),
    status: z.literal(429),
    retryAfterSeconds: z.number().int().positive().nullable(),
    safeMessage: z.string().min(1).max(500),
  }),
  z.strictObject({
    kind: z.literal("network"),
    safeMessage: z.string().min(1).max(500),
  }),
]);

export const adapterFixtureSchema = z.strictObject({
  fixtureVersion: z.literal(1),
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  identityKey: z.string().min(1).max(1_024).optional(),
  sourceKey: sourceKeySchema,
  adapterName: adapterNameSchema,
  scenario: adapterFixtureScenarioSchema,
  capturedAt: utcInstantSchema,
  request: fixtureRequestSchema,
  transport: fixtureTransportSchema,
  expected: z.strictObject({
    ingestionStatus: ingestionStatusSchema,
    itemCount: z.number().int().nonnegative(),
    validationState: validationStateSchema.nullable(),
    reasonCodes: z.array(validationReasonCodeSchema),
    semanticDelta: z.boolean(),
    protectiveActionCount: z.number().int().nonnegative(),
  }),
});

export type Uuid = z.infer<typeof uuidV7Schema>;
export type IsoDateTime = z.infer<typeof utcInstantSchema>;
export type LocalDate = z.infer<typeof localDateSchema>;
export type SourceKind = z.infer<typeof sourceKindSchema>;
export type AuthorityScope = z.infer<typeof authorityScopeSchema>;
export type TimePrecision = z.infer<typeof timePrecisionSchema>;
export type IngestionStatus = z.infer<typeof ingestionStatusSchema>;
export type ValidationState = z.infer<typeof validationStateSchema>;
export type ValidationReasonCode = z.infer<
  typeof validationReasonCodeSchema
>;
export type AssertionType = z.infer<typeof assertionTypeSchema>;
export type AssertionState = z.infer<typeof assertionStateSchema>;
export type EventLifecycle = z.infer<typeof eventLifecycleSchema>;
export type VerificationState = z.infer<typeof verificationStateSchema>;
export type EvidenceRelationship = z.infer<typeof evidenceRelationshipSchema>;
export type Materiality = z.infer<typeof materialitySchema>;
export type SourceHealthState = z.infer<typeof sourceHealthStateSchema>;
export type GeoJsonGeometry = z.infer<typeof geoJsonGeometrySchema>;
export type TemporalValue = z.infer<typeof temporalValueSchema>;
type ParsedSourceDefinition = z.infer<typeof sourceDefinitionSchema>;
export type SourceDefinition = Readonly<
  Omit<ParsedSourceDefinition, "authorityScopes"> & {
    readonly authorityScopes: readonly AuthorityScope[];
  }
>;
export type IngestionRun = z.infer<typeof ingestionRunSchema>;
export type SourceItem = z.infer<typeof sourceItemSchema>;
export type Observation = z.infer<typeof observationSchema>;
export type Assertion = z.infer<typeof assertionSchema>;
export type CanonicalEvent = z.infer<typeof canonicalEventSchema>;
export type EventEvidence = z.infer<typeof eventEvidenceSchema>;
export type ProtectiveAction = z.infer<typeof protectiveActionSchema>;
export type IncidentStateSnapshot = z.infer<
  typeof incidentStateSnapshotSchema
>;
export type MaterialChange = z.infer<typeof materialChangeSchema>;
export type SourceHealthSample = z.infer<typeof sourceHealthSampleSchema>;
export type AdapterFixture = z.infer<typeof adapterFixtureSchema>;
