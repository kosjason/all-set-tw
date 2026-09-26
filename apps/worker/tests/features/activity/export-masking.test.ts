import type { ActivityItem } from "@taiwan-fin-hub/core";
import { describe, expect, it } from "vitest";
import { toActivityExportItem } from "../../../src/features/activity/export-service";

const base: ActivityItem = {
  id: "tx-1",
  source: "bank",
  date: "2026-09-10",
  title: "轉帳",
  subtitle: "",
  amount: -1000,
  currency: "TWD",
  category: "其他",
  status: "posted",
};

describe("activity export masking", () => {
  it("masks long digit runs in notes and item previews", () => {
    const exported = toActivityExportItem(
      {
        ...base,
        note: "轉到 0000111100066666 還朋友",
        itemsPreview: ["儲值序號 P0000000000000011111", "拿鐵"],
      },
      {},
    )!;
    expect(exported.note).not.toContain("0000111100066666");
    expect(exported.note).toContain("還朋友");
    expect(exported.itemsPreview.join(" ")).not.toContain(
      "0000000000000011111",
    );
    expect(exported.itemsPreview).toContain("拿鐵");
  });
});
