import { describe, expect, it } from "vitest";
import { investmentBrokerLabel } from "./investment-label";

describe("investmentBrokerLabel", () => {
  it("prefers the broker name", () => {
    expect(
      investmentBrokerLabel({ brokerNo: "9A92", brokerName: " 測試證券 " }),
    ).toBe("測試證券");
  });

  it("falls back to the broker code", () => {
    expect(investmentBrokerLabel({ brokerNo: "9A92", brokerName: null })).toBe(
      "券商 9A92",
    );
  });

  it("returns nothing without broker details", () => {
    expect(investmentBrokerLabel({})).toBeUndefined();
    expect(investmentBrokerLabel({ brokerNo: " ", brokerName: "" })).toBe(
      undefined,
    );
  });
});
