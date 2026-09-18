import { describe, expect, it } from "vitest";
import {
  pairsToQuantityShorthand,
  parseQuantityShorthand,
  quantityShorthandPairs,
  quantityShorthandProblem,
} from "./shared";

describe("parseQuantityShorthand", () => {
  it("reads a bare number as one piece with no unit of its own", () => {
    expect(parseQuantityShorthand("13")).toEqual([{ qty: 13, unit: undefined }]);
  });

  it("reads a single lettered piece", () => {
    expect(parseQuantityShorthand("13p")).toEqual([{ qty: 13, unit: "pair" }]);
    expect(parseQuantityShorthand("2s")).toEqual([{ qty: 2, unit: "set" }]);
    expect(parseQuantityShorthand("1d")).toEqual([{ qty: 1, unit: "dozen" }]);
  });

  it("reads several pieces run together with no separator", () => {
    expect(parseQuantityShorthand("1s3p")).toEqual([
      { qty: 1, unit: "set" },
      { qty: 3, unit: "pair" },
    ]);
  });

  it("treats a comma, a plus, or a space as the same as no separator at all", () => {
    const expected = [
      { qty: 1, unit: "set" },
      { qty: 3, unit: "pair" },
    ];
    expect(parseQuantityShorthand("1s+3p")).toEqual(expected);
    expect(parseQuantityShorthand("1s,3p")).toEqual(expected);
    expect(parseQuantityShorthand("1s 3p")).toEqual(expected);
  });

  it("is empty for a blank box", () => {
    expect(parseQuantityShorthand("")).toEqual([]);
    expect(parseQuantityShorthand("   ")).toEqual([]);
  });
});

describe("quantityShorthandPairs", () => {
  it("reads a bare number in the field's own unit", () => {
    expect(quantityShorthandPairs("13", "pair")).toBe(13);
    expect(quantityShorthandPairs("2", "set")).toBe(12);
  });

  it("adds up mixed pieces regardless of the field's own unit", () => {
    // 1 set (6 pairs) + 3 pairs = 9 pairs, whatever unit the box itself defaults to.
    expect(quantityShorthandPairs("1s3p", "pair")).toBe(9);
    expect(quantityShorthandPairs("1s3p", "set")).toBe(9);
  });

  it("is 0 for an empty box", () => {
    expect(quantityShorthandPairs("", "pair")).toBe(0);
  });
});

describe("quantityShorthandProblem", () => {
  it("accepts a blank box, a bare number, and a lettered piece", () => {
    expect(quantityShorthandProblem("")).toBeNull();
    expect(quantityShorthandProblem("13")).toBeNull();
    expect(quantityShorthandProblem("13p")).toBeNull();
  });

  it("accepts several lettered pieces, with or without separators", () => {
    expect(quantityShorthandProblem("1s3p")).toBeNull();
    expect(quantityShorthandProblem("1s+3p")).toBeNull();
    expect(quantityShorthandProblem("1s, 3p")).toBeNull();
  });

  it("rejects a second piece with no unit of its own — ambiguous once there's more than one", () => {
    expect(quantityShorthandProblem("1s3")).not.toBeNull();
  });

  it("rejects a piece with an unrecognised letter", () => {
    expect(quantityShorthandProblem("13x")).not.toBeNull();
  });

  it("rejects a zero or negative count", () => {
    expect(quantityShorthandProblem("0p")).not.toBeNull();
  });

  it("rejects text with no digits at all", () => {
    expect(quantityShorthandProblem("abc")).not.toBeNull();
  });
});

describe("pairsToQuantityShorthand", () => {
  it("writes an exact number of sets as just the set piece", () => {
    expect(pairsToQuantityShorthand(12)).toBe("2s");
  });

  it("writes anything smaller than one set as just the pair piece", () => {
    expect(pairsToQuantityShorthand(3)).toBe("3p");
  });

  it("writes a mixed total as both pieces", () => {
    expect(pairsToQuantityShorthand(9)).toBe("1s3p");
  });

  it("is empty for nothing", () => {
    expect(pairsToQuantityShorthand(0)).toBe("");
  });

  it("round-trips back through quantityShorthandPairs", () => {
    for (const pairs of [3, 6, 7, 12, 15, 83]) {
      const shorthand = pairsToQuantityShorthand(pairs);
      expect(quantityShorthandPairs(shorthand, "pair")).toBe(pairs);
    }
  });
});
