import { describe, expect, test } from "vitest";

import {
  LIVE_AS_OF,
  asOfEpochFromRangeValue,
  clampAsOfEpoch,
  effectiveAsOfEpoch,
  filterAtOrBefore,
  isTimestampVisibleAt,
  latestAtOrBefore,
  liveAsOfRangeMaximum,
  timestampEpoch,
  type AsOfSelection,
} from "../lib/as-of";

const START = Date.parse("2026-07-29T10:30:00Z");
const NOW = Date.parse("2026-07-30T10:30:00Z");
const AS_OF: AsOfSelection = {
  mode: "historical",
  epochMs: Date.parse("2026-07-29T14:00:00Z"),
};

describe("as-of bounds", () => {
  test("clamps historical values to the incident and current-time bounds", () => {
    expect(clampAsOfEpoch(START - 1, START, NOW)).toBe(START);
    expect(clampAsOfEpoch(START + 1, START, NOW)).toBe(START + 1);
    expect(clampAsOfEpoch(NOW + 1, START, NOW)).toBe(NOW);
    expect(clampAsOfEpoch(Number.NaN, START, NOW)).toBe(START);
  });

  test("rejects invalid bounds", () => {
    expect(() => clampAsOfEpoch(START, NOW, START)).toThrow(RangeError);
  });

  test("resolves Live to current time and preserves a historical selection", () => {
    expect(effectiveAsOfEpoch(LIVE_AS_OF, NOW)).toBe(NOW);
    expect(effectiveAsOfEpoch(AS_OF, NOW)).toBe(AS_OF.epochMs);
  });

  test("reserves the range right edge for the explicit Live sentinel", () => {
    const step = 15 * 60_000;
    for (const remainder of [0, 1, 7, 8, 14]) {
      const currentTime = NOW + remainder * 60_000;
      const maximum = liveAsOfRangeMaximum(START, currentTime, step);
      expect((maximum - START) % step).toBe(0);
      expect(maximum).toBeGreaterThanOrEqual(currentTime);
      expect(maximum - currentTime).toBeLessThan(step);
      expect(
        asOfEpochFromRangeValue(maximum, START, currentTime, step),
      ).toBeNull();
      if (maximum > START) {
        expect(
          asOfEpochFromRangeValue(
            maximum - step,
            START,
            currentTime,
            step,
          ),
        ).toBe(maximum - step);
      }
    }
  });

  test("rejects an invalid range step", () => {
    expect(() => asOfEpochFromRangeValue(NOW, START, NOW, 0)).toThrow(
      RangeError,
    );
  });
});

describe("source-time visibility", () => {
  const items = [
    { id: "before", at: "2026-07-29T13:59:59Z" },
    { id: "exact", at: "2026-07-29T14:00:00Z" },
    { id: "after", at: "2026-07-29T14:00:01Z" },
    { id: "unknown", at: null },
    { id: "invalid", at: "not-a-date" },
  ];

  test("keeps every current response item in Live, including unknown times", () => {
    expect(filterAtOrBefore(items, (item) => item.at, LIVE_AS_OF)).toEqual(
      items,
    );
    expect(isTimestampVisibleAt(null, LIVE_AS_OF)).toBe(true);
  });

  test("keeps only known timestamps at or before a historical cutoff", () => {
    expect(filterAtOrBefore(items, (item) => item.at, AS_OF)).toEqual([
      items[0],
      items[1],
    ]);
    expect(isTimestampVisibleAt(null, AS_OF)).toBe(false);
    expect(isTimestampVisibleAt("not-a-date", AS_OF)).toBe(false);
  });

  test("selects the latest eligible known observation", () => {
    expect(latestAtOrBefore(items, (item) => item.at, AS_OF)?.id).toBe(
      "exact",
    );
    expect(latestAtOrBefore(items, (item) => item.at, LIVE_AS_OF)?.id).toBe(
      "after",
    );
  });

  test("normalizes unknown timestamps to null", () => {
    expect(timestampEpoch(undefined)).toBeNull();
    expect(timestampEpoch("not-a-date")).toBeNull();
    expect(timestampEpoch("2026-02-29T10:00:00Z")).toBeNull();
    expect(timestampEpoch("2026-07-30T24:00:00Z")).toBeNull();
    expect(timestampEpoch("2026-07-30T10:00:00")).toBeNull();
  });
});
