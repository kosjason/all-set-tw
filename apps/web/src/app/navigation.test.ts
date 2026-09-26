import { describe, expect, it } from "vitest";
import {
  activeNavigationView,
  inboxAccessibleLabel,
  inboxBadgeLabel,
  mobileMoreItems,
  mobilePrimaryViews,
  navItems,
  settingsItem,
} from "./navigation-config";
import { parseViewHash, resolveViewHash, viewHash } from "./navigation";

describe("view hash navigation", () => {
  it("parses the new routes", () => {
    expect(parseViewHash("#/month")).toBe("month");
    expect(parseViewHash("#/transactions")).toBe("transactions");
    expect(parseViewHash("#/transactions/rules")).toBe("transaction-rules");
    expect(parseViewHash("#/cards?issuer=ctbc")).toBe("cards");
    expect(parseViewHash("#/assets")).toBe("assets");
    expect(parseViewHash("#/own-accounts")).toBe("own-accounts");
    expect(parseViewHash("#/data-sources")).toBe("data-sources");
    expect(parseViewHash("#/inbox")).toBe("inbox");
    expect(parseViewHash("#/settings")).toBe("settings");
    expect(resolveViewHash("#/month")?.redirected).toBe(false);
  });

  it("redirects old hashes and keeps their query", () => {
    const cases: [string, string, string][] = [
      ["#/overview", "month", "#/month"],
      [
        "#/activity?month=2026-09&sort=amount-desc",
        "transactions",
        "#/transactions?month=2026-09&sort=amount-desc",
      ],
      ["#/activity", "transactions", "#/transactions"],
      ["#/assets", "assets", "#/assets"],
      ["#/settings/data-sources", "data-sources", "#/data-sources"],
      [
        "#/settings/classification-rules",
        "transaction-rules",
        "#/transactions/rules",
      ],
      ["#/classification-rules", "transaction-rules", "#/transactions/rules"],
      ["#/settings/own-accounts", "own-accounts", "#/own-accounts"],
      ["#/exchange-rates", "data-sources", "#/data-sources"],
      ["#/sync-notifications", "settings", "#/settings"],
      ["#/settings/anything-else", "settings", "#/settings"],
    ];
    for (const [hash, view, canonical] of cases)
      expect(resolveViewHash(hash)).toEqual({
        view,
        hash: canonical,
        redirected: hash !== canonical,
      });
  });

  it("rejects unknown routes and formats valid views", () => {
    expect(parseViewHash("#/unknown")).toBeNull();
    expect(parseViewHash("#/invoices")).toBeNull();
    expect(parseViewHash("")).toBeNull();
    expect(viewHash("manual-assets")).toBe("#/manual-assets");
    expect(viewHash("transactions", "review=1")).toBe(
      "#/transactions?review=1",
    );
  });
});

describe("navigation config", () => {
  it("lists 本月／交易／信用卡／資產／資料來源 with 設定 at the bottom", () => {
    expect(navItems.map((item) => item.label)).toEqual([
      "本月",
      "交易",
      "信用卡",
      "資產",
      "資料來源",
    ]);
    expect(settingsItem.label).toBe("設定");
  });

  it("puts four pages in the mobile tab bar and the rest in 更多", () => {
    expect(mobilePrimaryViews).toEqual([
      "month",
      "transactions",
      "cards",
      "assets",
    ]);
    expect(mobileMoreItems.map((item) => item.label)).toEqual([
      "資料來源",
      "待處理",
      "設定",
    ]);
  });

  it("highlights the parent page for sub pages", () => {
    expect(activeNavigationView("own-accounts")).toBe("assets");
    expect(activeNavigationView("investments")).toBe("assets");
    expect(activeNavigationView("transaction-rules")).toBe("transactions");
    expect(activeNavigationView("cards")).toBe("cards");
  });

  it("formats the inbox badge and its accessible name", () => {
    expect(inboxBadgeLabel(0)).toBe("");
    expect(inboxBadgeLabel(7)).toBe("7");
    expect(inboxBadgeLabel(120)).toBe("99+");
    expect(inboxAccessibleLabel({ blocking: 0, tidy: 0 })).toBe("待處理");
    expect(inboxAccessibleLabel({ blocking: 2, tidy: 5 })).toBe(
      "待處理（2 件需要處理、5 件待整理）",
    );
  });
});
