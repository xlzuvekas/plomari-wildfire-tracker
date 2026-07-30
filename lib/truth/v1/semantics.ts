import {
  DEFAULT_FUTURE_TOLERANCE_SECONDS,
  validationReasonCodes,
} from "./constants";
import {
  sourceDefinitionSchema,
  type Assertion,
  type Observation,
  type SourceDefinition,
  type TemporalValue,
  type ValidationReasonCode,
  type ValidationState,
} from "./schemas";

export type SemanticValidationResult = {
  readonly state: ValidationState;
  readonly reasonCodes: readonly ValidationReasonCode[];
};

function uniqueReasons(
  reasons: readonly ValidationReasonCode[],
): readonly ValidationReasonCode[] {
  return [...new Set(reasons)];
}

export function validateTemporalValue(
  value: TemporalValue,
  now: string,
  futureToleranceSeconds = DEFAULT_FUTURE_TOLERANCE_SECONDS,
): SemanticValidationResult {
  if (value.precision !== "exact") {
    return { state: "accepted", reasonCodes: [] };
  }

  const nowMs = Date.parse(now);
  const valueMs = Date.parse(value.instant);
  if (!Number.isFinite(nowMs) || !Number.isFinite(valueMs)) {
    return { state: "rejected", reasonCodes: ["invalid_timestamp"] };
  }
  if (valueMs > nowMs + futureToleranceSeconds * 1_000) {
    return { state: "quarantined", reasonCodes: ["future_timestamp"] };
  }
  return { state: "accepted", reasonCodes: [] };
}

export function validateObservationTimes(
  observation: Observation,
  now: string,
  futureToleranceSeconds = DEFAULT_FUTURE_TOLERANCE_SECONDS,
): SemanticValidationResult {
  const observed = validateTemporalValue(
    observation.observedTime,
    now,
    futureToleranceSeconds,
  );
  const effective = validateTemporalValue(
    observation.effectiveTime,
    now,
    futureToleranceSeconds,
  );
  const reasons = uniqueReasons([
    ...observed.reasonCodes,
    ...effective.reasonCodes,
  ]);
  if (observed.state === "rejected" || effective.state === "rejected") {
    return { state: "rejected", reasonCodes: reasons };
  }
  if (observed.state === "quarantined" || effective.state === "quarantined") {
    return { state: "quarantined", reasonCodes: reasons };
  }
  return { state: "accepted", reasonCodes: [] };
}

export type ProtectiveActionProvenance = {
  readonly source: SourceDefinition;
  readonly observation: Observation;
  readonly assertion: Assertion;
};

export function validateProtectiveActionProvenance(
  provenance: ProtectiveActionProvenance,
): SemanticValidationResult {
  const reasons: ValidationReasonCode[] = [];
  const { source, observation, assertion } = provenance;

  if (
    source.sourceKind === "publisher" ||
    source.sourceKind === "public_broadcaster"
  ) {
    reasons.push("publisher_cannot_issue_protective_action");
  }
  if (
    source.sourceKind !== "official_alert" ||
    !source.authorityScopes.includes("protective_instruction")
  ) {
    reasons.push("untrusted_protective_instruction");
  }
  if (
    observation.validationState !== "accepted" ||
    observation.observationType !== "protective_instruction"
  ) {
    reasons.push("untrusted_protective_instruction");
  }
  if (
    assertion.assertionType !== "instruction" ||
    assertion.authorityScope !== "protective_instruction"
  ) {
    reasons.push("authority_scope_mismatch");
  }
  if (
    assertion.extractionMethod !== "source_field" &&
    assertion.extractionMethod !== "deterministic_parser"
  ) {
    reasons.push("untrusted_protective_instruction");
  }

  const unique = uniqueReasons(reasons);
  return unique.length === 0
    ? { state: "accepted", reasonCodes: [] }
    : { state: "rejected", reasonCodes: unique };
}

export function validateSourceRegistryDefinitions(
  registry: readonly SourceDefinition[],
): readonly string[] {
  const errors: string[] = [];
  const keys = new Set<string>();

  registry.forEach((source, index) => {
    const parsed = sourceDefinitionSchema.safeParse(source);
    if (!parsed.success) {
      parsed.error.issues.forEach((issue) => {
        errors.push(
          `${source.key || `source[${index}]`}: ${issue.path.join(".") || "root"} ${issue.message}`,
        );
      });
    }

    if (keys.has(source.key)) {
      errors.push(`duplicate source key: ${source.key}`);
    }
    keys.add(source.key);

    if (
      source.sourceKind === "publisher" &&
      source.authorityScopes.includes("protective_instruction")
    ) {
      errors.push(
        `${source.key}: publishers cannot hold protective-instruction authority`,
      );
    }
    if (
      source.sourceKind === "public_broadcaster" &&
      source.authorityScopes.includes("protective_instruction")
    ) {
      errors.push(
        `${source.key}: broadcasters cannot hold protective-instruction authority`,
      );
    }
  });

  return errors;
}

export function isValidationReasonCode(
  value: string,
): value is ValidationReasonCode {
  return (validationReasonCodes as readonly string[]).includes(value);
}
