import { z } from "zod";

import { CONTRACT_VERSION } from "./constants";
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
} from "./schemas";

const schemas = {
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

export type TruthJsonSchemaName = keyof typeof schemas;

export function truthJsonSchemaId(name: TruthJsonSchemaName): string {
  return `https://plomari-firewatch.org/schemas/truth/${CONTRACT_VERSION}/${name}.schema.json`;
}

export function buildTruthJsonSchema(name: TruthJsonSchemaName) {
  const schema = z.toJSONSchema(schemas[name], {
    target: "draft-2020-12",
    unrepresentable: "any",
    io: "input",
  });

  return {
    ...schema,
    $id: truthJsonSchemaId(name),
    title: `${name} truth-layer contract v${CONTRACT_VERSION}`,
    "x-contract-version": CONTRACT_VERSION,
  };
}

export const TRUTH_JSON_SCHEMAS = Object.freeze(
  Object.fromEntries(
    (Object.keys(schemas) as TruthJsonSchemaName[]).map((name) => [
      name,
      buildTruthJsonSchema(name),
    ]),
  ) as Record<TruthJsonSchemaName, ReturnType<typeof buildTruthJsonSchema>>,
);
