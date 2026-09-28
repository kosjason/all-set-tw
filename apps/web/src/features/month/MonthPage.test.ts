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
  budget?: unknown;
  week?: (start: string) => unknown;
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
      if (path === "/api/budget")
        return options.budget
          ? Promise.resolve(options.budget)
          : Promise.reject(new Error("404"));
      if (path.startsWith("/api/budget/week"))
        return options.week
          ? Promise.resolve(
              options.week(
                new URL(path, "http://x").searchParams.get("start")!,
              ),
            )
          : Promise.reject(new Error("404"));
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
    expect(line).toHaveTextContent(/已併入刷卡\s*12 張/);
    expect(line).toHaveTextContent(/未對應\s*3 張/);
    expect(line).toHaveTextContent(/等待刷卡入帳\s*2 張/);
    expect(line).not.toHaveTextContent("待確認");
    await fireEvent.click(
      within(line).getByRole("button", { name: "查看發票 →" }),
    );
    expect(navigate).toHaveBeenCalledWith("transactions", {
      query: "tab=invoice",
    });
  });

  describe("budget and weekly review", () => {
    const budget = {
      month,
      today: `${month}-21`,
      daysLeft: 10,
      historyMonths: ["2026-06", "2026-07", "2026-08"],
      settings: {
        expectedIncome: null,
        savingsTargetType: "percent",
        savingsTargetValue: 25,
        annualReserve: 12000,
      },
      expectedIncome: { amount: 160000, source: "history" },
      savingsTarget: 40000,
      monthlyReserve: 1000,
      spent: 9650,
      spentFixed: 0,
      spentFromReserve: 0,
      fixedRemaining: 390,
      available: 108960,
      dailyAllowance: 10896,
      fixedMerchants: [],
      candidates: [
        {
          merchantKey: "name:stream",
          displayName: "串流影音",
          categoryId: "entertainment",
          monthlyAmounts: [390, 390, 390],
          typicalAmount: 390,
        },
      ],
    };
    const week = (start: string, overrides: Record<string, unknown> = {}) => ({
      weekStart: start,
      weekEnd: start,
      today: start,
      complete: false,
      elapsedDays: 3,
      total: 450,
      pendingAmount: 0,
      byDay: Array.from({ length: 7 }, (_, index) => ({
        day: `2026-09-${String(21 + index).padStart(2, "0")}`,
        amount: index === 0 ? 450 : 0,
      })),
      baseline: { weeks: 8, median: 1200 },
      difference: -750,
      topCategoryIncreases: [],
      largest: [
        {
          id: "coffee",
          source: "card",
          day: "2026-09-21",
          displayName: "咖啡豆專賣",
          amount: 450,
          categoryId: "food",
          pending: false,
        },
      ],
      newMerchants: [],
      possiblyIncompleteFrom: "2026-09-19",
      sources: [],
      ...overrides,
    });

    it("shows how much is left this month and links to the settings", async () => {
      const { navigate } = renderMonth({
        budget,
        week: (start) => week(start),
      });
      const available = await screen.findByTestId("budget-available");
      const card = screen.getByTestId("month-budget");
      expect(available).toHaveTextContent("NT$108,960");
      expect(card).toHaveTextContent("剩 10 天，每天約可花");
      expect(card).toHaveTextContent("發現 1 個可能的固定支出");
      expect(within(card).queryByTestId("budget-no-savings")).toBeNull();
      await fireEvent.click(within(card).getByRole("button", { name: /設定/ }));
      expect(navigate).toHaveBeenCalledWith("budget");
    });

    it("marks overspending instead of a daily allowance", async () => {
      renderMonth({
        budget: { ...budget, available: -2000, dailyAllowance: 0 },
        week: (start) => week(start),
      });
      await screen.findByTestId("budget-available");
      const card = screen.getByTestId("month-budget");
      expect(card).toHaveTextContent("已超出預算");
      expect(card).not.toHaveTextContent("每天約可花");
    });

    it("never claims lower spending while the week is still in progress", async () => {
      renderMonth({ budget, week: (start) => week(start) });
      const review = await screen.findByTestId("weekly-review");
      await fireEvent.click(
        within(review).getByRole("button", { name: "本週" }),
      );
      await waitFor(() => expect(review).toHaveTextContent("目前至少 NT$450"));
      expect(review).not.toHaveTextContent("少 NT$750");
      await waitFor(() =>
        expect(review).toHaveTextContent("照本月可花，一週約 NT$76,272"),
      );
    });

    it("calls out a finished week that cost more than usual", async () => {
      renderMonth({
        budget,
        week: (start) =>
          week(start, {
            complete: true,
            elapsedDays: 7,
            total: 3000,
            difference: 1800,
            possiblyIncompleteFrom: null,
          }),
      });
      const review = await screen.findByTestId("weekly-review");
      await fireEvent.click(
        within(review).getByRole("button", { name: "上週" }),
      );
      await waitFor(() =>
        expect(review).toHaveTextContent("比平常一週多 NT$1,800"),
      );
    });
  });
});
