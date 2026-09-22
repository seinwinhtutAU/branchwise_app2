import { describe, expect, it } from "vitest";
import {
  formatRetailDate,
  formatRetailDateTime,
  formatRetailTime,
} from "./retailDateTime";

describe("retail date and time formatting", () => {
  it("uses one day-first date format", () => {
    expect(formatRetailDate("2026-09-02")).toBe("02 Sept 2026");
  });

  it("uses AM/PM time without source seconds", () => {
    expect(formatRetailTime("9:05 PM")).toBe("9:05 PM");
    expect(formatRetailTime("09:05:22")).toBe("9:05 AM");
  });

  it("combines timestamp dates and times with the same convention", () => {
    const timestamp = new Date("2026-09-02T09:05:22Z");
    const date = new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(timestamp);
    const hours = timestamp.getHours();
    const time = `${hours % 12 || 12}:${String(timestamp.getMinutes()).padStart(2, "0")} ${hours >= 12 ? "PM" : "AM"}`;

    expect(formatRetailDateTime("2026-09-02T09:05:22Z")).toBe(
      `${date} · ${time}`,
    );
  });

  it("treats legacy offset-less timestamps as UTC before converting them locally", () => {
    expect(formatRetailDateTime("2026-09-02T09:05:22")).toBe(
      formatRetailDateTime("2026-09-02T09:05:22Z"),
    );
  });
});
