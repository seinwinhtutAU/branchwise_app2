import { describe, expect, it } from "vitest";
import {
  addDays,
  mondayOf,
  monthLabel,
  previousPeriodLabel,
  weekLabel,
} from "./helpers";

describe("dashboard weeks", () => {
  it("finds the Monday of any day in a week", () => {
    // 2026-09-16 is a Wednesday, 2026-09-20 a Sunday.
    expect(mondayOf("2026-09-16")).toBe("2026-09-14");
    expect(mondayOf("2026-09-20")).toBe("2026-09-14");
    expect(mondayOf("2026-09-14")).toBe("2026-09-14");
  });

  it("steps forward and back by whole days across a month end", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("the comparison label for a day, a week and a longer range", () => {
  it("says weekday for a day or a week, dates for anything longer", () => {
    expect(previousPeriodLabel("daily", "2026-09-16", "2026-09-16", "year_ago")).toBe(
      "vs the same weekday last year",
    );
    expect(previousPeriodLabel("weekly", "2026-09-14", "2026-09-20", "year_ago")).toBe(
      "vs the same weekdays last year",
    );
    expect(previousPeriodLabel("monthly", "2026-09-01", "2026-09-30", "year_ago")).toBe(
      "vs the same dates last year",
    );
  });
});

describe("the Weekly and Monthly picker labels", () => {
  it("writes a week as its dates, with the year", () => {
    expect(weekLabel("2026-09-07")).toBe("Sep 7 - Sep 13, 2026");
    expect(weekLabel("2026-09-28")).toBe("Sep 28 - Oct 4, 2026");
  });

  it("carries both years when a week crosses New Year", () => {
    expect(weekLabel("2025-12-29")).toBe("Dec 29, 2025 - Jan 4, 2026");
  });

  it("writes a month as its days, ending today for the month in progress", () => {
    const today = new Date(2026, 8, 24);
    expect(monthLabel("2026-09", today)).toBe("Sep 1 - 24, 2026");
    expect(monthLabel("2026-08", today)).toBe("Aug 1 - 31, 2026");
    expect(monthLabel("2025-12", today)).toBe("Dec 1 - 31, 2025");
  });
});
