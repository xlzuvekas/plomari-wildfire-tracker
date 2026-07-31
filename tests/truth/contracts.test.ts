import { describe, expect, it } from "vitest";

import * as truthV1 from "../../lib/truth/v1";
import {
  assertionSchema,
  canonicalEventSchema,
  collectionTargetRevisionSchema,
  collectionTargetSchema,
  endpointBoundSourceItemSchema,
  eventEvidenceSchema,
  globalObservationSchema,
  incidentObservationLinkSchema,
  incidentSchema,
  incidentSourceBindingSchema,
  incidentStateSnapshotSchema,
  ingestionRunSchema,
  materialChangeSchema,
  observationSchema,
  protectiveActionSchema,
  sourceDefinitionSchema,
  sourceEndpointSchema,
  sourceHealthSampleSchema,
  sourceItemSchema,
  sourceProviderSchema,
  sha256Text,
  targetedIngestionRunSchema,
  targetedSourceHealthSampleSchema,
  temporalValueSchema,
  TRUTH_JSON_SCHEMAS,
  truthJsonSchemaId,
  utcInstantSchema,
  upgradeLegacyV10IngestionRun,
  type TruthJsonSchemaName,
} from "../../lib/truth/v1";
import {
  VALID_SCHEMA_EXAMPLES,
  validCanonicalEvent,
  validCollectionTargetRevision,
  validEndpointBoundSourceItem,
  validGlobalObservation,
  validIngestionRun,
  validIncident,
  validIncidentObservationLink,
  validObservation,
  validSourceItem,
  validTargetedSourceHealthSample,
  validTargetedIngestionRun,
} from "../fixtures/canonical-entities";

type ExportedJsonSchema = {
  readonly required?: readonly string[];
  readonly properties?: Readonly<
    Record<
      string,
      {
        readonly const?: unknown;
        readonly pattern?: string;
      }
    >
  >;
  readonly anyOf?: readonly ExportedJsonSchema[];
  readonly oneOf?: readonly ExportedJsonSchema[];
  readonly [key: string]: unknown;
};

function requiresContractVersion(schema: ExportedJsonSchema): boolean {
  if (
    schema.required?.includes("contractVersion") &&
    schema.properties?.contractVersion?.const === "1.1.0"
  ) {
    return true;
  }
  const branches = schema.anyOf ?? schema.oneOf;
  return Boolean(
    branches &&
      branches.length > 0 &&
      branches.every((branch) => requiresContractVersion(branch)),
  );
}

const schemaByName = {
  incident: incidentSchema,
  sourceProvider: sourceProviderSchema,
  sourceEndpoint: sourceEndpointSchema,
  collectionTarget: collectionTargetSchema,
  collectionTargetRevision: collectionTargetRevisionSchema,
  incidentSourceBinding: incidentSourceBindingSchema,
  sourceDefinition: sourceDefinitionSchema,
  ingestionRun: ingestionRunSchema,
  targetedIngestionRun: targetedIngestionRunSchema,
  sourceItem: sourceItemSchema,
  endpointBoundSourceItem: endpointBoundSourceItemSchema,
  globalObservation: globalObservationSchema,
  incidentObservationLink: incidentObservationLinkSchema,
  observation: observationSchema,
  assertion: assertionSchema,
  canonicalEvent: canonicalEventSchema,
  eventEvidence: eventEvidenceSchema,
  protectiveAction: protectiveActionSchema,
  incidentStateSnapshot: incidentStateSnapshotSchema,
  materialChange: materialChangeSchema,
  sourceHealthSample: sourceHealthSampleSchema,
  targetedSourceHealthSample: targetedSourceHealthSampleSchema,
} as const;

const persistedSchemaNames = (
  Object.keys(schemaByName) as TruthJsonSchemaName[]
).filter((name) => name !== "sourceDefinition");

describe("truth-layer v1 runtime contracts", () => {
  it.each(Object.keys(schemaByName) as TruthJsonSchemaName[])(
    "accepts the canonical %s fixture",
    (name) => {
      expect(() =>
        schemaByName[name].parse(VALID_SCHEMA_EXAMPLES[name]),
      ).not.toThrow();
    },
  );

  it.each(Object.keys(schemaByName) as TruthJsonSchemaName[])(
    "rejects unknown fields on %s",
    (name) => {
      const invalid = {
        ...VALID_SCHEMA_EXAMPLES[name],
        undocumentedField: true,
      };
      expect(schemaByName[name].safeParse(invalid).success).toBe(false);
    },
  );

  it("rejects UUIDs that are not UUIDv7", () => {
    expect(
      sourceItemSchema.safeParse({
        ...validSourceItem,
        id: "550e8400-e29b-41d4-a716-446655440000",
      }).success,
    ).toBe(false);
  });

  it("requires canonical UTC instants instead of local clock strings", () => {
    expect(
      ingestionRunSchema.safeParse({
        ...validIngestionRun,
        startedAt: "2026-07-29T16:59:00+03:00",
      }).success,
    ).toBe(false);
  });

  it("rejects impossible UTC calendar dates instead of normalizing them", () => {
    expect(
      utcInstantSchema.safeParse("2026-02-30T12:00:00.000Z").success,
    ).toBe(false);
    expect(
      utcInstantSchema.safeParse("2026-04-31T12:00:00.000Z").success,
    ).toBe(false);
    expect(
      utcInstantSchema.safeParse("2026-02-28T12:00:00.000000000Z").success,
    ).toBe(true);
  });

  it("retains date-only precision without fabricating midnight", () => {
    const result = temporalValueSchema.parse({
      precision: "date_only",
      date: "2026-07-29",
      sourceValue: "29/07/2026",
      sourceTimezone: "Europe/Athens",
    });

    expect(result.precision).toBe("date_only");
    expect("instant" in result).toBe(false);
  });

  it("rejects malformed exact times instead of guessing", () => {
    expect(
      temporalValueSchema.safeParse({
        precision: "exact",
        instant: "tomorrow afternoon",
        sourceValue: "tomorrow afternoon",
        sourceTimezone: "Europe/Athens",
      }).success,
    ).toBe(false);
  });

  it("rejects open polygon rings and out-of-range coordinates", () => {
    const openRing = {
      ...validObservation,
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [26.3, 38.9],
            [26.4, 38.9],
            [26.4, 39.0],
            [26.3, 39.0],
          ],
        ],
      },
    };
    const invalidLatitude = {
      ...validObservation,
      geometry: {
        type: "Point",
        coordinates: [26.3, 100],
      },
    };

    expect(observationSchema.safeParse(openRing).success).toBe(false);
    expect(observationSchema.safeParse(invalidLatitude).success).toBe(false);
  });

  it("requires a validation reason for quarantined observations", () => {
    expect(
      observationSchema.safeParse({
        ...validObservation,
        validationState: "quarantined",
        validationReasons: [],
      }).success,
    ).toBe(false);
  });

  it("enforces ingestion lifecycle timestamps", () => {
    expect(
      ingestionRunSchema.safeParse({
        ...validIngestionRun,
        status: "running",
      }).success,
    ).toBe(false);
    expect(
      ingestionRunSchema.safeParse({
        ...validIngestionRun,
        status: "failed",
        finishedAt: null,
      }).success,
    ).toBe(false);
  });

  it("requires explicit contract provenance and upgrades v1.0 only through the named adapter", () => {
    const legacyRun: Record<string, unknown> = { ...validIngestionRun };
    delete legacyRun.contractVersion;
    delete legacyRun.collectionTargetId;

    expect(ingestionRunSchema.safeParse(legacyRun).success).toBe(false);
    expect(targetedIngestionRunSchema.safeParse(legacyRun).success).toBe(false);

    const upgraded = upgradeLegacyV10IngestionRun(legacyRun, {
      collectionTargetId: validTargetedIngestionRun.collectionTargetId,
      collectionTargetRevisionId:
        validTargetedIngestionRun.collectionTargetRevisionId,
    });
    expect(upgraded).toMatchObject({
      sourceContractVersion: "1.0.0",
      targetContractVersion: "1.1.0",
      adapter: "legacy-v1.0-ingestion-run-to-v1.1-targeted-v1",
      legacySourceKey: "112-greece",
      value: {
        contractVersion: "1.1.0",
        collectionTargetId: validTargetedIngestionRun.collectionTargetId,
        collectionTargetRevisionId:
          validTargetedIngestionRun.collectionTargetRevisionId,
      },
    });
  });

  it("requires collection target identity on canonical health and ingestion records", () => {
    expect(
      targetedIngestionRunSchema.safeParse({
        ...validTargetedIngestionRun,
        collectionTargetId: null,
      }).success,
    ).toBe(false);
    expect(
      targetedSourceHealthSampleSchema.safeParse({
        ...validTargetedSourceHealthSample,
        collectionTargetId: null,
      }).success,
    ).toBe(false);
  });

  it("does not accept a free legacy source key on canonical target/endpoint records", () => {
    expect(
      targetedIngestionRunSchema.safeParse({
        ...validTargetedIngestionRun,
        sourceKey: "mismatched-source",
      }).success,
    ).toBe(false);
    expect(
      targetedSourceHealthSampleSchema.safeParse({
        ...validTargetedSourceHealthSample,
        sourceKey: "mismatched-source",
      }).success,
    ).toBe(false);
    expect(
      endpointBoundSourceItemSchema.safeParse({
        ...validEndpointBoundSourceItem,
        sourceKey: "mismatched-source",
      }).success,
    ).toBe(false);
  });

  it("requires immutable target revision identity and configuration hash", () => {
    expect(collectionTargetRevisionSchema.parse(validCollectionTargetRevision))
      .toMatchObject({
        versionNumber: 1,
        supersedesId: null,
        identityAlgorithmVersion: "2.0.0",
      });
    expect(
      targetedIngestionRunSchema.safeParse({
        ...validTargetedIngestionRun,
        collectionTargetRevisionId: undefined,
      }).success,
    ).toBe(false);
  });

  it("requires assertion recording time and snapshot hash provenance", () => {
    expect(
      assertionSchema.safeParse({
        ...VALID_SCHEMA_EXAMPLES.assertion,
        recordedAt: undefined,
      }).success,
    ).toBe(false);
    expect(
      incidentStateSnapshotSchema.safeParse({
        ...VALID_SCHEMA_EXAMPLES.incidentStateSnapshot,
        identityAlgorithmVersion: undefined,
      }).success,
    ).toBe(false);
  });

  it("keeps replay-only protective validation outside the public barrel", () => {
    expect(truthV1).not.toHaveProperty(
      "validateLegacyReplayProtectiveActionProvenance",
    );
    expect(truthV1).toHaveProperty("validateProtectiveActionProvenance");
  });

  it("keeps observations global and records incident relevance separately", () => {
    expect(globalObservationSchema.parse(validGlobalObservation)).not.toHaveProperty(
      "incidentId",
    );
    expect(
      globalObservationSchema.safeParse({
        ...validGlobalObservation,
        incidentId: validIncident.id,
      }).success,
    ).toBe(false);

    const link = incidentObservationLinkSchema.parse(
      validIncidentObservationLink,
    );
    expect(link.incidentAreaVersion).toBe(1);
    expect(link.incidentAreaOfInterest).toEqual(validIncident.areaOfInterest);
  });

  it("accepts missing FIRMS pixel dimensions without inventing values", () => {
    expect(() =>
      canonicalEventSchema.parse({
        ...validCanonicalEvent,
        eventType: "thermal_detection",
        details: {
          product: "VIIRS_NOAA20_NRT",
          satellite: "NOAA-20",
          frpMw: 8.1,
          confidence: "nominal",
          scanKm: null,
          trackKm: null,
        },
      }),
    ).not.toThrow();
  });

  it.each(persistedSchemaNames)(
    "requires an explicit supported contractVersion on %s",
    (name) => {
      const missing: Record<string, unknown> = {
        ...VALID_SCHEMA_EXAMPLES[name],
      };
      delete missing.contractVersion;
      expect(schemaByName[name].safeParse(missing).success).toBe(false);
      expect(
        schemaByName[name].safeParse({
          ...VALID_SCHEMA_EXAMPLES[name],
          contractVersion: "1.0.0",
        }).success,
      ).toBe(false);
    },
  );
});

describe("versioned JSON Schema exports", () => {
  it.each(Object.keys(TRUTH_JSON_SCHEMAS) as TruthJsonSchemaName[])(
    "exports stable Draft 2020-12 metadata for %s",
    (name) => {
      const schema = TRUTH_JSON_SCHEMAS[name];
      expect(schema.$schema).toBe(
        "https://json-schema.org/draft/2020-12/schema",
      );
      expect(schema.$id).toBe(truthJsonSchemaId(name));
      expect(schema["x-contract-version"]).toBe("1.1.0");
      expect(JSON.stringify(schema)).toBe(
        JSON.stringify(TRUTH_JSON_SCHEMAS[name]),
      );
    },
  );

  it.each(persistedSchemaNames)(
    "marks contractVersion required and constant in %s JSON Schema",
    (name) => {
      const schema = TRUTH_JSON_SCHEMAS[name] as ExportedJsonSchema;
      expect(requiresContractVersion(schema)).toBe(true);
    },
  );

  it("exports required canonical identity references without a legacy sourceKey", () => {
    const run = TRUTH_JSON_SCHEMAS.targetedIngestionRun as ExportedJsonSchema;
    const health =
      TRUTH_JSON_SCHEMAS.targetedSourceHealthSample as ExportedJsonSchema;
    const item =
      TRUTH_JSON_SCHEMAS.endpointBoundSourceItem as ExportedJsonSchema;

    expect(run.required).toEqual(
      expect.arrayContaining([
        "collectionTargetId",
        "collectionTargetRevisionId",
      ]),
    );
    expect(run.properties).not.toHaveProperty("sourceKey");
    expect(health.required).toEqual(
      expect.arrayContaining([
        "collectionTargetId",
        "collectionTargetRevisionId",
      ]),
    );
    expect(health.properties).not.toHaveProperty("sourceKey");
    expect(item.required).toEqual(
      expect.arrayContaining([
        "identityAlgorithmVersion",
        "sourceEndpointId",
        "ingestionRunId",
      ]),
    );
    expect(item.properties).not.toHaveProperty("sourceKey");
    expect(
      (TRUTH_JSON_SCHEMAS.assertion as ExportedJsonSchema).required,
    ).toContain("recordedAt");
    expect(
      (TRUTH_JSON_SCHEMAS.incidentStateSnapshot as ExportedJsonSchema)
        .required,
    ).toContain("identityAlgorithmVersion");
  });

  it("retains UUIDv7 patterns in generated JSON Schema", () => {
    const schema = TRUTH_JSON_SCHEMAS.incident as ExportedJsonSchema;
    const pattern = schema.properties?.id?.pattern;
    expect(pattern).toBeTypeOf("string");
    const uuidPattern = new RegExp(pattern!, "i");
    expect(uuidPattern.test(validIncident.id)).toBe(true);
    expect(uuidPattern.test("550e8400-e29b-41d4-a716-446655440000")).toBe(
      false,
    );
  });

  it("labels cross-field rules that JSON Schema cannot represent", () => {
    const revision =
      TRUTH_JSON_SCHEMAS.collectionTargetRevision as ExportedJsonSchema;
    expect(revision["x-runtime-refinements"]).toEqual(
      expect.arrayContaining([
        "revision/supersedes lifecycle",
        "configurationHash verification against canonical configuration",
      ]),
    );
    expect(revision["x-runtime-validation-note"]).toMatch(
      /runtime contract and named registry or repository validators/,
    );
  });

  it("matches the reviewed golden digest for all generated contracts", () => {
    expect(sha256Text(JSON.stringify(TRUTH_JSON_SCHEMAS))).toBe(
      "99c858e07575ae4aeac56374192556a37c54ea02e68edfa5232141b427396f38",
    );
  });
});
