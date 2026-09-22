import { describe, expect, it } from "vitest";
import { isTransportFailure } from "./networkFailure";

describe("isTransportFailure", () => {
  it("does not classify API or application errors as an offline connection", () => {
    expect(isTransportFailure(new Error("Request failed: 500"), false)).toBe(false);
    expect(isTransportFailure(new Error("Invalid import file"), false)).toBe(false);
  });

  it("classifies browser network failures and elapsed timeouts as offline", () => {
    expect(isTransportFailure(new TypeError("Failed to fetch"), false)).toBe(true);
    expect(isTransportFailure(new Error("request aborted"), true)).toBe(true);
  });
});
