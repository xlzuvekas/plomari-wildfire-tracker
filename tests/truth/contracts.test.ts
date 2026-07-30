import { describe, expect, it } from "vitest";

import {
  assertionSchema,
  canonicalEventSchema,
  eventEvidenceSchema,
  incidentStateSnapshotSchema,
  ingestionRunSchema,
  materialChangeSchema,
  observationSchema,
  protectiveActionSchema,
  sourceDefinitionSchema,
  sourceHealthSampleSchema,
  sourceItemSchema,
  temporalValueSchema,
  TRUTH_JSON_SCHEMAS,
  truthJsonSchemaId,
  type TruthJsonSchemaName,
} from "../../lib/truth/v1";
import {
  VALID_SCHEMA_EXAMPLES,
  validIngestionRun,
  validObservation,
  validSourceItem,
} from "../fixtures/canonical-entities";

const schemaByName = {
  sourceDefinition: sourceDefinitionSchema,
  ingestionRun: ingestionRunSchema,
  sourceItem: sourceItemSchema,
  observation: observationSchema,
  assertion: assertionSchema,
  canonicalEvent: canonicalEventSchema,
  eventEvidence: eventEvidenceSchema,
  protectiveAction: protectiveActionSchema,
  incidentStateSnapshot: incidentStateSnapshotSchema,
  materialChange: materialChangeSchema,
  sourceHealthSample: sourceHealthSampleSchema,
} as const;

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
      expect(schema["x-contract-version"]).toBe("1.0.0");
      expect(JSON.stringify(schema)).toBe(
        JSON.stringify(TRUTH_JSON_SCHEMAS[name]),
      );
    },
  );
});
