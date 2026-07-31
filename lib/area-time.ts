export type AreaTimeLanguage = "en" | "el";

export const AREA_TIME_ZONE = "Europe/Athens";

const OFFSET_TIMESTAMP = /(?:Z|[+-]\d{2}:\d{2})$/i;
const LOCAL_DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/;

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

function safeTimeZone(value: string) {
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

export function parseZonedInstant(
  value: string | null | undefined,
): Date | null {
  if (!value || !OFFSET_TIMESTAMP.test(value)) return null;
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
  if (!LOCAL_DATE_TIME.test(value)) return null;

  const approximateUtc = new Date(`${value}Z`);
  if (Number.isNaN(approximateUtc.getTime())) return null;
  const firstOffset = offsetMinutesForInstant(approximateUtc, AREA_TIME_ZONE);
  if (firstOffset === null) return null;
  const candidate = new Date(
    approximateUtc.getTime() - firstOffset * 60_000,
  );
  const actualOffset = offsetMinutesForInstant(candidate, AREA_TIME_ZONE);
  if (actualOffset === null) return null;
  return `${value}${offsetSuffix(actualOffset)}`;
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
