import { describe, expect, it } from "vitest";
import {
  activitySortColumn,
  activitySortDirection,
  activitySortMagnitude,
  buildActivityListView,
  isActivitySortMode,
  sortActivities,
  toggleActivitySort,
} from "./sort";
import type { ActivityItem } from "./types";

function item(
  id: string,
  date: string,
  amount: number | undefined,
  overrides: Partial<ActivityItem> = {},
): ActivityItem {
  return {
    id,
    source: "bank",
    date,
    title: id,
    subtitle: "",
    amount,
    currency: "TWD",
    category: "未分類",
    status: "posted",
    ...overrides,
  };
}

const rates = { USD: 32, JPY: 0.2 };
const ids = (items: ActivityItem[]) => items.map((entry) => entry.id);

const items = [
  item("small-expense", "2026-08-30", -120),
  item("salary", "2026-08-05", 50000),
  item("rent", "2026-08-01", -18000),
  item("usd", "2026-08-20", -100, { currency: "USD" }),
  item("eur-no-rate", "2026-08-31", -10, { currency: "EUR" }),
  item("no-amount", "2026-08-15", undefined),
];

describe("activity sorting", () => {
  it("sorts dates newest first by default and oldest first on request", () => {
    expect(ids(sortActivities(items, "date-desc", rates))).toEqual([
      "eur-no-rate",
      "small-expense",
      "usd",
      "no-amount",
      "salary",
      "rent",
    ]);
    expect(ids(sortActivities(items, "date-asc", rates))).toEqual([
      "rent",
      "salary",
      "no-amount",
      "usd",
      "small-expense",
      "eur-no-rate",
    ]);
  });

  it("keeps undated items last in both date directions", () => {
    const withUndated = [item("undated", "", -1), ...items.slice(0, 2)];
    expect(ids(sortActivities(withUndated, "date-desc", rates)).at(-1)).toBe(
      "undated",
    );
    expect(ids(sortActivities(withUndated, "date-asc", rates)).at(-1)).toBe(
      "undated",
    );
  });

  it("ranks amounts by absolute TWD value across income and expense", () => {
    expect(ids(sortActivities(items, "amount-desc", rates))).toEqual([
      "salary",
      "rent",
      "usd",
      "small-expense",
      "eur-no-rate",
      "no-amount",
    ]);
    expect(ids(sortActivities(items, "amount-asc", rates))).toEqual([
      "small-expense",
      "usd",
      "rent",
      "salary",
      "eur-no-rate",
      "no-amount",
    ]);
  });

  it("uses the same TWD conversion as the page, including invoices", () => {
    expect(activitySortMagnitude(items[3]!, rates)).toBe(3200);
    expect(activitySortMagnitude(items[4]!, rates)).toBeUndefined();
    expect(
      activitySortMagnitude(
        item("invoice", "2026-08-01", 250, { source: "invoice" }),
        rates,
      ),
    ).toBe(250);
    expect(
      activitySortMagnitude(
        item("zero", "2026-08-01", 0, { currency: "EUR" }),
        {},
      ),
    ).toBe(0);
  });

  it("puts unknown TWD values last in both amount directions, ordered by date desc", () => {
    const unknown = [
      item("older-unknown", "2026-08-01", -5, { currency: "EUR" }),
      item("known", "2026-07-01", -1),
      item("newer-unknown", "2026-08-10", -5, { currency: "EUR" }),
    ];
    for (const mode of ["amount-desc", "amount-asc"] as const)
      expect(ids(sortActivities(unknown, mode, {}))).toEqual([
        "known",
        "newer-unknown",
        "older-unknown",
      ]);
  });

  it("breaks amount ties by date desc then id", () => {
    const ties = [
      item("b", "2026-08-01", -100),
      item("old", "2026-07-01", 100),
      item("a", "2026-08-01", -100),
      item("new", "2026-08-09", -100),
    ];
    const expected = ["new", "a", "b", "old"];
    expect(ids(sortActivities(ties, "amount-desc", rates))).toEqual(expected);
    expect(ids(sortActivities(ties, "amount-asc", rates))).toEqual(expected);
    expect(
      ids(sortActivities([...ties].reverse(), "amount-desc", rates)),
    ).toEqual(expected);
  });

  it("does not mutate the input", () => {
    const input = [...items];
    sortActivities(input, "amount-desc", rates);
    expect(input).toEqual(items);
  });
});

describe("activity list view", () => {
  it("groups date sorts by day in the chosen direction", () => {
    const view = buildActivityListView(
      [
        item("a", "2026-08-01", -1),
        item("b", "2026-08-02", -2),
        item("c", "2026-08-01", -3),
      ],
      "date-asc",
      rates,
    );
    expect(view.grouped).toBe(true);
    expect(
      view.sections.map((section) => [section.dateKey, ids(section.items)]),
    ).toEqual([
      ["2026-08-01", ["c", "a"]],
      ["2026-08-02", ["b"]],
    ]);
  });

  it("returns a flat list without date headers for amount sorts", () => {
    const view = buildActivityListView(items, "amount-desc", rates);
    expect(view.grouped).toBe(false);
    expect(view.sections).toHaveLength(1);
    expect(view.sections[0]!.dateKey).toBeNull();
    expect(ids(view.sections[0]!.items)).toEqual(
      ids(sortActivities(items, "amount-desc", rates)),
    );
  });

  it("returns no sections for an empty list", () => {
    expect(buildActivityListView([], "amount-asc", rates).sections).toEqual([]);
    expect(buildActivityListView([], "date-desc", rates).sections).toEqual([]);
  });
});

describe("activity sort column helpers", () => {
  it("toggles the active column and starts a new column descending", () => {
    expect(toggleActivitySort("date-desc", "date")).toBe("date-asc");
    expect(toggleActivitySort("date-asc", "date")).toBe("date-desc");
    expect(toggleActivitySort("date-asc", "amount")).toBe("amount-desc");
    expect(toggleActivitySort("amount-desc", "amount")).toBe("amount-asc");
    expect(toggleActivitySort("amount-asc", "date")).toBe("date-desc");
  });

  it("reports aria-sort only for the active column", () => {
    expect(activitySortDirection("date-desc", "date")).toBe("descending");
    expect(activitySortDirection("date-asc", "date")).toBe("ascending");
    expect(activitySortDirection("date-asc", "amount")).toBeUndefined();
    expect(activitySortDirection("amount-asc", "amount")).toBe("ascending");
    expect(activitySortColumn("amount-desc")).toBe("amount");
  });

  it("validates sort modes from untrusted input", () => {
    expect(isActivitySortMode("amount-asc")).toBe(true);
    expect(isActivitySortMode("amount")).toBe(false);
    expect(isActivitySortMode(undefined)).toBe(false);
  });
});
