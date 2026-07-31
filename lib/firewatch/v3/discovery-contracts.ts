import { z } from "zod";

import {
  AREA_GRID_VERSION,
  parseAreaCellKey,
} from "../map-context";
import {
  contractVersionSchema,
  incidentLifecycleSchema,
  languageTagSchema,
  localDateSchema,
  sourceKeySchema,
  utcInstantSchema,
  uuidV7Schema,
} from "../../truth/v1/schemas";

export const GLOBAL_DISCOVERY_SCHEMA_VERSION = 3 as const;
export const GLOBAL_DISCOVERY_POLICY_VERSION =
  "global-discovery-v1" as const;
export const GLOBAL_DISCOVERY_MAX_PAGE_SIZE = 100;
export const GLOBAL_DISCOVERY_MAX_CURSOR_LENGTH = 512;
export const GLOBAL_DISCOVERY_ORDERING =
  "known-at-desc-id-desc" as const;

const longitudeSchema = z.number().finite().min(-180).max(180);
const latitudeSchema = z.number().finite().min(-90).max(90);

const canonicalUuidV7Schema = uuidV7Schema.refine(
  (value) => value === value.toLowerCase(),
  "Expected a canonical lowercase UUIDv7",
);

const areaCellKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((value) => {
    const cell = parseAreaCellKey(value);
    return (
      cell?.cellKey === value &&
      cell.minimumSpanM >= 8_000 &&
      cell.minimumSpanM <= 80_000
    );
  }, {
    message: "Expected a canonical Firewatch coarse-area cell key",
  });

const ianaTimeZoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value }).format(0);
      return true;
    } catch {
      return false;
    }
  }, "Expected an IANA time-zone identifier");

const discoveryCutoffSchema = utcInstantSchema.refine(
  (value) => new Date(value).toISOString() === value,
  "Expected a canonical millisecond UTC discovery cutoff",
);

function utcOffsetMinutesAt(instant: string, timeZone: string): number | null {
  let offset: string | undefined;
  try {
    offset = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      timeZoneName: "longOffset",
    })
      .formatToParts(Date.parse(instant))
      .find((part) => part.type === "timeZoneName")?.value;
  } catch {
    return null;
  }
  if (offset === "GMT") return 0;
  const match = /^GMT([+-])(\d{2}):(\d{2})$/u.exec(offset ?? "");
  if (!match) return null;
  const [, sign, hours, minutes] = match;
  if (sign === undefined || hours === undefined || minutes === undefined) {
    return null;
  }
  const absolute = Number(hours) * 60 + Number(minutes);
  return sign === "-" ? -absolute : absolute;
}

function localDateAt(instant: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(Date.parse(instant));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/**
 * An opaque keyset-cursor shape. Clients may store and return this value, but
 * must not decode it or derive behavior from its contents. Shape validation
 * does not prove authenticity or binding; signed binding to endpoint, schema,
 * scope, cutoffs, and ordering remains a server implementation requirement.
 */
export const globalDiscoveryCursorSchema = z
  .string()
  .min(16)
  .max(GLOBAL_DISCOVERY_MAX_CURSOR_LENGTH)
  .regex(/^[A-Za-z0-9_-]+$/u, "Expected an opaque base64url cursor")
  .brand<"GlobalDiscoveryCursor">();

const areaBoundsSchema = z.strictObject({
  west: longitudeSchema,
  south: latitudeSchema,
  east: longitudeSchema,
  north: latitudeSchema,
});

/**
 * Public area geometry is always derived from a canonical coarse cell. It is
 * never an exact device fix or a browser-supplied arbitrary bounding box.
 */
export const coarseAreaScopeSchema = z
  .strictObject({
    kind: z.literal("coarse-area"),
    gridVersion: z.literal(AREA_GRID_VERSION),
    cell: areaCellKeySchema,
    bounds: areaBoundsSchema,
    minimumSpanM: z.number().int().min(8_000).max(80_000),
    timeZone: ianaTimeZoneSchema,
  })
  .superRefine((scope, context) => {
    const canonical = parseAreaCellKey(scope.cell);
    if (
      canonical === null ||
      scope.bounds.west !== canonical.bounds.west ||
      scope.bounds.south !== canonical.bounds.south ||
      scope.bounds.east !== canonical.bounds.east ||
      scope.bounds.north !== canonical.bounds.north ||
      scope.minimumSpanM !== canonical.minimumSpanM
    ) {
      context.addIssue({
        code: "custom",
        message: "Area scope must match its canonical coarse cell",
        path: ["bounds"],
      });
    }
  });

export const globalExploreScopeSchema = z.strictObject({
  kind: z.literal("global"),
  gridVersion: z.literal(AREA_GRID_VERSION),
});

const timeQuerySchema = z
  .strictObject({
    asOf: discoveryCutoffSchema,
    knownAt: discoveryCutoffSchema,
  })
  .superRefine((time, context) => {
    if (Date.parse(time.asOf) > Date.parse(time.knownAt)) {
      context.addIssue({
        code: "custom",
        message: "asOf must not follow knownAt",
        path: ["asOf"],
      });
    }
  });

/**
 * Event-time and knowledge-time cutoffs stay separate. All API instants are
 * UTC; timeZone controls civil-time presentation only and never filtering.
 */
export const discoveryTimeContextSchema = timeQuerySchema.extend({
  observedWindow: z.strictObject({
    from: utcInstantSchema,
    to: utcInstantSchema,
  }),
  timeZone: z.strictObject({
    id: ianaTimeZoneSchema,
    basis: z.enum(["scope", "display-preference", "utc-fallback"]),
    utcOffsetMinutesAtAsOf: z.number().int().min(-14 * 60).max(14 * 60),
  }),
  normalizedTimeZone: z.literal("UTC"),
  semantics: z.strictObject({
    asOf: z.literal("event-time-cutoff"),
    knownAt: z.literal("knowledge-time-cutoff"),
    observedWindow: z.literal("event-time-inclusion-window"),
    timeZone: z.literal("display-only"),
  }),
}).superRefine((time, context) => {
  if (Date.parse(time.observedWindow.from) > Date.parse(time.observedWindow.to)) {
    context.addIssue({
      code: "custom",
      message: "Observed window start must not follow its end",
      path: ["observedWindow", "from"],
    });
  }
  if (time.observedWindow.to !== time.asOf) {
    context.addIssue({
      code: "custom",
      message: "Observed window must end at the event-time cutoff",
      path: ["observedWindow", "to"],
    });
  }
  if (
    time.timeZone.utcOffsetMinutesAtAsOf !==
    utcOffsetMinutesAt(time.asOf, time.timeZone.id)
  ) {
    context.addIssue({
      code: "custom",
      message: "UTC offset must match the response cutoff in its IANA time zone",
      path: ["timeZone", "utcOffsetMinutesAtAsOf"],
    });
  }
});

/** Public event time that never fabricates precision absent from evidence. */
export const publicTemporalValueSchema = z.discriminatedUnion("precision", [
  z.strictObject({
    precision: z.literal("exact"),
    instant: utcInstantSchema,
  }),
  z.strictObject({
    precision: z.literal("date_only"),
    date: localDateSchema,
    calendarTimeZone: ianaTimeZoneSchema,
  }),
  z.strictObject({
    precision: z.literal("unknown"),
  }),
]);

const datedPublicTemporalValueSchema = z.discriminatedUnion("precision", [
  z.strictObject({
    precision: z.literal("exact"),
    instant: utcInstantSchema,
  }),
  z.strictObject({
    precision: z.literal("date_only"),
    date: localDateSchema,
    calendarTimeZone: ianaTimeZoneSchema,
  }),
]);

type PublicTemporalValue = z.output<typeof publicTemporalValueSchema>;

function comparePublicTemporalValues(
  left: PublicTemporalValue,
  right: PublicTemporalValue,
): "before" | "equal" | "after" | "indeterminate" {
  if (left.precision === "exact" && right.precision === "exact") {
    const difference = Date.parse(left.instant) - Date.parse(right.instant);
    return difference === 0 ? "equal" : difference < 0 ? "before" : "after";
  }
  if (
    left.precision === "date_only" &&
    right.precision === "date_only" &&
    left.calendarTimeZone === right.calendarTimeZone
  ) {
    return left.date === right.date
      ? "equal"
      : left.date < right.date
        ? "before"
        : "after";
  }
  return "indeterminate";
}

const requestPageSchema = z.strictObject({
  limit: z
    .number()
    .int()
    .min(1)
    .max(GLOBAL_DISCOVERY_MAX_PAGE_SIZE)
    .default(50),
  after: globalDiscoveryCursorSchema.nullable().default(null),
});

export const exploreDiscoveryRequestSchema = z.strictObject({
  schemaVersion: z.literal(GLOBAL_DISCOVERY_SCHEMA_VERSION),
  kind: z.literal("explore-candidates"),
  time: timeQuerySchema,
  page: requestPageSchema,
});

export const nearbyDiscoveryRequestSchema = z.strictObject({
  schemaVersion: z.literal(GLOBAL_DISCOVERY_SCHEMA_VERSION),
  kind: z.literal("nearby-incidents"),
  cell: areaCellKeySchema,
  time: timeQuerySchema,
  page: requestPageSchema,
});

const coverageBaseShape = {
  policyVersion: z.literal(GLOBAL_DISCOVERY_POLICY_VERSION),
  scope: z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("global"),
      gridVersion: z.literal(AREA_GRID_VERSION),
    }),
    z.strictObject({
      kind: z.literal("coarse-area"),
      gridVersion: z.literal(AREA_GRID_VERSION),
      cell: areaCellKeySchema,
    }),
  ]),
} as const;

const completedCoverageShape = {
  ...coverageBaseShape,
  checkedAt: utcInstantSchema,
  freshnessDeadline: utcInstantSchema,
  coveredEventWindow: z.strictObject({
    from: utcInstantSchema,
    through: utcInstantSchema,
  }),
  requiredPartitionCount: z.number().int().positive().max(1_000),
  completedPartitionCount: z.number().int().positive().max(1_000),
} as const;

/** Coverage quality and item presence are intentionally orthogonal. */
export const discoveryCoverageSchema = z
  .discriminatedUnion("state", [
    z.strictObject({
      state: z.literal("complete"),
      ...completedCoverageShape,
    }),
    z.strictObject({
      state: z.literal("stale"),
      ...completedCoverageShape,
      lastCompleteAt: utcInstantSchema,
    }),
    z.strictObject({
      state: z.literal("partial"),
      ...coverageBaseShape,
      checkedAt: utcInstantSchema,
      requiredPartitionCount: z.number().int().positive().max(1_000),
      completedPartitionCount: z.number().int().nonnegative().max(1_000),
    }),
    z.strictObject({
      state: z.literal("unavailable"),
      ...coverageBaseShape,
      checkedAt: utcInstantSchema,
      retryAfterSeconds: z.number().int().positive().max(86_400).nullable(),
    }),
    z.strictObject({
      state: z.literal("disabled"),
      ...coverageBaseShape,
    }),
    z.strictObject({
      state: z.literal("unconfigured"),
      ...coverageBaseShape,
    }),
    z.strictObject({
      state: z.literal("not_assessed"),
      ...coverageBaseShape,
    }),
  ])
  .superRefine((coverage, context) => {
    if (
      (coverage.state === "complete" || coverage.state === "stale") &&
      coverage.completedPartitionCount !== coverage.requiredPartitionCount
    ) {
      context.addIssue({
        code: "custom",
        message: "Complete coverage requires every policy partition",
        path: ["completedPartitionCount"],
      });
    }
    if (
      coverage.state === "partial" &&
      coverage.completedPartitionCount >= coverage.requiredPartitionCount
    ) {
      context.addIssue({
        code: "custom",
        message: "Partial coverage must be missing at least one partition",
        path: ["completedPartitionCount"],
      });
    }
    if (
      coverage.state === "complete" &&
      Date.parse(coverage.freshnessDeadline) < Date.parse(coverage.checkedAt)
    ) {
      context.addIssue({
        code: "custom",
        message: "Freshness deadline must not precede the coverage check",
        path: ["freshnessDeadline"],
      });
    }
    if (
      coverage.state === "stale" &&
      Date.parse(coverage.lastCompleteAt) > Date.parse(coverage.checkedAt)
    ) {
      context.addIssue({
        code: "custom",
        message: "Last complete time must not follow the coverage check",
        path: ["lastCompleteAt"],
      });
    }
    if (
      (coverage.state === "complete" || coverage.state === "stale") &&
      Date.parse(coverage.coveredEventWindow.from) >
        Date.parse(coverage.coveredEventWindow.through)
    ) {
      context.addIssue({
        code: "custom",
        message: "Covered event window start must not follow its end",
        path: ["coveredEventWindow", "from"],
      });
    }
  });

/**
 * valid-empty has mode-specific semantics. Neither mode claims wildfire
 * absence or an all-clear, and catalog-footprint emptiness alone cannot
 * authorize either result.
 */
const discoveryItemsResultSchema = z.strictObject({
  state: z.literal("items"),
});

const discoveryIndeterminateResultSchema = z.strictObject({
  state: z.literal("indeterminate"),
});

export const exploreDiscoveryResultSchema = z.discriminatedUnion("state", [
  discoveryItemsResultSchema,
  z.strictObject({
    state: z.literal("valid-empty"),
    messageCode: z.literal("no_known_candidates_in_scope"),
    assessment: z.literal("candidate_discovery_only"),
    allClearAssessment: z.literal("not_assessed"),
  }),
  discoveryIndeterminateResultSchema,
]);

export const nearbyDiscoveryResultSchema = z.discriminatedUnion("state", [
  discoveryItemsResultSchema,
  z.strictObject({
    state: z.literal("valid-empty"),
    messageCode: z.literal("no_known_incidents_in_area"),
    assessment: z.literal("known_incident_discovery_only"),
    allClearAssessment: z.literal("not_assessed"),
  }),
  discoveryIndeterminateResultSchema,
]);

export const discoveryResultSchema = z.union([
  exploreDiscoveryResultSchema,
  nearbyDiscoveryResultSchema,
]);

const responsePageSchema = z.strictObject({
  limit: z.number().int().min(1).max(GLOBAL_DISCOVERY_MAX_PAGE_SIZE),
  isFirstPage: z.boolean(),
  hasMore: z.boolean(),
  nextCursor: globalDiscoveryCursorSchema.nullable(),
});

const signalKindSchema = z.enum([
  "thermal_detection",
  "incident_summary",
  "hazard_advisory",
]);

export const wildfireCandidateSchema = z
  .strictObject({
    kind: z.literal("wildfire-candidate"),
    candidateId: canonicalUuidV7Schema,
    classification: z.literal("unconfirmed-signal"),
    displayArea: coarseAreaScopeSchema,
    basis: z.strictObject({
      signalKinds: z.array(signalKindSchema).min(1).max(8),
      observationCount: z.number().int().positive().max(1_000_000),
      sourceCount: z.number().int().positive().max(1_000),
    }),
    times: z.strictObject({
      firstObservedAt: publicTemporalValueSchema,
      latestObservedAt: datedPublicTemporalValueSchema,
      knownAt: utcInstantSchema,
    }),
  })
  .superRefine((candidate, context) => {
    if (
      new Set(candidate.basis.signalKinds).size !==
      candidate.basis.signalKinds.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Candidate signal kinds must be unique",
        path: ["basis", "signalKinds"],
      });
    }
    if (candidate.basis.sourceCount > candidate.basis.observationCount) {
      context.addIssue({
        code: "custom",
        message: "Candidate source count cannot exceed observation count",
        path: ["basis", "sourceCount"],
      });
    }
    if (
      comparePublicTemporalValues(
        candidate.times.firstObservedAt,
        candidate.times.latestObservedAt,
      ) === "after"
    ) {
      context.addIssue({
        code: "custom",
        message: "First observation must not follow the latest observation",
        path: ["times", "firstObservedAt"],
      });
    }
    if (
      candidate.times.latestObservedAt.precision === "exact" &&
      Date.parse(candidate.times.latestObservedAt.instant) >
        Date.parse(candidate.times.knownAt)
    ) {
      context.addIssue({
        code: "custom",
        message: "A candidate cannot be known before its latest observation",
        path: ["times", "knownAt"],
      });
    }
    for (const [field, value] of Object.entries({
      firstObservedAt: candidate.times.firstObservedAt,
      latestObservedAt: candidate.times.latestObservedAt,
    })) {
      if (
        value.precision === "date_only" &&
        value.date >
          localDateAt(candidate.times.knownAt, candidate.displayArea.timeZone)
      ) {
        context.addIssue({
          code: "custom",
          message: "A candidate observation date cannot follow its knowledge time",
          path: ["times", field],
        });
      }
    }
  });

const displayNamesSchema = z
  .record(languageTagSchema, z.string().trim().min(1).max(256))
  .refine(
    (names) => {
      const tags = Object.keys(names);
      return (
        tags.length >= 1 &&
        tags.length <= 6 &&
        tags.every((tag) => tag.length <= 35)
      );
    },
    "Incidents require one to six bounded localized display names",
  );

export const nearbyIncidentSchema = z
  .strictObject({
    kind: z.literal("incident"),
    contractVersion: contractVersionSchema,
    incidentId: canonicalUuidV7Schema,
    slug: sourceKeySchema.max(128),
    displayNames: displayNamesSchema,
    incidentKind: z.literal("wildfire"),
    lifecycle: incidentLifecycleSchema,
    areaRelationship: z.strictObject({
      kind: z.literal("intersects-cell"),
    }),
    times: z.strictObject({
      startedAt: publicTemporalValueSchema,
      latestObservedAt: datedPublicTemporalValueSchema,
      knownAt: utcInstantSchema,
    }),
  })
  .superRefine((incident, context) => {
    if (
      comparePublicTemporalValues(
        incident.times.startedAt,
        incident.times.latestObservedAt,
      ) === "after"
    ) {
      context.addIssue({
        code: "custom",
        message: "Incident start must not follow its latest observation",
        path: ["times", "startedAt"],
      });
    }
    if (
      incident.times.latestObservedAt.precision === "exact" &&
      Date.parse(incident.times.latestObservedAt.instant) >
        Date.parse(incident.times.knownAt)
    ) {
      context.addIssue({
        code: "custom",
        message: "An incident cannot be known before its latest observation",
        path: ["times", "knownAt"],
      });
    }
    if (
      incident.times.startedAt.precision === "exact" &&
      Date.parse(incident.times.startedAt.instant) >
        Date.parse(incident.times.knownAt)
    ) {
      context.addIssue({
        code: "custom",
        message: "An incident cannot be known before its start time",
        path: ["times", "knownAt"],
      });
    }
  });

type ResponseItemTime = Readonly<{
  id: string;
  eventTimes: readonly z.output<typeof publicTemporalValueSchema>[];
  inclusionTime: z.output<typeof datedPublicTemporalValueSchema>;
  knownAt: string;
}>;

type ResponseEnvelope = Readonly<{
  time: z.output<typeof discoveryTimeContextSchema>;
  coverage: z.output<typeof discoveryCoverageSchema>;
  result: z.output<typeof discoveryResultSchema>;
  page: z.output<typeof responsePageSchema>;
}>;

function addResponseEnvelopeIssues(
  response: ResponseEnvelope,
  itemTimes: readonly ResponseItemTime[],
  itemPath: "candidates" | "incidents",
  context: z.RefinementCtx,
) {
  const itemCount = itemTimes.length;
  const { coverage, page, result, time } = response;
  const knownAtMs = Date.parse(time.knownAt);
  const asOfMs = Date.parse(time.asOf);
  const observedFromMs = Date.parse(time.observedWindow.from);

  if (Date.parse(time.asOf) > knownAtMs) {
    context.addIssue({
      code: "custom",
      message: "asOf must not follow knownAt",
      path: ["time", "asOf"],
    });
  }
  if (itemCount > page.limit) {
    context.addIssue({
      code: "custom",
      message: "Response item count exceeds its page limit",
      path: ["page", "limit"],
    });
  }
  if (page.hasMore !== (page.nextCursor !== null)) {
    context.addIssue({
      code: "custom",
      message: "hasMore and nextCursor must agree",
      path: ["page", "nextCursor"],
    });
  }
  if (page.hasMore && itemCount !== page.limit) {
    context.addIssue({
      code: "custom",
      message: "A continuation cursor requires a full bounded page",
      path: ["page", "nextCursor"],
    });
  }

  if (coverage.state === "complete") {
    const deadlineMs = Date.parse(coverage.freshnessDeadline);
    if (Date.parse(coverage.checkedAt) > knownAtMs) {
      context.addIssue({
        code: "custom",
        message: "Coverage check cannot follow the knowledge cutoff",
        path: ["coverage", "checkedAt"],
      });
    }
    if (deadlineMs < knownAtMs) {
      context.addIssue({
        code: "custom",
        message: "Complete coverage must be current at the knowledge cutoff",
        path: ["coverage", "freshnessDeadline"],
      });
    }
    if (
      Date.parse(coverage.coveredEventWindow.through) >
      Date.parse(coverage.checkedAt)
    ) {
      context.addIssue({
        code: "custom",
        message: "Complete coverage cannot extend beyond its check time",
        path: ["coverage", "coveredEventWindow", "through"],
      });
    }
    if (
      Date.parse(coverage.coveredEventWindow.from) >
        Date.parse(time.observedWindow.from) ||
      Date.parse(coverage.coveredEventWindow.through) <
        Date.parse(time.observedWindow.to)
    ) {
      context.addIssue({
        code: "custom",
        message: "Complete coverage must span the full response observation window",
        path: ["coverage", "coveredEventWindow"],
      });
    }
  } else if (coverage.state === "stale") {
    if (Date.parse(coverage.checkedAt) > knownAtMs) {
      context.addIssue({
        code: "custom",
        message: "Coverage check cannot follow the knowledge cutoff",
        path: ["coverage", "checkedAt"],
      });
    }
    if (Date.parse(coverage.freshnessDeadline) >= knownAtMs) {
      context.addIssue({
        code: "custom",
        message: "Stale coverage must be expired at the knowledge cutoff",
        path: ["coverage", "freshnessDeadline"],
      });
    }
  } else if (
    (coverage.state === "partial" || coverage.state === "unavailable") &&
    Date.parse(coverage.checkedAt) > knownAtMs
  ) {
    context.addIssue({
      code: "custom",
      message: "Coverage check cannot follow the knowledge cutoff",
      path: ["coverage", "checkedAt"],
    });
  }

  const noCurrentRead =
    coverage.state === "unavailable" ||
    coverage.state === "disabled" ||
    coverage.state === "unconfigured";
  if (coverage.state === "complete") {
    if (
      (itemCount === 0 && result.state !== "valid-empty") ||
      (itemCount > 0 && result.state !== "items")
    ) {
      context.addIssue({
        code: "custom",
        message: "Complete coverage must explicitly distinguish items from valid-empty",
        path: ["result", "state"],
      });
    }
  } else if (itemCount === 0 && result.state !== "indeterminate") {
    context.addIssue({
      code: "custom",
      message: "Only complete coverage may authorize valid-empty",
      path: ["result", "state"],
    });
  } else if (itemCount > 0 && result.state !== "items") {
    context.addIssue({
      code: "custom",
      message: "A response containing items must use the items result state",
      path: ["result", "state"],
    });
  }
  if (noCurrentRead && itemCount > 0) {
    context.addIssue({
      code: "custom",
      message: "Unavailable, disabled, or unconfigured reads cannot publish items",
      path: ["result", "state"],
    });
  }
  if (result.state !== "items" && page.hasMore) {
    context.addIssue({
      code: "custom",
      message: "An empty result cannot expose a continuation cursor",
      path: ["page", "nextCursor"],
    });
  }
  if (result.state === "valid-empty" && !page.isFirstPage) {
    context.addIssue({
      code: "custom",
      message: "valid-empty is only meaningful on the first page",
      path: ["page", "isFirstPage"],
    });
  }

  for (const [index, item] of itemTimes.entries()) {
    if (Date.parse(item.knownAt) > knownAtMs) {
      context.addIssue({
        code: "custom",
        message: "Item knowledge time exceeds the response cutoff",
        path: [itemPath, index, "times", "knownAt"],
      });
    }
    for (const eventTime of item.eventTimes) {
      if (
        eventTime.precision === "exact" &&
        Date.parse(eventTime.instant) > asOfMs
      ) {
        context.addIssue({
          code: "custom",
          message: "Item event time exceeds the response cutoff",
          path: [itemPath, index, "times"],
        });
      }
      if (
        eventTime.precision === "date_only" &&
        eventTime.date >
          localDateAt(time.asOf, eventTime.calendarTimeZone)
      ) {
        context.addIssue({
          code: "custom",
          message: "Item event date exceeds the response cutoff",
          path: [itemPath, index, "times"],
        });
      }
      if (
        eventTime.precision === "date_only" &&
        eventTime.date >
          localDateAt(item.knownAt, eventTime.calendarTimeZone)
      ) {
        context.addIssue({
          code: "custom",
          message: "Item event date exceeds its knowledge time",
          path: [itemPath, index, "times"],
        });
      }
    }

    // Item inclusion is based on the latest observation. Its start/first
    // observation may legitimately precede the policy lookback window.
    if (
      item.inclusionTime.precision === "exact" &&
      Date.parse(item.inclusionTime.instant) < observedFromMs
    ) {
      context.addIssue({
        code: "custom",
        message: "Latest observation precedes the response observation window",
        path: [itemPath, index, "times", "latestObservedAt"],
      });
    }
    if (
      item.inclusionTime.precision === "date_only" &&
      item.inclusionTime.date <
        localDateAt(
          time.observedWindow.from,
          item.inclusionTime.calendarTimeZone,
        )
    ) {
      context.addIssue({
        code: "custom",
        message: "Latest observation date precedes the response observation window",
        path: [itemPath, index, "times", "latestObservedAt"],
      });
    }

    const previous = itemTimes[index - 1];
    const previousKnownAt = previous ? Date.parse(previous.knownAt) : null;
    const itemKnownAt = Date.parse(item.knownAt);
    if (
      previous &&
      previousKnownAt !== null &&
      (previousKnownAt < itemKnownAt ||
        (previousKnownAt === itemKnownAt && previous.id < item.id))
    ) {
      context.addIssue({
        code: "custom",
        message: `Items must use ${GLOBAL_DISCOVERY_ORDERING} ordering`,
        path: [itemPath, index],
      });
    }
  }
}

export const exploreDiscoveryResponseSchema = z
  .strictObject({
    schemaVersion: z.literal(GLOBAL_DISCOVERY_SCHEMA_VERSION),
    kind: z.literal("explore-candidates"),
    scope: globalExploreScopeSchema,
    time: discoveryTimeContextSchema,
    coverage: discoveryCoverageSchema,
    result: exploreDiscoveryResultSchema,
    candidates: z.array(wildfireCandidateSchema).max(
      GLOBAL_DISCOVERY_MAX_PAGE_SIZE,
    ),
    ordering: z.literal(GLOBAL_DISCOVERY_ORDERING),
    page: responsePageSchema,
  })
  .superRefine((response, context) => {
    if (
      response.time.timeZone.basis !== "utc-fallback" ||
      response.time.timeZone.id !== "UTC"
    ) {
      context.addIssue({
        code: "custom",
        message: "A global snapshot must use its cache-stable UTC fallback",
        path: ["time", "timeZone"],
      });
    }
    if (response.coverage.scope.kind !== "global") {
      context.addIssue({
        code: "custom",
        message: "Explore coverage must be bound to the global discovery scope",
        path: ["coverage", "scope"],
      });
    }
    const candidateIds = new Set<string>();
    response.candidates.forEach((candidate, index) => {
      if (candidateIds.has(candidate.candidateId)) {
        context.addIssue({
          code: "custom",
          message: "Candidate identifiers must be unique within a page",
          path: ["candidates", index, "candidateId"],
        });
      }
      candidateIds.add(candidate.candidateId);
    });
    addResponseEnvelopeIssues(
      response,
      response.candidates.map((candidate) => ({
        id: candidate.candidateId,
        eventTimes: [
          candidate.times.firstObservedAt,
          candidate.times.latestObservedAt,
        ],
        inclusionTime: candidate.times.latestObservedAt,
        knownAt: candidate.times.knownAt,
      })),
      "candidates",
      context,
    );
  });

export const nearbyDiscoveryResponseSchema = z
  .strictObject({
    schemaVersion: z.literal(GLOBAL_DISCOVERY_SCHEMA_VERSION),
    kind: z.literal("nearby-incidents"),
    scope: coarseAreaScopeSchema,
    time: discoveryTimeContextSchema,
    coverage: discoveryCoverageSchema,
    result: nearbyDiscoveryResultSchema,
    incidents: z.array(nearbyIncidentSchema).max(
      GLOBAL_DISCOVERY_MAX_PAGE_SIZE,
    ),
    ordering: z.literal(GLOBAL_DISCOVERY_ORDERING),
    page: responsePageSchema,
  })
  .superRefine((response, context) => {
    const usesUtcFallback = response.time.timeZone.basis === "utc-fallback";
    if (
      response.time.timeZone.basis !== "scope" &&
      !usesUtcFallback
    ) {
      context.addIssue({
        code: "custom",
        message:
          "A nearby response must use a server-resolved scope zone or an explicit UTC fallback",
        path: ["time", "timeZone", "basis"],
      });
    }
    if (
      usesUtcFallback &&
      (response.time.timeZone.id !== "UTC" ||
        response.scope.timeZone !== "UTC" ||
        response.incidents.length > 0 ||
        ![
          "disabled",
          "unavailable",
          "unconfigured",
          "not_assessed",
        ].includes(response.coverage.state))
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Nearby UTC fallback is allowed only for an empty read without assessed coverage",
        path: ["time", "timeZone", "basis"],
      });
    }
    if (response.time.timeZone.id !== response.scope.timeZone) {
      context.addIssue({
        code: "custom",
        message: "Nearby display time zone must match the resolved area scope",
        path: ["time", "timeZone", "id"],
      });
    }
    if (
      response.coverage.scope.kind !== "coarse-area" ||
      response.coverage.scope.cell !== response.scope.cell
    ) {
      context.addIssue({
        code: "custom",
        message: "Nearby coverage must be bound to the response coarse cell",
        path: ["coverage", "scope"],
      });
    }
    const incidentIds = new Set<string>();
    response.incidents.forEach((incident, index) => {
      if (incidentIds.has(incident.incidentId)) {
        context.addIssue({
          code: "custom",
          message: "Incident identifiers must be unique within a page",
          path: ["incidents", index, "incidentId"],
        });
      }
      incidentIds.add(incident.incidentId);
    });
    addResponseEnvelopeIssues(
      response,
      response.incidents.map((incident) => ({
        id: incident.incidentId,
        eventTimes: [
          incident.times.startedAt,
          incident.times.latestObservedAt,
        ],
        inclusionTime: incident.times.latestObservedAt,
        knownAt: incident.times.knownAt,
      })),
      "incidents",
      context,
    );
  });

type DiscoveryRequestBinding = Readonly<{
  time: z.output<typeof timeQuerySchema>;
  page: z.output<typeof requestPageSchema>;
}>;

type DiscoveryResponseBinding = Readonly<{
  time: z.output<typeof discoveryTimeContextSchema>;
  page: z.output<typeof responsePageSchema>;
}>;

function addRequestBindingIssues(
  request: DiscoveryRequestBinding,
  response: DiscoveryResponseBinding,
  context: z.RefinementCtx,
) {
  if (response.time.asOf !== request.time.asOf) {
    context.addIssue({
      code: "custom",
      message: "Response event-time cutoff must match the request",
      path: ["time", "asOf"],
    });
  }
  if (response.time.knownAt !== request.time.knownAt) {
    context.addIssue({
      code: "custom",
      message: "Response knowledge-time cutoff must match the request",
      path: ["time", "knownAt"],
    });
  }
  if (response.page.limit !== request.page.limit) {
    context.addIssue({
      code: "custom",
      message: "Response page limit must match the request",
      path: ["page", "limit"],
    });
  }
  if (response.page.isFirstPage !== (request.page.after === null)) {
    context.addIssue({
      code: "custom",
      message: "Response page position must match the request cursor",
      path: ["page", "isFirstPage"],
    });
  }
}

/**
 * Binds a structurally valid Explore response to one parsed request. The
 * server must additionally authenticate and bind the opaque cursor snapshot.
 */
export function exploreDiscoveryResponseForRequestSchema(
  request: z.output<typeof exploreDiscoveryRequestSchema>,
) {
  return exploreDiscoveryResponseSchema.superRefine((response, context) => {
    addRequestBindingIssues(request, response, context);
  });
}

/**
 * Binds a structurally valid Nearby response to one parsed request. The
 * server must additionally authenticate and bind the opaque cursor snapshot.
 */
export function nearbyDiscoveryResponseForRequestSchema(
  request: z.output<typeof nearbyDiscoveryRequestSchema>,
) {
  return nearbyDiscoveryResponseSchema.superRefine((response, context) => {
    addRequestBindingIssues(request, response, context);
    if (response.scope.cell !== request.cell) {
      context.addIssue({
        code: "custom",
        message: "Nearby response area must match the requested coarse cell",
        path: ["scope", "cell"],
      });
    }
  });
}

export type GlobalDiscoveryCursor = z.output<
  typeof globalDiscoveryCursorSchema
>;
export type CoarseAreaScope = z.output<typeof coarseAreaScopeSchema>;
export type DiscoveryTimeContext = z.output<
  typeof discoveryTimeContextSchema
>;
export type PublicDiscoveryTime = z.output<typeof publicTemporalValueSchema>;
export type DiscoveryCoverage = z.output<typeof discoveryCoverageSchema>;
export type DiscoveryResult = z.output<typeof discoveryResultSchema>;
export type ExploreDiscoveryRequest = z.output<
  typeof exploreDiscoveryRequestSchema
>;
export type NearbyDiscoveryRequest = z.output<
  typeof nearbyDiscoveryRequestSchema
>;
export type WildfireCandidate = z.output<typeof wildfireCandidateSchema>;
export type NearbyIncident = z.output<typeof nearbyIncidentSchema>;
export type ExploreDiscoveryResponse = z.output<
  typeof exploreDiscoveryResponseSchema
>;
export type NearbyDiscoveryResponse = z.output<
  typeof nearbyDiscoveryResponseSchema
>;
