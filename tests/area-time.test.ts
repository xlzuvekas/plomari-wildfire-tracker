import { describe, expect, test } from "vitest";

import {
  formatAreaDate,
  formatAreaDateTime,
  formatElapsedMinutes,
  normalizeAthensWallTime,
  parseZonedInstant,
  presentAreaDateTime,
  presentZonedDateTime,
  zonedDateTimeAttribute,
} from "../lib/area-time";

describe("area timestamps", () => {
  test("rejects timestamps whose timezone is not explicit", () => {
    expect(parseZonedInstant("2026-07-30T18:00")).toBeNull();
    expect(formatAreaDateTime("2026-07-30T18:00")).toBe("TIME UNKNOWN");
    expect(zonedDateTimeAttribute("2026-07-30T18:00")).toBeUndefined();
  });

  test("formats a complete date, local clock and Athens timezone", () => {
    expect(formatAreaDateTime("2026-07-29T13:58:00Z")).toBe(
      "29 Jul 2026 · 16:58 · Europe/Athens · UTC+03:00",
    );
    expect(
      formatAreaDateTime("2026-07-29T13:58:00Z", "en", {
        includeOffset: true,
      }),
    ).toBe("29 Jul 2026 · 16:58 · Europe/Athens · UTC+03:00");

    expect(presentAreaDateTime("2026-07-29T13:58:00Z")).toEqual({
      dateTime: "2026-07-29T13:58:00.000Z",
      primary: "29 Jul 2026 · 16:58",
      context: "Europe/Athens · UTC+03:00",
      label: "29 Jul 2026 · 16:58 · Europe/Athens · UTC+03:00",
    });
  });

  test("presents arbitrary IANA zones with the offset at each instant", () => {
    const winter = presentZonedDateTime("2026-03-29T00:30:00Z", {
      timeZone: "Europe/Paris",
      locale: "en-GB",
    });
    const summer = presentZonedDateTime("2026-03-29T02:30:00Z", {
      timeZone: "Europe/Paris",
      locale: "en-GB",
    });

    expect(winter.primary).toBe("29 Mar 2026 · 01:30");
    expect(winter.context).toBe("Europe/Paris · UTC+01:00");
    expect(summer.primary).toBe("29 Mar 2026 · 04:30");
    expect(summer.context).toBe("Europe/Paris · UTC+02:00");
  });

  test("fails closed for an invalid IANA zone", () => {
    expect(
      presentZonedDateTime("2026-07-29T13:58:00Z", {
        timeZone: "Not/A_Timezone",
      }),
    ).toEqual({
      dateTime: undefined,
      primary: "TIME UNKNOWN",
      context: "",
      label: "TIME UNKNOWN",
    });
  });

  test("formats date-only source semantics without inventing a clock time", () => {
    expect(formatAreaDate("2026-07-29T00:00:00Z")).toBe("29 Jul 2026");
  });

  test("normalizes the explicitly known Open-Meteo Athens wall-time contract", () => {
    expect(normalizeAthensWallTime("2026-07-30T18:00")).toBe(
      "2026-07-30T18:00+03:00",
    );
    expect(normalizeAthensWallTime("2026-01-30T18:00")).toBe(
      "2026-01-30T18:00+02:00",
    );
  });
});

describe("elapsed time semantics", () => {
  test("uses selected-time language in history and old language in Live", () => {
    expect(formatElapsedMinutes(877, "en", "selected")).toBe(
      "14 h 37 min before selected time",
    );
    expect(formatElapsedMinutes(45, "en", "now")).toBe("45 min old");
  });

  test("surfaces future source clocks instead of clamping them to zero", () => {
    expect(formatElapsedMinutes(-4, "en", "now")).toBe(
      "CLOCK MISMATCH · 4 min in future",
    );
  });
});
