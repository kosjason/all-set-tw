import { describe, expect, it } from "vitest";
import {
  buildNetWorthValueAxis,
  dedupeAxisTicks,
  formatNetWorthAxisValue,
  getNetWorthTrendNotice,
} from "./net-worth-axis";

function labels(values: Array<number | undefined>) {
  const axis = buildNetWorthValueAxis(values);
  if (!axis) throw new Error("axis expected");
  return axis.ticks.map((tick) => formatNetWorthAxisValue(tick, axis.step));
}

function expectDistinct(items: string[]) {
  expect(new Set(items).size).toBe(items.length);
}

describe("net worth value axis", () => {
  it("pads a single value so ticks are not all the same label", () => {
    const axis = buildNetWorthValueAxis([3_730_000]);

    expect(axis?.domain[0]).toBeLessThan(3_730_000);
    expect(axis?.domain[1]).toBeGreaterThan(3_730_000);
    const result = labels([3_730_000]);
    expect(result.length).toBeGreaterThanOrEqual(2);
    expectDistinct(result);
    expect(result).toContain("375萬");
  });

  it("pads a flat series and keeps non-negative values above zero", () => {
    expectDistinct(labels([3_730_000, 3_730_000, 3_730_000]));
    expect(buildNetWorthValueAxis([0, 0])?.domain).toEqual([0, 1]);
  });

  it("adds decimals when the span is smaller than one 萬", () => {
    const result = labels([3_730_000, 3_738_000, 3_745_000]);

    expectDistinct(result);
    expect(result).toEqual(["373.0萬", "373.5萬", "374.0萬", "374.5萬"]);
  });

  it("keeps whole 萬 labels for a normal series", () => {
    const axis = buildNetWorthValueAxis([3_200_000, 3_900_000]);

    expect(axis?.domain).toEqual([3_200_000, 4_000_000]);
    expect(labels([3_200_000, 3_900_000])).toEqual([
      "320萬",
      "340萬",
      "360萬",
      "380萬",
      "400萬",
    ]);
  });

  it("falls back to full numbers when a 萬 label cannot separate ticks", () => {
    expectDistinct(labels([3_730_000, 3_730_040]));
    expect(formatNetWorthAxisValue(3_730_010, 10)).toBe("3,730,010");
  });

  it("formats 億 values with precision from the step", () => {
    expect(formatNetWorthAxisValue(105_000_000, 5_000_000)).toBe("1.05億");
    expect(formatNetWorthAxisValue(120_000_000, 20_000_000)).toBe("1.2億");
  });

  it("ignores missing values and returns null without data", () => {
    expect(buildNetWorthValueAxis([undefined])).toBeNull();
    expect(buildNetWorthValueAxis([undefined, 100, 300])?.domain).toEqual([
      100, 300,
    ]);
  });
});

describe("dedupeAxisTicks", () => {
  it("drops ticks whose label repeats the previous one", () => {
    expect(
      dedupeAxisTicks([3_730_000, 3_732_000, 3_740_000], (value) =>
        formatNetWorthAxisValue(value, 10_000),
      ),
    ).toEqual([3_730_000, 3_740_000]);
  });
});

describe("getNetWorthTrendNotice", () => {
  it("explains that history is still accumulating with one snapshot", () => {
    expect(getNetWorthTrendNotice(1, 1)).toBe(
      "資料累積中，至少需要兩天的快照才會顯示走勢。",
    );
  });

  it("suggests a longer range when only this range has one snapshot", () => {
    expect(getNetWorthTrendNotice(1, 5)).toContain("切換較長的期間");
  });

  it("returns null when a trend can be drawn or there is no data", () => {
    expect(getNetWorthTrendNotice(2, 2)).toBeNull();
    expect(getNetWorthTrendNotice(0, 0)).toBeNull();
  });
});
