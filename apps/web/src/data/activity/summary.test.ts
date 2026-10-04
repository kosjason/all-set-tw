import { describe, expect, it } from "vitest";
import { summaryFixture } from "@/testing/activity-summary";
import { activitySummaryExcludedParts } from "./summary";

describe("activitySummaryExcludedParts", () => {
  it("lists advances and reimbursements, including refunds below zero", () => {
    expect(
      activitySummaryExcludedParts(
        summaryFixture("2026-09", {
          excludedAmount: 0,
          advanceAmount: -300,
          reimbursementAmount: 31520,
        }),
      ).map((part) => [part.key, part.amount]),
    ).toEqual([
      ["advance", -300],
      ["reimbursement", 31520],
    ]);
  });
});
