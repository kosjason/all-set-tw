import { render, screen, within } from "@testing-library/svelte";
import type { ActivityItem } from "@taiwan-fin-hub/core";
import { describe, expect, it, vi } from "vitest";
import RecentTransactions from "./RecentTransactions.svelte";

const item: ActivityItem = {
  id: "tx-1",
  source: "card",
  date: "2026-09-04",
  title: "連支＊路易莎咖啡-信義門市",
  displayName: "路易莎咖啡",
  subtitle: "",
  amount: -145,
  currency: "TWD",
  category: "餐飲",
  categoryId: "food",
  status: "posted",
  transactionId: "tx-1",
  invoiceId: "inv-1",
  itemsPreview: ["拿鐵", "可頌"],
  note: "請同事喝",
};

describe("recent transactions", () => {
  it("shows the display name, invoice items and the note", () => {
    render(RecentTransactions, { items: [item], onOpenAll: vi.fn() });
    const [row] = within(
      screen.getByRole("list", { name: "最近交易" }),
    ).getAllByRole("listitem");
    expect(row).toHaveTextContent("路易莎咖啡");
    expect(row).not.toHaveTextContent("連支＊");
    expect(row!.querySelector("[data-activity-items]")).toHaveTextContent(
      "拿鐵、可頌",
    );
    expect(row!.querySelector("[data-activity-note]")).toHaveTextContent(
      "📝 備註：請同事喝",
    );
  });
});
