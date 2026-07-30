import { z } from "zod";

import {
  sha256Schema,
  utcInstantSchema,
  uuidV7Schema,
} from "../truth/v1/schemas";

const safeText = (maximum: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(maximum)
    .refine(
      (value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value),
      "Control characters are not allowed",
    );

const distinctReferences = (references: readonly string[]) =>
  new Set(references).size === references.length;

const evidenceReferences = (minimum = 1, maximum = 12) =>
  z
    .array(uuidV7Schema)
    .min(minimum)
    .max(maximum)
    .refine(distinctReferences, "Evidence references must be unique");

export const oodaEvidenceItemSchema = z.strictObject({
  evidenceId: uuidV7Schema,
  sourceId: uuidV7Schema,
  sourceLabel: safeText(160),
  sourceClass: z.enum([
    "authoritative",
    "official_observation",
    "official_aggregate",
    "modeled",
    "community",
    "publisher",
  ]),
  verificationState: z.enum([
    "verified",
    "corroborated",
    "unverified",
    "disputed",
    "retracted",
  ]),
  evidenceKind: z.enum([
    "official_update",
    "sensor_observation",
    "weather_context",
    "publisher_report",
    "material_change",
  ]),
  title: safeText(240),
  excerpt: safeText(2_000),
  observedAt: utcInstantSchema.nullable(),
  publishedAt: utcInstantSchema.nullable(),
  retrievedAt: utcInstantSchema,
  timePrecision: z.enum(["instant", "date", "unknown"]),
});

export const oodaSourceHealthSchema = z.strictObject({
  sourceId: uuidV7Schema,
  sourceLabel: safeText(160),
  status: z.enum([
    "healthy",
    "degraded",
    "stale",
    "unavailable",
    "unconfigured",
  ]),
  checkedAt: utcInstantSchema,
  detail: safeText(320),
});

export const oodaEvidenceBundleSchema = z
  .strictObject({
    schemaVersion: z.literal("1.0.0"),
    language: z.literal("en"),
    incident: z.strictObject({
      incidentId: uuidV7Schema,
      incidentLabel: safeText(200),
      aoiVersionId: uuidV7Schema,
    }),
    snapshot: z.strictObject({
      snapshotId: uuidV7Schema,
      snapshotHash: sha256Schema,
      asOf: utcInstantSchema,
      knownAt: utcInstantSchema,
    }),
    evidence: z.array(oodaEvidenceItemSchema).min(1).max(64),
    sourceHealth: z.array(oodaSourceHealthSchema).max(64),
  })
  .superRefine((bundle, context) => {
    const asOfEpoch = Date.parse(bundle.snapshot.asOf);
    const knownAtEpoch = Date.parse(bundle.snapshot.knownAt);
    if (knownAtEpoch < asOfEpoch) {
      context.addIssue({
        code: "custom",
        message: "The knowledge cutoff cannot precede the situation cutoff",
        path: ["snapshot", "knownAt"],
      });
    }

    bundle.evidence.forEach((item, index) => {
      if (item.observedAt && Date.parse(item.observedAt) > asOfEpoch) {
        context.addIssue({
          code: "custom",
          message: "Observed evidence cannot be later than the situation cutoff",
          path: ["evidence", index, "observedAt"],
        });
      }
      if (item.publishedAt && Date.parse(item.publishedAt) > knownAtEpoch) {
        context.addIssue({
          code: "custom",
          message: "Published evidence cannot be later than the knowledge cutoff",
          path: ["evidence", index, "publishedAt"],
        });
      }
      if (Date.parse(item.retrievedAt) > knownAtEpoch) {
        context.addIssue({
          code: "custom",
          message: "Retrieved evidence cannot be later than the knowledge cutoff",
          path: ["evidence", index, "retrievedAt"],
        });
      }
    });

    bundle.sourceHealth.forEach((source, index) => {
      if (Date.parse(source.checkedAt) > knownAtEpoch) {
        context.addIssue({
          code: "custom",
          message: "Source health cannot be later than the knowledge cutoff",
          path: ["sourceHealth", index, "checkedAt"],
        });
      }
    });

    const evidenceIds = bundle.evidence.map((item) => item.evidenceId);
    if (!distinctReferences(evidenceIds)) {
      context.addIssue({
        code: "custom",
        message: "Evidence IDs must be unique within a bundle",
        path: ["evidence"],
      });
    }
  });

const citedStatementSchema = z.strictObject({
  text: safeText(800),
  evidenceRefs: evidenceReferences(),
});

const changeSchema = z.strictObject({
  kind: z.enum([
    "official_update",
    "sensor_change",
    "weather_context",
    "publisher_report",
    "source_health",
  ]),
  text: safeText(600),
  evidenceRefs: evidenceReferences(),
});

const conflictSchema = z.strictObject({
  text: safeText(600),
  evidenceRefs: evidenceReferences(2),
});

const informationGapSchema = z.strictObject({
  text: safeText(500),
  sourceRefs: evidenceReferences(),
});

const reviewQuestionSchema = z.strictObject({
  priority: z.enum(["urgent", "soon", "routine"]),
  text: safeText(500),
  evidenceRefs: evidenceReferences(),
});

export const orientationOutputSchema = z.strictObject({
  schemaVersion: z.literal("1.0.0"),
  situation: citedStatementSchema,
  noteworthyChanges: z.array(changeSchema).max(12),
  conflicts: z.array(conflictSchema).max(8),
  informationGaps: z.array(informationGapSchema).max(12),
  reviewQuestions: z.array(reviewQuestionSchema).max(12),
  limitations: z.array(safeText(400)).min(1).max(10),
});

export type OodaEvidenceBundle = z.infer<typeof oodaEvidenceBundleSchema>;
export type OrientationOutput = z.infer<typeof orientationOutputSchema>;

export const orientationOutputJsonSchema = z.toJSONSchema(
  orientationOutputSchema,
  { target: "draft-7" },
);

const OPERATIONAL_DIRECTIVE_PATTERN =
  /\b(?:all[- ]clear|evacuate(?:\s+now)?|leave\s+now|safe\s+to\s+return|shelter\s+in\s+place|stay\s+put|take\s+(?:the\s+)?(?:road|route)|must\s+move|do\s+not\s+evacuate)\b/iu;
const IMPERATIVE_ACTION_PATTERN =
  /(?:^|[.!?]\s+)(?:please\s+)?(?:avoid|depart|drive|evacuate|flee|follow|go|head|leave|move|proceed|relocate|return|run|shelter|stay|take|travel|use|walk)\b/imu;
const MODAL_ACTION_PATTERN =
  /\b(?:are\s+advised\s+to|is\s+advised\s+to|must|need(?:s)?\s+to|ought\s+to|should)\s+(?:avoid|depart|drive|evacuate|flee|follow|go|head|leave|move|proceed|relocate|return|run|shelter|stay|take|travel|use|walk)\b/iu;

export class OrientationValidationError extends Error {
  readonly code = "invalid_orientation";

  constructor() {
    super("The generated orientation did not pass safety validation.");
    this.name = "OrientationValidationError";
  }
}

/**
 * Validates references against the exact input manifest and rejects imperative
 * public-safety language. This is defense in depth; the model has no write or
 * publication authority even when this validation succeeds.
 */
export function validateOrientationOutput(
  candidate: unknown,
  bundle: OodaEvidenceBundle,
): OrientationOutput {
  const parsed = orientationOutputSchema.safeParse(candidate);
  if (!parsed.success) throw new OrientationValidationError();

  const evidenceIds = new Set(bundle.evidence.map((item) => item.evidenceId));
  const sourceIds = new Set([
    ...bundle.evidence.map((item) => item.sourceId),
    ...bundle.sourceHealth.map((item) => item.sourceId),
  ]);
  const statements = [
    parsed.data.situation,
    ...parsed.data.noteworthyChanges,
    ...parsed.data.conflicts,
    ...parsed.data.reviewQuestions,
  ];

  if (
    statements.some((statement) =>
      statement.evidenceRefs.some((reference) => !evidenceIds.has(reference)),
    ) ||
    parsed.data.informationGaps.some((gap) =>
      gap.sourceRefs.some((reference) => !sourceIds.has(reference)),
    )
  ) {
    throw new OrientationValidationError();
  }

  const generatedText = [
    ...statements.map((statement) => statement.text),
    ...parsed.data.informationGaps.map((gap) => gap.text),
    ...parsed.data.limitations,
  ].join("\n");

  if (
    OPERATIONAL_DIRECTIVE_PATTERN.test(generatedText) ||
    IMPERATIVE_ACTION_PATTERN.test(generatedText) ||
    MODAL_ACTION_PATTERN.test(generatedText)
  ) {
    throw new OrientationValidationError();
  }

  return Object.freeze(parsed.data);
}
