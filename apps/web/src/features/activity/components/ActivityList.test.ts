import { fireEvent, render, screen, within } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import ActivityList, { type ActivityListProps } from "./ActivityList.svelte";
import { buildActivityListView, type ActivitySortMode } from "../model/sort";
import type { ActivityItem } from "../model/types";

const items: ActivityItem[] = [
  {
    id: "a",
    source: "bank",
    date: "2026-09-03",
    title: "房租",
    subtitle: "",
    amount: -20000,
    currency: "TWD",
    category: "居住",
    categoryId: "housing",
    status: "posted",
    transactionId: "a",
  },
  {
    id: "b",
    source: "card",
    date: "2026-09-05",
    title: "咖啡",
    subtitle: "",
    amount: -120,
    currency: "TWD",
    category: "餐飲",
    categoryId: "food",
    status: "posted",
    transactionId: "b",
  },
];

function renderList(
  sortMode: ActivitySortMode,
  props: Partial<ActivityListProps> = {},
) {
  const onSortChange = vi.fn();
  const view = buildActivityListView(items, sortMode, {});
  render(ActivityList, {
    sections: view.sections,
    grouped: view.grouped,
    emptyMessage: "沒有符合條件的活動。",
    searching: false,
    query: "",
    rates: {},
    sortMode,
    onSortChange,
    categoryOptions: [
      { id: "housing", label: "居住" },
      { id: "food", label: "餐飲" },
    ],
    onCategoryChange: () => {},
    onOpen: () => {},
    ...props,
  });
  return { onSortChange };
}

describe("activity list table", () => {
  it("renders the desktop columns with aria-sort on the active column", () => {
    renderList("date-desc");
    const table = screen.getByRole("table");
    const headers = within(table).getAllByRole("columnheader");
    expect(headers.map((header) => header.textContent?.trim())).toEqual([
      "日期",
      "商家／說明",
      "帳戶",
      "分類",
      "金額",
      "狀態",
    ]);
    expect(headers[0]).toHaveAttribute("aria-sort", "descending");
    expect(headers[4]).not.toHaveAttribute("aria-sort");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(
      rows.map((row) =>
        within(row).getAllByRole("button")[0]!.textContent?.trim(),
      ),
    ).toEqual(["咖啡", "房租"]);
  });

  it("toggles sort direction from the column headers", async () => {
    const { onSortChange } = renderList("date-desc");
    const table = screen.getByRole("table");
    await fireEvent.click(within(table).getByRole("button", { name: "日期" }));
    expect(onSortChange).toHaveBeenLastCalledWith("date-asc");
    await fireEvent.click(within(table).getByRole("button", { name: "金額" }));
    expect(onSortChange).toHaveBeenLastCalledWith("amount-desc");
  });

  it("reflects amount sorting in the header state", async () => {
    const { onSortChange } = renderList("amount-desc");
    const table = screen.getByRole("table");
    const amountHeader = within(table).getByRole("columnheader", {
      name: "金額",
    });
    expect(amountHeader).toHaveAttribute("aria-sort", "descending");
    expect(
      within(table).getByRole("columnheader", { name: "日期" }),
    ).not.toHaveAttribute("aria-sort");
    await fireEvent.click(within(amountHeader).getByRole("button"));
    expect(onSortChange).toHaveBeenLastCalledWith("amount-asc");
  });

  it("shows the empty message inside the table", () => {
    render(ActivityList, {
      sections: [],
      grouped: true,
      emptyMessage: "沒有符合條件的活動。",
      searching: false,
      query: "",
      rates: {},
      sortMode: "date-desc",
      onSortChange: () => {},
      categoryOptions: [],
      onCategoryChange: () => {},
      onOpen: () => {},
    });
    expect(
      within(screen.getByRole("table")).getByText("沒有符合條件的活動。"),
    ).toBeInTheDocument();
  });
});
