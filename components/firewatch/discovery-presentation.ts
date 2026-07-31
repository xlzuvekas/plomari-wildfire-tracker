import type {
  NearbyIncident,
  PublicDiscoveryTime,
  WildfireCandidate,
} from "@/lib/firewatch/v3";

const FALLBACK_LOCALE = "en-GB";

export type PresentedDiscoveryTime = Readonly<{
  dateTime: string | undefined;
  primary: string;
  context: string;
  title: string;
}>;

export type ValidatedDiscoveryOffset = Readonly<{
  at: string;
  minutes: number;
}>;

function safeLocale(locale: string | undefined): string {
  try {
    return (
      Intl.getCanonicalLocales(locale ?? FALLBACK_LOCALE)[0] ??
      FALLBACK_LOCALE
    );
  } catch {
    return FALLBACK_LOCALE;
  }
}

function formatUtcOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const absolute = Math.abs(minutes);
  const hours = Math.floor(absolute / 60);
  const remainder = absolute % 60;
  return `UTC${sign}${String(hours).padStart(2, "0")}:${String(
    remainder,
  ).padStart(2, "0")}`;
}

function utcOffset(instant: Date, timeZone: string): string {
  const value = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    timeZoneName: "longOffset",
  })
    .formatToParts(instant)
    .find((part) => part.type === "timeZoneName")?.value;
  if (!value || value === "GMT") return "UTC+00:00";
  return value.replace(/^GMT/u, "UTC");
}

function exactDateTime(instant: Date, timeZone: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(instant);
}

function calendarDate(date: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00.000Z`));
}

export function presentDiscoveryTime(
  value: PublicDiscoveryTime,
  timeZone: string,
  locale?: string,
  validatedOffset?: ValidatedDiscoveryOffset,
): PresentedDiscoveryTime {
  const resolvedLocale = safeLocale(locale);
  if (value.precision === "unknown") {
    return {
      dateTime: undefined,
      primary: "Time unknown",
      context: "No source timestamp supplied",
      title: "The source did not provide a usable event time.",
    };
  }
  if (value.precision === "date_only") {
    const calendarTimeZone = value.calendarTimeZone;
    return {
      dateTime: value.date,
      primary: calendarDate(value.date, resolvedLocale),
      context: `${calendarTimeZone} · date only · no clock supplied`,
      title: `Source precision is calendar date only in ${calendarTimeZone}.`,
    };
  }

  const instant = new Date(value.instant);
  const local = exactDateTime(instant, timeZone, resolvedLocale);
  const utc = exactDateTime(instant, "UTC", resolvedLocale);
  const offset =
    validatedOffset?.at === value.instant &&
    Number.isInteger(validatedOffset.minutes) &&
    Math.abs(validatedOffset.minutes) <= 14 * 60
      ? formatUtcOffset(validatedOffset.minutes)
      : utcOffset(instant, timeZone);
  return {
    dateTime: value.instant,
    primary: local,
    context: `${timeZone} · ${offset} · ${utc} UTC`,
    title: `${local} in ${timeZone} (${offset}); ${utc} UTC.`,
  };
}

export function localizedIncidentName(
  incident: NearbyIncident,
  locale?: string,
): string {
  const requested = safeLocale(locale).toLowerCase();
  const requestedLanguage = requested.split("-")[0];
  const names = Object.entries(incident.displayNames);
  return (
    names.find(([tag]) => tag.toLowerCase() === requested)?.[1] ??
    names.find(
      ([tag]) => tag.toLowerCase().split("-")[0] === requestedLanguage,
    )?.[1] ??
    names.find(([tag]) => tag.toLowerCase().startsWith("en"))?.[1] ??
    names[0]?.[1] ??
    incident.slug
  );
}

export function humanizeDiscoveryToken(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

export type DiscoverySelection =
  | Readonly<{
      kind: "candidate";
      candidateId: WildfireCandidate["candidateId"];
      cell: WildfireCandidate["displayArea"]["cell"];
    }>
  | Readonly<{
      kind: "incident";
      incidentId: NearbyIncident["incidentId"];
      slug: NearbyIncident["slug"];
      cell: string;
    }>;

export function discoverySelectionKey(
  selection: DiscoverySelection | null | undefined,
): string | null {
  if (!selection) return null;
  return selection.kind === "candidate"
    ? `candidate:${selection.candidateId}`
    : `incident:${selection.incidentId}`;
}
