export type AreaTimeLanguage = "en" | "el";

export const AREA_TIME_ZONE = "Europe/Athens";

const OFFSET_TIMESTAMP = /(?:Z|[+-]\d{2}:\d{2})$/i;
const ZONED_DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|([+-])(\d{2}):(\d{2}))$/i;
const LOCAL_DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;

type WallTimeParts = Readonly<{
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}>;

function validWallTime(parts: WallTimeParts) {
  const leapYear =
    parts.year % 4 === 0 &&
    (parts.year % 100 !== 0 || parts.year % 400 === 0);
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return (
    parts.month >= 1 &&
    parts.month <= 12 &&
    parts.day >= 1 &&
    parts.day <= (daysInMonth[parts.month - 1] ?? 0) &&
    parts.hour >= 0 &&
    parts.hour <= 23 &&
    parts.minute >= 0 &&
    parts.minute <= 59 &&
    parts.second >= 0 &&
    parts.second <= 59
  );
}

function wallTimeParts(match: RegExpMatchArray): WallTimeParts | null {
  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] ?? "0"),
    millisecond: Number((match[7] ?? "0").padEnd(3, "0").slice(0, 3)),
  };
  return validWallTime(parts) ? parts : null;
}

function areaLocale(language: AreaTimeLanguage) {
  return language === "el" ? "el-GR" : "en-GB";
}

function safeLocale(value: string | undefined) {
  try {
    return Intl.getCanonicalLocales(value ?? "en-GB")[0] ?? "en-GB";
  } catch {
    return "en-GB";
  }
}

function safeTimeZone(value: string | null | undefined) {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: value }).format(0);
    return value;
  } catch {
    return null;
  }
}

function part(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
) {
  return parts.find((candidate) => candidate.type === type)?.value ?? "";
}

function offsetForInstant(date: Date, timeZone: string) {
  const value = part(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      timeZoneName: "longOffset",
    }).formatToParts(date),
    "timeZoneName",
  );
  const normalized = value.replace(/^GMT/u, "UTC");
  return normalized === "UTC" ? "UTC+00:00" : normalized;
}

function offsetMinutesForInstant(date: Date, timeZone: string) {
  const offset = offsetForInstant(date, timeZone).match(
    /^UTC([+-])(\d{2}):(\d{2})$/,
  );
  if (!offset) return null;
  const minutes = Number(offset[2]) * 60 + Number(offset[3]);
  return offset[1] === "-" ? -minutes : minutes;
}

function offsetSuffix(offsetMinutes: number) {
  const sign = offsetMinutes < 0 ? "-" : "+";
  const absolute = Math.abs(offsetMinutes);
  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(
    absolute % 60,
  ).padStart(2, "0")}`;
}

function wallTimeAt(date: Date, timeZone: string): Omit<WallTimeParts, "millisecond"> {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return {
    year: Number(part(parts, "year")),
    month: Number(part(parts, "month")),
    day: Number(part(parts, "day")),
    hour: Number(part(parts, "hour")),
    minute: Number(part(parts, "minute")),
    second: Number(part(parts, "second")),
  };
}

function sameWallTime(
  actual: Omit<WallTimeParts, "millisecond">,
  expected: WallTimeParts,
) {
  return (
    actual.year === expected.year &&
    actual.month === expected.month &&
    actual.day === expected.day &&
    actual.hour === expected.hour &&
    actual.minute === expected.minute &&
    actual.second === expected.second
  );
}

export function parseZonedInstant(
  value: string | null | undefined,
): Date | null {
  if (!value) return null;
  const match = value.match(ZONED_DATE_TIME);
  const components = match ? wallTimeParts(match) : null;
  if (!match || components === null) return null;
  if (match[8] !== "Z" && match[8] !== "z") {
    const offsetHours = Number(match[10]);
    const offsetMinutes = Number(match[11]);
    if (
      offsetHours > 14 ||
      offsetMinutes > 59 ||
      (offsetHours === 14 && offsetMinutes !== 0)
    ) {
      return null;
    }
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Open-Meteo returns its requested Europe/Athens model time as a local wall
 * time. This adapter makes that provider contract explicit. Generic timestamp
 * formatting remains strict and rejects offset-less values.
 */
export function normalizeAthensWallTime(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  if (OFFSET_TIMESTAMP.test(value)) {
    return parseZonedInstant(value) ? value : null;
  }
  const match = value.match(LOCAL_DATE_TIME);
  const expected = match ? wallTimeParts(match) : null;
  if (match === null || expected === null) return null;

  const approximateUtc = new Date(
    Date.UTC(
      expected.year,
      expected.month - 1,
      expected.day,
      expected.hour,
      expected.minute,
      expected.second,
      expected.millisecond,
    ),
  );
  const possibleOffsets = new Set<number>();
  for (const deltaHours of [-36, 0, 36]) {
    const offset = offsetMinutesForInstant(
      new Date(approximateUtc.getTime() + deltaHours * 60 * 60_000),
      AREA_TIME_ZONE,
    );
    if (offset !== null) possibleOffsets.add(offset);
  }
  const matchingOffsets = [...possibleOffsets].filter((offset) => {
    const candidate = new Date(
      approximateUtc.getTime() - offset * 60_000,
    );
    return sameWallTime(wallTimeAt(candidate, AREA_TIME_ZONE), expected);
  });
  if (matchingOffsets.length !== 1) return null;
  return `${value}${offsetSuffix(matchingOffsets[0] ?? 0)}`;
}

export function zonedDateTimeAttribute(
  value: string | null | undefined,
): string | undefined {
  return parseZonedInstant(value)?.toISOString();
}

export type ZonedDateTimePresentation = Readonly<{
  dateTime: string | undefined;
  primary: string;
  context: string;
  label: string;
}>;

export type AreaDateTimePresentationOptions = Readonly<{
  includeSeconds?: boolean;
  includeWeekday?: boolean;
  includeTimeZone?: boolean;
  includeOffset?: boolean;
}>;

/**
 * Presents an offset-qualified instant in an explicit civil timezone. Invalid
 * timestamps and timezone identifiers fail closed instead of falling back to
 * the viewer's device timezone.
 */
export function presentZonedDateTime(
  value: string | null | undefined,
  options: Readonly<{
    timeZone: string;
    locale?: string;
    includeSeconds?: boolean;
    includeWeekday?: boolean;
    includeTimeZone?: boolean;
    includeOffset?: boolean;
    unknownLabel?: string;
  }>,
): ZonedDateTimePresentation {
  const parsed = parseZonedInstant(value);
  const timeZone = safeTimeZone(options.timeZone);
  if (!parsed || timeZone === null) {
    const unknown = options.unknownLabel ?? "TIME UNKNOWN";
    return {
      dateTime: undefined,
      primary: unknown,
      context: "",
      label: unknown,
    };
  }

  const parts = new Intl.DateTimeFormat(safeLocale(options.locale), {
    timeZone,
    weekday: options.includeWeekday ? "short" : undefined,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: options.includeSeconds ? "2-digit" : undefined,
    hourCycle: "h23",
  }).formatToParts(parsed);
  const weekday = options.includeWeekday
    ? `${part(parts, "weekday").replace(/\.$/u, "")} `
    : "";
  const date = `${weekday}${part(parts, "day")} ${part(parts, "month").replace(
    /\.$/u,
    "",
  )} ${part(parts, "year")}`;
  const clock = `${part(parts, "hour")}:${part(parts, "minute")}${
    options.includeSeconds ? `:${part(parts, "second")}` : ""
  }`;
  const primary = `${date} · ${clock}`;
  const context = [
    options.includeTimeZone === false ? null : timeZone,
    options.includeOffset === false ? null : offsetForInstant(parsed, timeZone),
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");
  return {
    dateTime: parsed.toISOString(),
    primary,
    context,
    label: context ? `${primary} · ${context}` : primary,
  };
}

export function presentAreaDateTime(
  value: string | null | undefined,
  language: AreaTimeLanguage = "en",
  options: AreaDateTimePresentationOptions = {},
): ZonedDateTimePresentation {
  return presentZonedDateTime(value, {
    timeZone: AREA_TIME_ZONE,
    locale: areaLocale(language),
    includeSeconds: options.includeSeconds,
    includeWeekday: options.includeWeekday,
    includeTimeZone: options.includeTimeZone,
    includeOffset: options.includeOffset,
    unknownLabel: language === "el" ? "ΑΓΝΩΣΤΗ ΩΡΑ" : "TIME UNKNOWN",
  });
}

export function formatAreaDateTime(
  value: string | null | undefined,
  language: AreaTimeLanguage = "en",
  options: AreaDateTimePresentationOptions = {},
) {
  return presentAreaDateTime(value, language, options).label;
}

export function formatAreaDate(
  value: string | null | undefined,
  language: AreaTimeLanguage = "en",
) {
  const parsed = parseZonedInstant(value);
  if (!parsed) {
    return language === "el" ? "ΑΓΝΩΣΤΗ ΗΜΕΡΟΜΗΝΙΑ" : "DATE UNKNOWN";
  }
  return new Intl.DateTimeFormat(areaLocale(language), {
    timeZone: AREA_TIME_ZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(parsed);
}

export function formatElapsedMinutes(
  ageMinutes: number | null | undefined,
  language: AreaTimeLanguage,
  reference: "now" | "selected",
) {
  if (ageMinutes === null || ageMinutes === undefined) {
    return language === "el" ? "άγνωστη ηλικία" : "age unknown";
  }
  if (ageMinutes < 0) {
    const minutes = Math.max(1, Math.abs(ageMinutes));
    return language === "el"
      ? `ΑΣΥΜΦΩΝΙΑ ΡΟΛΟΓΙΟΥ · ${minutes} λ στο μέλλον`
      : `CLOCK MISMATCH · ${minutes} min in future`;
  }

  const minutesLabel = (minutes: number) =>
    language === "el" ? `${minutes} λ` : `${minutes} min`;
  const hoursLabel = (minutes: number) => {
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return language === "el"
      ? `${hours} ω${remainder ? ` ${remainder} λ` : ""}`
      : `${hours} h${remainder ? ` ${remainder} min` : ""}`;
  };
  const daysLabel = (minutes: number) => {
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    return language === "el"
      ? `${days} η ${hours % 24} ω`
      : `${days} d ${hours % 24} h`;
  };
  const duration =
    ageMinutes < 60
      ? minutesLabel(ageMinutes)
      : ageMinutes < 24 * 60
        ? hoursLabel(ageMinutes)
        : daysLabel(ageMinutes);

  if (reference === "selected") {
    return language === "el"
      ? `${duration} πριν από τον επιλεγμένο χρόνο`
      : `${duration} before selected time`;
  }
  return language === "el" ? `${duration} παλαιό` : `${duration} old`;
}
