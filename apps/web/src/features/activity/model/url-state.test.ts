import { describe, expect, it } from "vitest";
import {
  activityHash,
  defaultActivityViewState,
  parseActivityHash,
} from "./url-state";

describe("transactions url state", () => {
  it("keeps the bare route when everything is default", () => {
    expect(parseActivityHash("#/transactions")).toEqual(
      defaultActivityViewState(),
    );
    expect(activityHash(defaultActivityViewState())).toBe("#/transactions");
    expect(
      activityHash(
        { ...defaultActivityViewState(), month: "2026-09" },
        "2026-09",
      ),
    ).toBe("#/transactions");
  });

  it("ignores other routes", () => {
    expect(parseActivityHash("#/overview")).toBeNull();
    expect(parseActivityHash("#/activity?month=2026-09")).toBeNull();
    expect(parseActivityHash("#/transactions-old?month=2026-09")).toBeNull();
    expect(parseActivityHash("")).toBeNull();
  });

  it("parses the tab, role, filters, sort and month", () => {
    expect(
      parseActivityHash(
        "#/transactions?month=2026-08&tab=bank&role=own_transfer&sort=amount-desc&category=food&uncategorized=1&review=1",
      ),
    ).toEqual({
      ...defaultActivityViewState(),
      month: "2026-08",
      tab: "bank",
      role: "own_transfer",
      sort: "amount-desc",
      categoryId: "food",
      uncategorized: true,
      review: true,
    });
  });

  it("reads old source= and flow= parameters as tab and role", () => {
    expect(
      parseActivityHash("#/transactions?source=invoice&flow=expense"),
    ).toMatchObject({ tab: "invoice", role: "spending" });
    expect(parseActivityHash("#/transactions?flow=income")?.role).toBe(
      "income",
    );
  });

  it("falls back to defaults for invalid values", () => {
    expect(
      parseActivityHash(
        "#/transactions?month=2026-13&sort=random&tab=cash&role=x&time=forever&from=yesterday&slice=bad&card=12&activity=nope",
      ),
    ).toEqual(defaultActivityViewState());
  });

  it("round-trips search, custom range and a legacy chart category", () => {
    const state = {
      ...defaultActivityViewState(),
      month: "2026-07",
      query: "全聯 超市",
      time: "custom" as const,
      from: "2025-01-01",
      to: "2025-06-30",
      slice: { flow: "expense" as const, category: "餐飲" },
      role: "spending" as const,
    };
    const hash = activityHash(state, "2026-09");
    expect(hash).toBe(
      "#/transactions?month=2026-07&q=%E5%85%A8%E8%81%AF+%E8%B6%85%E5%B8%82&slice=expense%3A%E9%A4%90%E9%A3%B2&time=custom&from=2025-01-01&to=2025-06-30",
    );
    expect(parseActivityHash(hash)).toEqual(state);
  });

  it("writes the tab and role only when they differ from the default", () => {
    const hash = activityHash({
      ...defaultActivityViewState(),
      tab: "invoice",
      role: "investment",
    });
    expect(hash).toBe("#/transactions?tab=invoice&role=investment");
    expect(parseActivityHash(hash)).toMatchObject({
      tab: "invoice",
      role: "investment",
    });
  });

  it("opens the card tab for a card filter and keeps activity deep links", () => {
    expect(parseActivityHash("#/transactions?card=4444")).toMatchObject({
      tab: "card",
      card: "4444",
    });
    const parsed = parseActivityHash(
      "#/transactions?month=2026-09&activity=bank:tx-42",
    );
    expect(parsed?.activity).toEqual({ source: "bank", id: "tx-42" });
    expect(activityHash(parsed!, "2026-09")).toBe(
      "#/transactions?activity=bank%3Atx-42",
    );
    expect(
      parseActivityHash("#/transactions?activity=invoice:inv-1")?.activity,
    ).toEqual({ source: "invoice", id: "inv-1" });
  });

  it("writes the needs-review toggle as review=1", () => {
    const hash = activityHash({ ...defaultActivityViewState(), review: true });
    expect(hash).toBe("#/transactions?review=1");
    expect(parseActivityHash(hash)?.review).toBe(true);
    expect(parseActivityHash("#/transactions?review=yes")?.review).toBe(false);
  });

  it("writes the search range only while searching", () => {
    expect(
      activityHash({
        ...defaultActivityViewState(),
        time: "year",
        from: "2025-01-01",
      }),
    ).toBe("#/transactions");
    expect(
      activityHash({
        ...defaultActivityViewState(),
        query: "airbnb",
        time: "year",
        from: "2025-01-01",
      }),
    ).toBe("#/transactions?q=airbnb&time=year");
  });

  it("derives the role from a legacy chart category selection", () => {
    expect(
      parseActivityHash(
        "#/transactions?role=income&slice=expense:%E9%A4%90%E9%A3%B2",
      )?.role,
    ).toBe("spending");
  });
});
