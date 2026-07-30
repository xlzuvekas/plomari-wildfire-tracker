import { getSourceDefinition } from "../source-registry";
import {
  decideSourceRevision,
  hashJson,
  sourceItemSemanticKey,
} from "./identity";
import {
  adapterFixtureSchema,
  sourceItemSchema,
  type AdapterFixture,
  type IngestionStatus,
  type JsonValue,
  type SourceItem,
} from "./schemas";

export type FixtureReplayContext = {
  readonly sourceItemId: string;
  readonly priorSourceItem:
    | {
        readonly id: string;
        readonly versionNumber: number;
        readonly contentHash: string;
      }
    | null;
  readonly recordedAt: string;
};

export type FixtureReplayResult = {
  readonly fixtureId: string;
  readonly sourceKey: string;
  readonly ingestionStatus: IngestionStatus;
  readonly errorClass:
    | "timeout"
    | "authentication"
    | "rate_limit"
    | "network"
    | null;
  readonly sourceItem: SourceItem | null;
  readonly semanticKey: string | null;
  readonly contentHash: string | null;
  readonly semanticDelta: "created" | "corrected" | "none";
  readonly protectiveActionCount: number;
};

function transportStatus(
  fixture: AdapterFixture,
): Pick<FixtureReplayResult, "ingestionStatus" | "errorClass"> {
  switch (fixture.transport.kind) {
    case "timeout":
      return { ingestionStatus: "failed", errorClass: "timeout" };
    case "authentication":
      return { ingestionStatus: "failed", errorClass: "authentication" };
    case "quota":
      return { ingestionStatus: "failed", errorClass: "rate_limit" };
    case "network":
      return { ingestionStatus: "failed", errorClass: "network" };
    case "http":
      return {
        ingestionStatus: fixture.expected.ingestionStatus,
        errorClass: null,
      };
  }
}

export function parseAdapterFixture(input: unknown): AdapterFixture {
  return adapterFixtureSchema.parse(input);
}

export function replayAdapterFixture(
  input: unknown,
  context: FixtureReplayContext,
): FixtureReplayResult {
  const fixture = parseAdapterFixture(input);
  const source = getSourceDefinition(fixture.sourceKey);
  if (!source) {
    throw new Error(`Fixture references unknown source: ${fixture.sourceKey}`);
  }
  if (source.adapterName !== fixture.adapterName) {
    throw new Error(
      `Fixture adapter ${fixture.adapterName} does not match ${source.adapterName}`,
    );
  }
  if (
    fixture.expected.protectiveActionCount > 0 &&
    (source.sourceKind !== "official_alert" ||
      !source.authorityScopes.includes("protective_instruction"))
  ) {
    throw new Error(
      `Source ${source.key} cannot produce an official protective action`,
    );
  }

  const status = transportStatus(fixture);
  if (
    fixture.transport.kind !== "http" ||
    fixture.expected.itemCount === 0 ||
    fixture.expected.validationState === "rejected"
  ) {
    return {
      fixtureId: fixture.id,
      sourceKey: fixture.sourceKey,
      ...status,
      sourceItem: null,
      semanticKey: null,
      contentHash: null,
      semanticDelta: "none",
      protectiveActionCount: 0,
    };
  }

  const rawPayload: Record<string, JsonValue> = {
    fixtureId: fixture.id,
    adapterName: fixture.adapterName,
    responseBody: fixture.transport.body,
  };
  const contentHash = hashJson(rawPayload);
  const externalId = fixture.identityKey ?? fixture.id;
  const semanticKey = sourceItemSemanticKey({
    sourceKey: fixture.sourceKey,
    externalId,
    canonicalUrl: fixture.request.url,
    sensorNaturalKey: null,
    normalizedTimestamp: fixture.capturedAt,
    payloadHash: contentHash,
  });
  const revision =
    context.priorSourceItem === null
      ? null
      : decideSourceRevision(context.priorSourceItem, contentHash);
  if (revision?.kind === "identical") {
    return {
      fixtureId: fixture.id,
      sourceKey: fixture.sourceKey,
      ...status,
      sourceItem: null,
      semanticKey,
      contentHash,
      semanticDelta: "none",
      protectiveActionCount: 0,
    };
  }
  const semanticDelta =
    revision === null
      ? "created"
      : "corrected";
  const versionNumber =
    revision
      ? revision.nextVersionNumber
      : (context.priorSourceItem?.versionNumber ?? 1);
  const supersedesId =
    revision ? context.priorSourceItem?.id ?? null : null;

  const sourceItem = sourceItemSchema.parse({
    id: context.sourceItemId,
    sourceKey: fixture.sourceKey,
    externalId,
    canonicalUrl: fixture.request.url,
    versionNumber,
    supersedesId,
    contentHash,
    title: null,
    language: null,
    publishedTime: {
      precision: "unknown",
      sourceValue: null,
      sourceTimezone: null,
    },
    modifiedTime: {
      precision: "unknown",
      sourceValue: null,
      sourceTimezone: null,
    },
    retrievedAt: fixture.capturedAt,
    recordedAt: context.recordedAt,
    rawExcerpt: null,
    rawPayload,
  });

  return {
    fixtureId: fixture.id,
    sourceKey: fixture.sourceKey,
    ...status,
    sourceItem,
    semanticKey,
    contentHash,
    semanticDelta,
    protectiveActionCount: fixture.expected.protectiveActionCount,
  };
}
