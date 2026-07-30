import { describe, expect, test } from "vitest";

import {
  formatAreaDate,
  formatAreaDateTime,
  formatElapsedMinutes,
  normalizeAthensWallTime,
  parseZonedInstant,
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
      "29 Jul 2026 · 16:58 EEST",
    );
    expect(
      formatAreaDateTime("2026-07-29T13:58:00Z", "en", {
        includeOffset: true,
      }),
    ).toBe("29 Jul 2026 · 16:58 EEST (UTC+03:00)");
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
