import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/svelte";
import { QueryClient, QueryClientProvider } from "@tanstack/svelte-query";
import type { ActivityItem, ActivityMonthSummary } from "@taiwan-fin-hub/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@/shared/api/client";
import { summaryFixture } from "@/testing/activity-summary";
import ActivityPage from "./ActivityPage.svelte";

// 離開搜尋時會還原月報捲動位置；jsdom 未實作 scrollTo。
window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
// 工具列以 bind:offsetHeight 量測高度；jsdom 沒有 ResizeObserver。
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
import { currentActivityMonthKey } from "./model/list";

const month = currentActivityMonthKey();

function activity(overrides: Partial<ActivityItem>): ActivityItem {
  return {
    id: "item",
    source: "card",
    date: `${month}-01`,
    title: "活動",
    subtitle: "",
    institutionName: "玉山銀行",
    accountName: "信用卡",
    amount: -100,
    currency: "TWD",
    category: "未分類",
    categoryId: "other",
    status: "posted",
    economicRole: "spending",
    reviewStatus: "auto",
    duplicateOf: null,
    investmentEventKind: null,
    roleReason: "sign",
    ...overrides,
  };
}

const items: ActivityItem[] = [
  activity({
    id: "tx-coffee",
    transactionId: "tx-coffee",
    date: `${month}-02`,
    title: "咖啡",
    amount: -120,
    category: "餐飲",
    categoryId: "food",
    classificationSource: "user_rule",
    invoiceId: "inv-coffee",
    invoiceAmount: 120,
  }),
  activity({
    id: "tx-rent",
    transactionId: "tx-rent",
    date: `${month}-01`,
    title: "房租",
    amount: -20000,
    status: "pending",
  }),
  activity({
    id: "tx-salary",
    source: "bank",
    transactionId: "tx-salary",
    date: `${month}-03`,
    title: "薪資入帳",
    institutionName: "國泰世華",
    accountName: "薪轉戶",
    amount: 50000,
    category: "薪資",
    categoryId: "salary",
    economicRole: "income",
    roleReason: "category",
  }),
  activity({
    id: "tx-transfer",
    source: "bank",
    transactionId: "tx-transfer",
    date: `${month}-04`,
    title: "跨行轉帳",
    institutionName: "國泰世華",
    accountName: "薪轉戶",
    amount: -3000,
    category: "轉帳",
    categoryId: "transfer",
    classificationRuleId: "system:bank:transfer-keywords",
    counterpartyAccount: "→ 台北富邦 …66666",
    reviewStatus: "needs_review",
  }),
  activity({
    id: "inv-coffee",
    source: "invoice",
    date: `${month}-02`,
    title: "星巴克",
    subtitle: "AB12345678",
    institutionName: "電子發票",
    accountName: "AB12345678",
    amount: 120,
    category: "發票",
    categoryId: undefined,
    invoiceId: "inv-coffee",
    invoiceAmount: 120,
    status: "已開立",
    duplicateOf: { kind: "bank_transaction", id: "tx-coffee" },
    roleReason: "invoice_matched",
  }),
];

const bank = {
  accounts: [],
  transactions: [
    {
      id: "tx-coffee",
      connectorId: "esun",
      accountId: "card",
      institutionName: "玉山銀行",
      accountName: "信用卡",
      accountLast4: "4444",
      sourceId: "s-coffee",
      postedDate: `${month}-02`,
      amount: -120,
      currency: "TWD",
      description: "咖啡",
      status: "posted",
      excludedFromCalculation: false,
    },
    {
      id: "tx-rent",
      connectorId: "esun",
      accountId: "card",
      institutionName: "玉山銀行",
      accountName: "信用卡",
      accountLast4: "4444",
      sourceId: "s-rent",
      postedDate: `${month}-01`,
      amount: -20000,
      currency: "TWD",
      description: "房租",
      status: "pending",
      excludedFromCalculation: false,
    },
    {
      id: "tx-hsr",
      connectorId: "esun",
      accountId: "card-2",
      institutionName: "玉山銀行",
      accountName: "信用卡",
      accountLast4: "1111",
      sourceId: "s-hsr",
      postedDate: `${month}-05`,
      amount: -1490,
      currency: "TWD",
      description: "高鐵",
      status: "posted",
      excludedFromCalculation: false,
    },
  ],
};

// 刻意與列表金額不同，證明摘要數字直接取自 summary API。
const selectedSummary = summaryFixture(month, {
  income: 51000,
  spending: 23456,
  investment: 8000,
  saved: 27544,
  ownTransfer: 20000,
  cardPayment: 15000,
  duplicateExcluded: 120,
  needsReview: { count: 1, amount: 3000 },
  spendingByCategory: { food: 120, other: 20000, transfer: 3000 },
  activityCount: 4,
});

const categories = [
  { id: "food", label: "餐飲" },
  { id: "shopping", label: "購物" },
  { id: "salary", label: "薪資" },
  { id: "transfer", label: "轉帳" },
  { id: "other", label: "未分類" },
];

function renderPage(
  hash = "#/transactions",
  options: {
    summary?: ActivityMonthSummary;
    items?: ActivityItem[];
    invoices?: unknown[];
    /** 發票清單延後回應（毫秒）；null 表示永不回應。 */
    invoicesDelay?: number | null;
    /** 單張發票明細查詢失敗。 */
    invoiceDetailFails?: boolean;
  } = {},
) {
  window.history.replaceState(null, "", `/${hash}`);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 60_000 } },
  });
  const summary = options.summary ?? selectedSummary;
  const api = {
    get: vi.fn((path: string) => {
      if (path.startsWith("/api/activity/summary?")) {
        const params = new URLSearchParams(path.split("?")[1]);
        return Promise.resolve({
          months: [params.get("from") ?? month, month].map((key) =>
            key === month ? summary : summaryFixture(key),
          ),
        });
      }
      if (path.startsWith("/api/activity/items?"))
        return Promise.resolve({
          month,
          items: options.items ?? items,
          summary,
        });
      if (path.startsWith("/api/bank")) return Promise.resolve(bank);
      if (path.startsWith("/api/invoices?")) {
        if (options.invoicesDelay === null) return new Promise(() => {});
        return new Promise((resolve) =>
          setTimeout(
            () => resolve(options.invoices ?? []),
            options.invoicesDelay ?? 0,
          ),
        );
      }
      if (path.startsWith("/api/invoices/")) {
        if (options.invoiceDetailFails)
          return Promise.reject(new Error("offline"));
        return Promise.resolve({
          ...(options.invoices?.find(
            (row) => (row as { id: string }).id === path.split("/").at(-1),
          ) as object),
          items: [],
        });
      }
      if (path.startsWith("/api/activity/search"))
        return Promise.resolve({
          items: [
            activity({
              id: "old-coffee",
              date: "2024-06-15",
              title: "咖啡 2024",
              amount: -90,
              category: "餐飲",
              categoryId: "food",
            }),
          ],
          bank: { accounts: [], transactions: [] },
          invoices: [],
          trades: [],
          nextCursor: null,
        });
      if (path === "/api/classification/categories")
        return Promise.resolve(categories);
      return Promise.resolve([]);
    }),
    put: vi.fn().mockResolvedValue({}),
    post: vi.fn().mockResolvedValue({}),
    patch: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
  } as unknown as ApiClient;
  render(
    ActivityPage,
    { props: { api } },
    { wrapper: QueryClientProvider, wrapperProps: { client: queryClient } },
  );
  return { api };
}

const summaryRequests = (api: ApiClient) =>
  vi
    .mocked(api.get)
    .mock.calls.filter(([path]) => path.startsWith("/api/activity/summary"))
    .length;
const monthRequests = (api: ApiClient) =>
  vi
    .mocked(api.get)
    .mock.calls.filter(([path]) => path.startsWith("/api/activity/items"))
    .length;

async function tableRowTitles() {
  const table = await screen.findByRole("table");
  return within(table)
    .queryAllByRole("button", { name: /^查看 .* 活動詳情$/ })
    .map((button) => button.textContent?.trim());
}

function tableRow(title: string) {
  return within(screen.getByRole("table"))
    .getByRole("button", { name: `查看 ${title} 活動詳情` })
    .closest("tr")!;
}

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

const monthLabel = `${Number(month.slice(5))} 月收支`;

async function openFilters() {
  await fireEvent.click(screen.getByRole("button", { name: /^篩選/ }));
  return screen.getByRole("dialog", { name: "活動篩選" });
}

describe("transactions page · 總帳", () => {
  it("shows the de-duplicated ledger with the income − spending equation", async () => {
    const { api } = renderPage();
    expect(await tableRowTitles()).toEqual([
      "跨行轉帳",
      "薪資入帳",
      "咖啡",
      "房租",
    ]);
    expect(screen.getByRole("tab", { name: "總帳" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const summary = screen.getByRole("region", { name: monthLabel });
    await waitFor(() =>
      expect(screen.getByTestId("cash-flow-income")).toHaveTextContent(
        "NT$51,000",
      ),
    );
    expect(screen.getByTestId("cash-flow-spending")).toHaveTextContent(
      "NT$23,456",
    );
    expect(screen.getByTestId("cash-flow-saved")).toHaveTextContent(
      "NT$27,544",
    );
    expect(
      screen
        .getByTestId("cash-flow-destination")
        .textContent?.replace(/\s+/g, ""),
    ).toBe("其中投資NT$8,000／留在帳戶NT$19,544");
    expect(summary).toHaveTextContent(
      "另有 轉到自己帳戶 NT$20,000、繳卡費 NT$15,000、重複發票 NT$120 未計入",
    );
    // 已併入刷卡的發票不在總帳重複列出，只提示去發票分頁看。
    expect(screen.getByText(/另 1 筆重複已併入（見發票分頁）/)).toBeVisible();
    // 分類圓餅與收支趨勢已移到本月頁。
    expect(screen.queryByRole("button", { name: /分析/ })).toBeNull();
    expect(vi.mocked(api.get)).toHaveBeenCalledWith(
      expect.stringMatching(/^\/api\/activity\/summary\?from=\d{4}-\d{2}&to=/),
    );
    expect(vi.mocked(api.get)).toHaveBeenCalledWith(
      `/api/activity/items?month=${month}`,
    );
  });

  it("marks roles and needs-review rows in the ledger", async () => {
    renderPage();
    await tableRowTitles();
    const salary = tableRow("薪資入帳");
    expect(
      within(salary).getByRole("combobox", { name: "變更「薪資入帳」的角色" }),
    ).toHaveTextContent("收入");
    expect(
      within(salary).queryByRole("combobox", {
        name: "變更「薪資入帳」的分類",
      }),
    ).toBeNull();
    const coffee = tableRow("咖啡");
    expect(coffee.querySelector("[data-role-badge]")).toBeNull();
    const transfer = tableRow("跨行轉帳");
    expect(transfer).toHaveAttribute("data-review", "true");
    expect(within(transfer).getByText("待確認")).toBeInTheDocument();
  });

  it("restores the role filter (and the old flow= parameter) and sort from the hash", async () => {
    renderPage("#/transactions?sort=amount-desc&flow=expense");
    await waitFor(async () =>
      expect(await tableRowTitles()).toEqual(["房租", "跨行轉帳", "咖啡"]),
    );
    expect(screen.getByRole("combobox", { name: "活動排序" })).toHaveValue(
      "amount-desc",
    );
    expect(screen.getByRole("combobox", { name: "活動角色" })).toHaveValue(
      "spending",
    );
    expect(
      within(screen.getByRole("table")).getByRole("columnheader", {
        name: "金額",
      }),
    ).toHaveAttribute("aria-sort", "descending");
    expect(
      screen.getByRole("button", { name: "清除篩選：消費" }),
    ).toBeInTheDocument();
  });

  it("filters by role and writes it to the hash", async () => {
    renderPage();
    await tableRowTitles();
    await fireEvent.change(screen.getByRole("combobox", { name: "活動角色" }), {
      target: { value: "income" },
    });
    await waitFor(async () =>
      expect(await tableRowTitles()).toEqual(["薪資入帳"]),
    );
    expect(window.location.hash).toBe("#/transactions?role=income");
  });

  it("writes filter and sort changes back to the hash and clears chips", async () => {
    renderPage();
    await tableRowTitles();
    const panel = await openFilters();
    await fireEvent.click(
      within(panel).getByRole("button", { name: "只看未分類" }),
    );
    await fireEvent.click(
      within(panel).getByRole("button", { name: "查看結果" }),
    );
    await waitFor(async () => expect(await tableRowTitles()).toEqual(["房租"]));
    expect(window.location.hash).toBe("#/transactions?uncategorized=1");
    await fireEvent.click(
      within(screen.getByRole("table")).getByRole("button", { name: "金額" }),
    );
    await waitFor(() =>
      expect(window.location.hash).toBe(
        "#/transactions?uncategorized=1&sort=amount-desc",
      ),
    );
    await fireEvent.click(
      screen.getByRole("button", { name: "清除篩選：未分類" }),
    );
    await waitFor(async () =>
      expect(await tableRowTitles()).toEqual([
        "薪資入帳",
        "房租",
        "跨行轉帳",
        "咖啡",
      ]),
    );
    expect(window.location.hash).toBe("#/transactions?sort=amount-desc");
  });

  it("filters needs-review activities from the toolbar and the summary link", async () => {
    renderPage();
    await tableRowTitles();
    await fireEvent.click(screen.getByRole("button", { name: /只看待確認/ }));
    await waitFor(async () =>
      expect(await tableRowTitles()).toEqual(["跨行轉帳"]),
    );
    expect(window.location.hash).toBe("#/transactions?review=1");
    await fireEvent.click(
      screen.getByRole("button", { name: "清除篩選：待確認" }),
    );
    await waitFor(async () => expect(await tableRowTitles()).toHaveLength(4));
    await fireEvent.click(
      await screen.findByRole("button", {
        name: "1 筆待確認（金額 NT$3,000）",
      }),
    );
    await waitFor(async () =>
      expect(await tableRowTitles()).toEqual(["跨行轉帳"]),
    );
    expect(window.location.hash).toBe("#/transactions?review=1");
  });

  it("keeps card payments out of 未分類 and shows their role instead", async () => {
    const payment = (overrides: Partial<ActivityItem>) =>
      activity({
        category: "未分類",
        categoryId: "other",
        economicRole: "card_payment",
        roleReason: "card_payment",
        ...overrides,
      });
    renderPage("#/transactions", {
      items: [
        payment({
          id: "tx-pay",
          source: "bank",
          transactionId: "tx-pay",
          title: "中信卡",
          institutionName: "中國信託",
          accountName: "存款",
          amount: -89571,
        }),
        payment({
          id: "tx-paid",
          transactionId: "tx-paid",
          title: "本行扣繳",
          institutionName: "中國信託",
          accountName: "信用卡",
          amount: 89571,
          excludedFromCalculation: true,
        }),
        activity({ id: "tx-rent", transactionId: "tx-rent", title: "房租" }),
      ],
    });
    await tableRowTitles();
    for (const title of ["中信卡", "本行扣繳"]) {
      const row = tableRow(title);
      expect(row).not.toHaveTextContent("未分類");
      expect(
        within(row).getByRole("combobox", { name: `變更「${title}」的角色` }),
      ).toHaveTextContent("繳卡費");
    }
    expect(tableRow("本行扣繳")).not.toHaveTextContent("不計入收支");
    await fireEvent.change(screen.getByRole("combobox", { name: "活動角色" }), {
      target: { value: "card_payment" },
    });
    await waitFor(async () =>
      expect((await tableRowTitles()).sort()).toEqual(["中信卡", "本行扣繳"]),
    );
    await fireEvent.change(screen.getByRole("combobox", { name: "活動角色" }), {
      target: { value: "all" },
    });
    const panel = await openFilters();
    await fireEvent.click(
      within(panel).getByRole("button", { name: "只看未分類" }),
    );
    await waitFor(async () => expect(await tableRowTitles()).toEqual(["房租"]));
  });

  it("restores the needs-review filter from the hash", async () => {
    renderPage("#/transactions?review=1");
    await waitFor(async () =>
      expect(await tableRowTitles()).toEqual(["跨行轉帳"]),
    );
    expect(screen.getByRole("button", { name: /只看待確認/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("opens the category filter linked from the month page", async () => {
    renderPage("#/transactions?role=spending&category=other");
    await waitFor(async () => expect(await tableRowTitles()).toEqual(["房租"]));
    expect(
      screen.getByRole("button", { name: "清除篩選：分類：未分類" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "清除篩選：消費" }),
    ).toBeInTheDocument();
  });

  it("confirms a needs-review role from the row and reloads the summary and list", async () => {
    const { api } = renderPage();
    await tableRowTitles();
    await waitFor(() => expect(summaryRequests(api)).toBe(1));
    const select = within(tableRow("跨行轉帳")).getByRole("combobox", {
      name: "確認「跨行轉帳」是哪一種活動",
    });
    await fireEvent.change(select, { target: { value: "own_transfer" } });
    // 轉到自己帳戶會影響金額：先問原因（選填），留空直接確定不寫備註。
    const reason = await screen.findByRole("dialog", {
      name: "這筆是「轉到自己帳戶」",
    });
    expect(api.put).not.toHaveBeenCalled();
    await fireEvent.click(within(reason).getByRole("button", { name: "確定" }));
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith(
        "/api/activity/role-overrides/bank_transaction/tx-transfer",
        { economicRole: "own_transfer" },
      ),
    );
    await waitFor(() => expect(summaryRequests(api)).toBe(2));
    expect(monthRequests(api)).toBe(2);
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "這筆是「轉到自己帳戶」" }),
      ).toBeNull(),
    );
  });

  it("marks an activity as 不計入 with a reason saved as its note", async () => {
    const { api } = renderPage();
    await tableRowTitles();
    await fireEvent.click(
      within(screen.getByRole("table")).getByRole("button", {
        name: "查看 房租 活動詳情",
      }),
    );
    const detail = await screen.findByRole("dialog", { name: "活動明細" });
    const group = within(detail).getByRole("group", {
      name: "選擇這筆活動的角色",
    });
    const buttons = within(group)
      .getAllByRole("button")
      .map((button) => button.textContent);
    expect(buttons.at(-1)).toBe("不計入（未實際付款、已作廢）");
    await fireEvent.click(
      within(group).getByRole("button", {
        name: "不計入（未實際付款、已作廢）",
      }),
    );
    const reason = await screen.findByRole("dialog", {
      name: "這筆是「不計入（未實際付款、已作廢）」",
    });
    await fireEvent.input(
      within(reason).getByLabelText("原因（選填，會存成備註）"),
      { target: { value: "  GoDaddy 自動續約，實際未扣款 " } },
    );
    await fireEvent.click(within(reason).getByRole("button", { name: "確定" }));
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith(
        "/api/activity/role-overrides/bank_transaction/tx-rent",
        { economicRole: "excluded", note: "GoDaddy 自動續約，實際未扣款" },
      ),
    );
  });

  it("strikes through 不計入 activities and shows voided invoices and the summary part", async () => {
    renderPage("#/transactions", {
      summary: summaryFixture(month, {
        excludedAmount: 1234,
        excludedCount: 2,
      }),
      items: [
        activity({
          id: "tx-test",
          transactionId: "tx-test",
          title: "測試扣款",
          economicRole: "excluded",
          reviewStatus: "confirmed",
          roleReason: "override",
        }),
        activity({
          id: "inv-void",
          source: "invoice",
          invoiceId: "inv-void",
          title: "作廢發票",
          categoryId: undefined,
          economicRole: "excluded",
          roleReason: "invoice_voided",
        }),
      ],
    });
    await tableRowTitles();
    const row = tableRow("測試扣款");
    expect(row).toHaveAttribute("data-excluded", "true");
    expect(
      within(row).getByRole("button", { name: "查看 測試扣款 活動詳情" }),
    ).toHaveClass("line-through");
    expect(row).toHaveTextContent("不計入");
    expect(tableRow("作廢發票")).toHaveTextContent("發票已作廢");
    const summary = screen.getByRole("region", { name: monthLabel });
    await waitFor(() => expect(summary).toHaveTextContent("不計入 NT$1,234"));
  });

  it("autosaves a note from the detail drawer and shows it in the list", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { api } = renderPage();
      await tableRowTitles();
      await fireEvent.click(
        within(screen.getByRole("table")).getByRole("button", {
          name: "查看 房租 活動詳情",
        }),
      );
      const detail = await screen.findByRole("dialog", { name: "活動明細" });
      const field = within(detail).getByRole("textbox", {
        name: "房租 的備註",
      });
      expect(field).toHaveAttribute(
        "placeholder",
        "寫下原因，例如：跟朋友換匯、代墊、未實際扣款…",
      );
      expect(field).toHaveAttribute("maxlength", "1000");
      await fireEvent.input(field, { target: { value: "幫室友代墊" } });
      await vi.advanceTimersByTimeAsync(700);
      expect(api.put).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(200);
      await waitFor(() =>
        expect(api.put).toHaveBeenCalledWith(
          "/api/activity/notes/bank_transaction/tx-rent",
          { note: "幫室友代墊" },
        ),
      );
      await waitFor(() =>
        expect(within(detail).getByText("已儲存")).toBeInTheDocument(),
      );
      // 成功後重新載入月份活動（列表的 📝 由 API 的 note 顯示）。
      await waitFor(() => expect(monthRequests(api)).toBe(2));

      // 清空即刪除。
      await fireEvent.input(field, { target: { value: "  " } });
      await fireEvent.blur(field);
      await waitFor(() =>
        expect(api.delete).toHaveBeenCalledWith(
          "/api/activity/notes/bank_transaction/tx-rent",
        ),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("writes a shared note to the matched activity that holds it", async () => {
    const { api } = renderPage("#/transactions", {
      items: [
        activity({
          id: "tx-fx",
          transactionId: "tx-fx",
          invoiceId: "inv-fx",
          title: "台灣銀行",
          note: "跟朋友A買人民幣",
          noteTarget: { kind: "invoice", id: "inv-fx" },
        }),
      ],
    });
    await tableRowTitles();
    const row = tableRow("台灣銀行");
    expect(row.querySelector("[data-activity-note]")).toHaveTextContent(
      "📝 備註：跟朋友A買人民幣",
    );
    await fireEvent.click(
      within(row).getByRole("button", { name: "查看 台灣銀行 活動詳情" }),
    );
    const detail = await screen.findByRole("dialog", { name: "活動明細" });
    expect(detail).toHaveTextContent("與配對的交易／發票共用這則備註");
    const field = within(detail).getByRole("textbox", {
      name: "台灣銀行 的備註",
    });
    expect(field).toHaveValue("跟朋友A買人民幣");
    await fireEvent.input(field, {
      target: { value: "跟朋友A買人民幣，存富邦華一" },
    });
    await fireEvent.blur(field);
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith(
        "/api/activity/notes/invoice/inv-fx",
        {
          note: "跟朋友A買人民幣，存富邦華一",
        },
      ),
    );
  });

  it("chooses a role in the detail panel and suggests registering my own account", async () => {
    const { api } = renderPage();
    await tableRowTitles();
    await fireEvent.click(
      within(screen.getByRole("table")).getByRole("button", {
        name: "查看 跨行轉帳 活動詳情",
      }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(
      "判斷依據：分類為轉帳，但無法確認對方是不是自己的帳戶",
    );
    expect(
      within(dialog).getByRole("link", { name: "「我的其他帳戶」" }),
    ).toHaveAttribute("href", "#/own-accounts");
    expect(dialog).toHaveTextContent("台北富邦 …66666");
    const group = within(dialog).getByRole("group", {
      name: "選擇這筆活動的角色",
    });
    expect(within(group).getByRole("button", { name: "消費" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      within(dialog).queryByRole("button", { name: "恢復自動判斷" }),
    ).toBeNull();
    await fireEvent.click(within(group).getByRole("button", { name: "投資" }));
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith(
        "/api/activity/role-overrides/bank_transaction/tx-transfer",
        { economicRole: "investment" },
      ),
    );
  });

  it("opens the detail drawer for an activity=<source>:<id> link and drops the parameter", async () => {
    renderPage(`#/transactions?month=${month}&activity=bank:tx-salary`);
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("薪資入帳");
    await waitFor(() => expect(window.location.hash).toBe("#/transactions"));
  });

  it("restores automatic role detection for an overridden activity", async () => {
    const { api } = renderPage("#/transactions", {
      items: [
        activity({
          id: "tx-override",
          transactionId: "tx-override",
          title: "轉給媽媽",
          economicRole: "own_transfer",
          reviewStatus: "confirmed",
          roleReason: "override",
        }),
      ],
    });
    await tableRowTitles();
    await waitFor(() => expect(summaryRequests(api)).toBe(1));
    await fireEvent.click(
      within(screen.getByRole("table")).getByRole("button", {
        name: "查看 轉給媽媽 活動詳情",
      }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("判斷依據：你手動指定的角色");
    await fireEvent.click(
      within(dialog).getByRole("button", { name: "恢復自動判斷" }),
    );
    await waitFor(() =>
      expect(api.delete).toHaveBeenCalledWith(
        "/api/activity/role-overrides/bank_transaction/tx-override",
      ),
    );
    await waitFor(() => expect(summaryRequests(api)).toBe(2));
  });

  it("shows why the month summary is incomplete", async () => {
    renderPage("#/transactions", {
      summary: summaryFixture(month, {
        income: 100,
        saved: 100,
        complete: false,
        incompleteReasons: [
          "missing_exchange_rates",
          "classification_unavailable",
        ],
        missingCurrencies: ["USD"],
      }),
    });
    await tableRowTitles();
    const summary = screen.getByRole("region", { name: monthLabel });
    await waitFor(() => expect(summary).toHaveTextContent("資料不完整"));
    expect(summary).toHaveTextContent("缺少 USD 匯率，這些外幣未計入");
    expect(summary).toHaveTextContent("分類規則無法載入，只能依金額正負判斷");
  });

  it("changes a transaction's category from the list through the categorize API", async () => {
    const { api } = renderPage();
    await tableRowTitles();
    const select = screen.getByRole("combobox", {
      name: "變更「咖啡」的分類",
    });
    await fireEvent.change(select, { target: { value: "shopping" } });
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/api/activity/categorize", {
        targets: [{ kind: "bank_transaction", id: "tx-coffee" }],
        categoryId: "shopping",
        applyToMerchant: false,
      }),
    );
    // 沒有 merchantKey：只改這筆，不詢問商家。
    expect(screen.queryByTestId("merchant-category-prompt")).toBeNull();
    expect(screen.queryByRole("heading", { name: "活動明細" })).toBeNull();
    await waitFor(() => expect(monthRequests(api)).toBe(2));
  });

  it("categorizes an unmatched (cash) invoice and offers to remember the seller", async () => {
    const invoiceItems = [
      activity({
        id: "inv-cash",
        source: "invoice",
        invoiceId: "inv-cash",
        title: "巷口早餐店",
        institutionName: "電子發票",
        accountName: "AB00000001",
        amount: 85,
        category: "未分類",
        categoryId: "other",
        categorySource: "none",
        merchantKey: "ban:12345678",
        displayName: "巷口早餐店",
        roleReason: "invoice",
      }),
      activity({
        id: "inv-cash-2",
        source: "invoice",
        invoiceId: "inv-cash-2",
        title: "巷口早餐店",
        amount: 60,
        categoryId: "other",
        categorySource: "none",
        merchantKey: "ban:12345678",
        roleReason: "invoice",
      }),
      activity({
        id: "inv-cash-3",
        source: "invoice",
        invoiceId: "inv-cash-3",
        title: "巷口早餐店",
        amount: 60,
        categoryId: "shopping",
        categorySource: "user",
        merchantKey: "ban:12345678",
        roleReason: "invoice",
      }),
    ];
    const { api } = renderPage("#/transactions", { items: invoiceItems });
    await tableRowTitles();
    const [chip] = screen.getAllByRole("combobox", {
      name: "變更「巷口早餐店」的分類",
    });
    expect(chip).toBeEnabled();
    await fireEvent.change(chip!, { target: { value: "food" } });
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/api/activity/categorize", {
        targets: [
          { kind: "invoice", id: "inv-cash", merchantKey: "ban:12345678" },
        ],
        categoryId: "food",
        applyToMerchant: false,
      }),
    );
    // 同統編的另一張未覆寫發票算 1 筆；被使用者個別覆寫的不算。
    const prompt = await screen.findByTestId("merchant-category-prompt");
    expect(prompt).toHaveTextContent(
      "將『巷口早餐店』的其他 1 筆也設為「餐飲」，並記住這個商家？",
    );
    await fireEvent.click(screen.getByRole("button", { name: "套用並記住" }));
    await waitFor(() =>
      expect(api.post).toHaveBeenLastCalledWith("/api/activity/categorize", {
        targets: [
          { kind: "invoice", id: "inv-cash", merchantKey: "ban:12345678" },
        ],
        categoryId: "food",
        applyToMerchant: true,
      }),
    );
    await waitFor(() =>
      expect(screen.queryByTestId("merchant-category-prompt")).toBeNull(),
    );
  });

  it("lets an unmatched invoice change its category in the detail drawer", async () => {
    const { api } = renderPage("#/transactions", {
      items: [
        activity({
          id: "inv-cash",
          source: "invoice",
          invoiceId: "inv-cash",
          title: "全家便利商店",
          amount: 45,
          categoryId: "other",
          roleReason: "invoice",
        }),
      ],
    });
    await tableRowTitles();
    await fireEvent.click(
      within(screen.getByRole("table")).getByRole("button", {
        name: "查看 全家便利商店 活動詳情",
      }),
    );
    const detail = await screen.findByRole("dialog", { name: "活動明細" });
    expect(detail).not.toHaveTextContent("配對銀行／信用卡交易後即可調整");
    await fireEvent.change(
      within(detail).getByRole("combobox", { name: "更新 全家便利商店 分類" }),
      { target: { value: "food" } },
    );
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/api/activity/categorize", {
        targets: [{ kind: "invoice", id: "inv-cash" }],
        categoryId: "food",
        applyToMerchant: false,
      }),
    );
  });

  it("writes a matched invoice's category to its transaction so both stay the same", async () => {
    const { api } = renderPage("#/transactions?tab=invoice");
    await screen.findByText("星巴克");
    await fireEvent.click(screen.getByRole("button", { name: /星巴克/ }));
    const detail = await screen.findByRole("dialog", { name: "活動明細" });
    expect(detail).toHaveTextContent("與配對的交易一起更新");
    await fireEvent.change(
      within(detail).getByRole("combobox", { name: "更新 星巴克 分類" }),
      { target: { value: "shopping" } },
    );
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith("/api/activity/categorize", {
        targets: [{ kind: "bank_transaction", id: "tx-coffee" }],
        categoryId: "shopping",
        applyToMerchant: false,
      }),
    );
  });

  const cashInvoice = activity({
    id: "inv-cash",
    source: "invoice",
    invoiceId: "inv-cash",
    title: "巷口早餐店",
    amount: 85,
    roleReason: "invoice",
  });
  const cashInvoiceRow = {
    id: "inv-cash",
    connectorId: "einvoice",
    invoiceNumber: "AB00000001",
    invoiceDate: `${month}-01`,
    sellerName: "巷口早餐店有限公司",
    amount: 85,
  };

  it("shows the invoice when the detail opens after the invoice list has loaded", async () => {
    // 只靠發票清單（單張查詢失敗）：清單載入完成後才開明細，仍要看到發票。
    renderPage("#/transactions", {
      items: [cashInvoice],
      invoices: [cashInvoiceRow],
      invoiceDetailFails: true,
    });
    await tableRowTitles();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await fireEvent.click(
      within(screen.getByRole("table")).getByRole("button", {
        name: "查看 巷口早餐店 活動詳情",
      }),
    );
    const detail = await screen.findByRole("dialog", { name: "活動明細" });
    await waitFor(() => expect(detail).toHaveTextContent("發票商家名稱"));
    expect(detail).toHaveTextContent("巷口早餐店有限公司");
    expect(
      within(detail).getByRole("button", { name: "配對交易" }),
    ).toBeInTheDocument();
  });

  it("shows the invoice for a deep link while the invoice list is still loading", async () => {
    // 從收件匣／信用卡頁以 activity=invoice:<id> 直接開明細，發票清單遲遲沒回應：
    // 明細改用自己依 id 查到的發票。
    const { api } = renderPage("#/transactions?activity=invoice:inv-cash", {
      items: [cashInvoice],
      invoices: [cashInvoiceRow],
      invoicesDelay: null,
    });
    const detail = await screen.findByRole("dialog", { name: "活動明細" });
    await waitFor(() => expect(detail).toHaveTextContent("發票商家名稱"));
    expect(detail).toHaveTextContent("巷口早餐店有限公司");
    expect(api.get).toHaveBeenCalledWith("/api/invoices/inv-cash");
  });

  it("labels a foreign transaction fee with the purchase it belongs to", async () => {
    renderPage("#/transactions", {
      items: [
        activity({
          id: "inv-usd",
          source: "invoice",
          invoiceId: "inv-usd",
          title: "Anthropic",
          amount: 10.98,
          currency: "USD",
          amountTwd: 356,
          roleReason: "invoice",
        }),
        activity({
          id: "tx-claude",
          transactionId: "tx-claude",
          title: "CLAUDE.AI SUBSCRIPTION",
          displayName: "Claude",
          amount: -360,
        }),
        activity({
          id: "tx-fee",
          transactionId: "tx-fee",
          title: "國外交易服務費",
          amount: -5,
          foreignFeeOf: "tx-claude",
        }),
      ],
      invoices: [
        {
          id: "inv-usd",
          connectorId: "einvoice",
          invoiceNumber: "AB12345678",
          invoiceDate: `${month}-02`,
          sellerName: "Anthropic",
          amount: 10.98,
          currency: "USD",
        },
      ],
    });
    await tableRowTitles();
    expect(
      tableRow("國外交易服務費").querySelector("[data-foreign-fee]"),
    ).toHaveTextContent("屬於 Claude 的國外交易服務費");
  });

  it("filters the month while typing and returns to the monthly filters after a search", async () => {
    const { api } = renderPage("#/transactions?role=spending");
    await tableRowTitles();
    const input = screen.getByRole("searchbox", { name: "搜尋活動" });
    await fireEvent.input(input, { target: { value: "咖啡" } });
    await waitFor(async () => expect(await tableRowTitles()).toEqual(["咖啡"]));
    expect(
      screen.getByRole("button", { name: "清除篩選：搜尋：咖啡" }),
    ).toBeInTheDocument();
    await fireEvent.submit(screen.getByRole("search"));
    await waitFor(async () =>
      expect(await tableRowTitles()).toEqual(["咖啡 2024"]),
    );
    expect(window.location.hash).toBe(
      `#/transactions?q=${encodeURIComponent("咖啡")}`,
    );
    expect(api.get).toHaveBeenCalledWith(
      expect.stringContaining("/api/activity/search?"),
    );
    expect(
      screen.getByRole("heading", { name: "搜尋「咖啡」" }),
    ).toBeInTheDocument();
    await fireEvent.click(
      screen.getByRole("button", { name: "清空搜尋，返回月報" }),
    );
    await waitFor(() =>
      expect(window.location.hash).toBe("#/transactions?role=spending"),
    );
    expect(screen.getByRole("combobox", { name: "活動角色" })).toHaveValue(
      "spending",
    );
    expect(screen.getByRole("searchbox", { name: "搜尋活動" })).toHaveValue("");
    expect(await tableRowTitles()).toEqual(["跨行轉帳", "咖啡", "房租"]);
  });
});

describe("transactions page · 來源分頁", () => {
  const sourceTitles = () =>
    screen
      .getAllByTestId("source-row")
      .map((row) => row.querySelector("span span")?.textContent?.trim());

  it("switches tabs through the URL and hides spending totals on source tabs", async () => {
    renderPage();
    await tableRowTitles();
    await fireEvent.click(screen.getByRole("tab", { name: "銀行" }));
    await waitFor(() =>
      expect(window.location.hash).toBe("#/transactions?tab=bank"),
    );
    expect(screen.getByRole("tab", { name: "銀行" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.queryByRole("region", { name: monthLabel })).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByTestId("raw-records-note")).toHaveTextContent(
      "原始紀錄，不等於消費",
    );
    expect(sourceTitles()).toEqual(["跨行轉帳", "薪資入帳"]);
    const transfer = screen.getAllByTestId("source-row")[0]!;
    expect(within(transfer).getByTestId("counterparty")).toHaveTextContent(
      "→ 台北富邦 …66666",
    );
    expect(within(transfer).getByTestId("role")).toHaveTextContent(
      "消費・待確認",
    );
    expect(
      within(screen.getAllByTestId("source-row")[1]!).getByTestId("role"),
    ).toHaveTextContent("收入");
  });

  it("groups the card tab by card with posting status", async () => {
    renderPage("#/transactions?tab=card");
    const group = await screen.findByRole("region", {
      name: "玉山銀行 信用卡 末四碼 4444",
    });
    expect(group).toHaveTextContent("••4444");
    expect(group).toHaveTextContent("2 筆・1 筆未入帳");
    const rows = within(group).getAllByTestId("source-row");
    expect(
      rows.map((row) => within(row).getByTestId("posting").textContent),
    ).toEqual(["已入帳", "未入帳"]);
    expect(rows[0]).toHaveTextContent("已對應發票");
  });

  it("filters the card tab by the card's last four digits", async () => {
    renderPage("#/transactions?card=1111", {
      items: [
        ...items,
        activity({
          id: "tx-hsr",
          transactionId: "tx-hsr",
          date: `${month}-05`,
          title: "高鐵",
          amount: -1490,
        }),
      ],
    });
    const group = await screen.findByRole("region", {
      name: "玉山銀行 信用卡 末四碼 1111",
    });
    expect(within(group).getAllByTestId("source-row")).toHaveLength(1);
    expect(group).toHaveTextContent("高鐵");
    expect(screen.queryByText("咖啡")).toBeNull();
    expect(screen.getByRole("tab", { name: "信用卡" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.getByRole("button", { name: "清除篩選：卡片末四碼 1111" }),
    ).toBeInTheDocument();
  });

  it("lists invoices with their match status and item preview", async () => {
    renderPage("#/transactions?tab=invoice", {
      items: [
        ...items,
        activity({
          id: "inv-lunch",
          source: "invoice",
          title: "便當店",
          invoiceId: "inv-lunch",
          categoryId: undefined,
          category: "發票",
          roleReason: "invoice",
        }),
        activity({
          id: "inv-maybe",
          source: "invoice",
          title: "超商",
          invoiceId: "inv-maybe",
          categoryId: undefined,
          category: "發票",
          reviewStatus: "needs_review",
          roleReason: "invoice_ambiguous",
        }),
        activity({
          id: "inv-backend",
          source: "invoice",
          title: "加油站",
          invoiceId: "inv-backend",
          categoryId: undefined,
          category: "發票",
          ...({
            matchStatus: "awaiting_card",
            itemsPreview: ["95 無鉛", "洗車"],
          } as Partial<ActivityItem>),
        }),
      ],
    });
    await waitFor(() =>
      expect(screen.getAllByTestId("source-row")).toHaveLength(4),
    );
    const status = (title: string) =>
      within(
        screen
          .getAllByTestId("source-row")
          .find((row) => row.textContent?.includes(title))!,
      ).getByTestId("match-status").textContent;
    expect(status("星巴克")).toBe("已對應刷卡");
    expect(status("便當店")).toBe("未對應");
    expect(status("超商")).toBe("疑似重複");
    expect(status("加油站")).toBe("等待刷卡入帳");
    expect(screen.getByText("95 無鉛、洗車")).toBeInTheDocument();
  });
});
