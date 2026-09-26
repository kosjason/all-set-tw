import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/svelte";
import { QueryClient, QueryClientProvider } from "@tanstack/svelte-query";
import {
  currentActivityMonthKey,
  type ActivityItem,
  type ActivityMonthSummary,
} from "@taiwan-fin-hub/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@/shared/api/client";
import { summaryFixture } from "@/testing/activity-summary";
import MonthPage from "./MonthPage.svelte";

const month = currentActivityMonthKey();
const monthName = `${Number(month.slice(5))} 月收支`;

const summary = summaryFixture(month, {
  income: 162200,
  spending: 111690,
  investment: 41663,
  saved: 50510,
  needsReview: { count: 2, amount: 800 },
  spendingByCategory: { food: 30000, other: 60000, invoice: 15000 },
  activityCount: 40,
});

function item(index: number, overrides: Partial<ActivityItem> = {}) {
  return {
    id: `tx-${index}`,
    source: "card",
    date: `${month}-${String(index).padStart(2, "0")}`,
    title: `交易 ${index}`,
    subtitle: "",
    institutionName: "玉山銀行",
    amount: -100 * index,
    currency: "TWD",
    category: "餐飲",
    status: "posted",
    duplicateOf: null,
    ...overrides,
  } as ActivityItem;
}

const monthItems: ActivityItem[] = [
  ...Array.from({ length: 10 }, (_, index) => item(index + 1)),
  item(20, {
    id: "inv-dup",
    source: "invoice",
    title: "重複發票",
    duplicateOf: { kind: "bank_transaction", id: "tx-1" },
  }),
];

interface Options {
  summary?: ActivityMonthSummary;
  cards?: unknown;
  cardsError?: boolean;
  inboxCounts?: { blocking: number; tidy: number };
}

function renderMonth(options: Options = {}) {
  window.history.replaceState(null, "", "/#/month");
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const current = options.summary ?? summary;
  const api = {
    get: vi.fn((path: string) => {
      if (path.startsWith("/api/activity/summary"))
        return Promise.resolve({ months: [current] });
      if (path.startsWith("/api/activity/items"))
        return Promise.resolve({ month, items: monthItems, summary: current });
      if (path === "/api/classification/categories")
        return Promise.resolve([{ id: "food", label: "餐飲" }]);
      if (path === "/api/sync-jobs")
        return Promise.resolve([
          { connectorId: "esun", lastSuccessAt: "2026-09-25T02:30:00Z" },
        ]);
      if (path === "/api/cards/summary")
        return options.cardsError
          ? Promise.reject(new Error("404"))
          : Promise.resolve(options.cards ?? { nextDue: null });
      if (path.startsWith("/api/bank"))
        return Promise.resolve({
          accounts: [
            {
              id: "d",
              connectorId: "esun",
              sourceId: "d",
              currency: "TWD",
              balance: 100000,
            },
            {
              id: "c",
              connectorId: "esun",
              sourceId: "c",
              currency: "TWD",
              accountType: "credit",
              balance: -5000,
            },
          ],
          transactions: [],
        });
      if (path === "/api/history/net-worth/chart")
        return Promise.resolve([
          {
            date: "2026-07-01",
            netWorth: 90000,
            assetType: "deposit",
            source: "bank",
          },
          {
            date: "2026-08-01",
            netWorth: 91000,
            assetType: "deposit",
            source: "bank",
          },
          {
            date: "2026-09-01",
            netWorth: 100000,
            assetType: "deposit",
            source: "bank",
          },
        ]);
      return Promise.resolve([]);
    }),
  } as unknown as ApiClient;
  const navigate = vi.fn();
  render(
    MonthPage,
    { props: { api, navigate, inboxCounts: options.inboxCounts } },
    { wrapper: QueryClientProvider, wrapperProps: { client: queryClient } },
  );
  return { api, navigate };
}

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("month page", () => {
  it("shows the equation from the summary API and no spending warning card", async () => {
    const { api } = renderMonth();
    const region = await screen.findByRole("region", { name: monthName });
    await waitFor(() =>
      expect(within(region).getByTestId("cash-flow-saved")).toHaveTextContent(
        "NT$50,510",
      ),
    );
    expect(
      within(region)
        .getByTestId("cash-flow-destination")
        .textContent?.replace(/\s+/g, ""),
    ).toBe("其中投資NT$41,663／留在帳戶NT$8,847");
    expect(screen.queryByText(/消費高於收入/)).toBeNull();
    expect(api.get).toHaveBeenCalledWith(
      expect.stringMatching(/^\/api\/activity\/summary\?from=\d{4}-\d{2}&to=/),
    );
    expect(await screen.findByTestId("month-updated-at")).toHaveTextContent(
      "資料更新於",
    );
  });

  it("opens the inbox from the pending banner", async () => {
    const { navigate } = renderMonth({
      inboxCounts: { blocking: 1, tidy: 2 },
    });
    const banner = await screen.findByTestId("month-pending-banner");
    expect(banner).toHaveTextContent("有 3 件待處理");
    await fireEvent.click(banner);
    expect(navigate).toHaveBeenCalledWith("inbox");
  });

  it("falls back to the needs-review filter when the inbox is empty", async () => {
    const { navigate } = renderMonth({ inboxCounts: { blocking: 0, tidy: 0 } });
    const banner = await screen.findByTestId("month-pending-banner");
    expect(banner).toHaveTextContent("2 筆交易待確認（金額 NT$800）");
    await fireEvent.click(banner);
    expect(navigate).toHaveBeenCalledWith("transactions", {
      query: "review=1",
    });
  });

  it("hides the pending banner when nothing needs attention", async () => {
    renderMonth({
      summary: summaryFixture(month, { income: 1, saved: 1 }),
    });
    await screen.findByRole("region", { name: monthName });
    expect(screen.queryByTestId("month-pending-banner")).toBeNull();
  });

  it("shows the card bill reminder only when due within 7 days and unpaid", async () => {
    const { navigate } = renderMonth({
      cards: {
        nextDue: {
          issuer: "cathaybk",
          name: "國泰世華",
          paymentDueDate: "2026-10-01",
          daysUntilDue: 3,
          remainingAmount: 12000,
          paymentStatus: "unpaid",
        },
      },
    });
    const reminder = await screen.findByTestId("month-card-due");
    expect(reminder).toHaveTextContent("國泰世華 卡費3 天後截止");
    expect(reminder).toHaveTextContent("尚未繳 NT$12,000");
    await fireEvent.click(reminder);
    expect(navigate).toHaveBeenCalledWith("cards");
  });

  it("does not show the card reminder when the cards API fails", async () => {
    renderMonth({ cardsError: true });
    await screen.findByRole("region", { name: monthName });
    await waitFor(() =>
      expect(screen.getByRole("list", { name: "最近交易" })).toBeVisible(),
    );
    expect(screen.queryByTestId("month-card-due")).toBeNull();
  });

  it("ranks spending categories as horizontal bars and opens the category in transactions", async () => {
    const { navigate } = renderMonth();
    const ranking = await screen.findByRole("list", { name: "消費分類排行" });
    const rows = await within(ranking).findAllByRole("button");
    expect(rows.map((row) => row.textContent?.replace(/\s+/g, ""))).toEqual([
      "❔未分類NT$60,00057%",
      "🍜餐飲NT$30,00029%",
      "發票NT$15,00014%",
    ]);
    const bars = within(ranking).getAllByTestId("category-bar");
    expect(bars[0]).toHaveStyle({ width: "100%" });
    expect(bars[1]).toHaveStyle({ width: "50%" });
    // 顏色依分類固定：餐飲為色板第 1 色，未分類為中性灰；沒有子類可展開。
    expect(bars[1]).toHaveStyle({ backgroundColor: "#2a78d6" });
    expect(bars[0]).toHaveStyle({ backgroundColor: "#c3c2b7" });
    expect(
      within(ranking).queryByRole("button", { expanded: false }),
    ).toBeNull();
    await fireEvent.click(rows[1]!);
    expect(navigate).toHaveBeenCalledWith("transactions", {
      query: "role=spending&category=food",
    });
  });

  it("shows the six-month trend and the latest eight transactions", async () => {
    const { navigate } = renderMonth();
    const trend = await screen.findByRole("region", { name: "近 6 個月收支" });
    expect(await within(trend).findAllByRole("button")).toHaveLength(6);
    const recent = await screen.findByRole("list", { name: "最近交易" });
    const rows = within(recent).getAllByRole("listitem");
    expect(rows).toHaveLength(8);
    expect(rows[0]).toHaveTextContent("交易 10");
    expect(recent).not.toHaveTextContent("重複發票");
    await fireEvent.click(
      screen.getByRole("button", { name: "查看全部交易 →" }),
    );
    expect(navigate).toHaveBeenCalledWith("transactions", { query: "" });
  });

  it("shows net worth with the change since last month and links to assets", async () => {
    const { navigate } = renderMonth();
    const line = await screen.findByTestId("month-net-worth");
    await waitFor(() => expect(line).toHaveTextContent("NT$95,000"));
    await waitFor(() => expect(line).toHaveTextContent("較上月 +NT$9,000"));
    await fireEvent.click(line);
    expect(navigate).toHaveBeenCalledWith("assets");
  });

  it("hides the invoice de-duplication line when the month has no invoices", async () => {
    renderMonth();
    await screen.findByRole("region", { name: monthName });
    expect(screen.queryByTestId("month-dedupe")).toBeNull();
  });

  it("summarises invoices merged into card records", async () => {
    const { navigate } = renderMonth({
      summary: {
        ...summary,
        dedupe: {
          invoicesMerged: 12,
          invoicesUnmatched: 3,
          invoicesAwaitingCard: 2,
          invoicesAmbiguous: 0,
        },
      },
    });
    const line = await screen.findByTestId("month-dedupe");
    expect(line).toHaveTextContent(
      "12 張發票已併入刷卡、3 張未對應、2 張等待刷卡入帳",
    );
    await fireEvent.click(
      within(line).getByRole("button", { name: "查看發票" }),
    );
    expect(navigate).toHaveBeenCalledWith("transactions", {
      query: "tab=invoice",
    });
  });
});
