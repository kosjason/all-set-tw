import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/svelte";
import { QueryClient, QueryClientProvider } from "@tanstack/svelte-query";
import type { InboxItem, InboxResponse } from "@taiwan-fin-hub/core";
import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@/shared/api/client";
import InboxPage from "./InboxPage.svelte";
import {
  groupInboxItems,
  inboxNavigation,
  inboxRoleActivity,
} from "./model/inbox";

const items: InboxItem[] = [
  {
    id: "connector_error:esun:1",
    kind: "connector_error",
    severity: "blocking",
    title: "玉山銀行同步失敗",
    detail: "最近一次同步沒有成功。",
    target: { view: "data-sources", query: { connector: "esun" } },
    createdAt: "2026-09-25T01:00:00Z",
    action: { kind: "open_connector", label: "查看資料來源" },
  },
  {
    id: "card_due_unpaid:cathaybk:2026-09",
    kind: "card_due_unpaid",
    severity: "blocking",
    title: "國泰世華卡費尚未繳款",
    detail: "2026-09 帳單 3 天後到期（截止日 2026-10-01）。",
    target: { view: "cards", query: { issuer: "cathaybk" } },
    createdAt: "2026-09-20",
    action: { kind: "open_card", label: "查看帳單" },
    amount: 12000,
    currency: "TWD",
  },
  {
    id: "needs_review:bank:tx-1",
    kind: "needs_review",
    severity: "tidy",
    title: "確認活動：跨行轉帳",
    detail: "2026-09-04 · 分類為轉帳，但對方不是登記的自有帳戶。",
    target: {
      view: "activity",
      query: { month: "2026-09", activity: "bank:tx-1" },
    },
    createdAt: "2026-09-04",
    action: { kind: "review_activity", label: "確認" },
    amount: 3000,
    currency: "TWD",
  },
  {
    id: "uncategorized:2026-08,2026-09:5",
    kind: "uncategorized",
    severity: "tidy",
    title: "5 筆消費尚未分類",
    detail: "2026-09 5 筆",
    target: {
      view: "activity",
      query: { month: "2026-09", uncategorized: "1" },
    },
    createdAt: "2026-09-10",
    action: { kind: "categorize", label: "分類" },
    amount: 4200,
    currency: "TWD",
    count: 5,
  },
];

const response: InboxResponse = {
  counts: { blocking: 2, tidy: 2 },
  months: ["2026-08", "2026-09"],
  items,
  unavailable: [],
};

function renderInbox(data: InboxResponse = response) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const api = {
    get: vi.fn(() => Promise.resolve(data)),
    put: vi.fn().mockResolvedValue({}),
  } as unknown as ApiClient;
  const navigate = vi.fn();
  render(
    InboxPage,
    { props: { api, navigate } },
    { wrapper: QueryClientProvider, wrapperProps: { client: queryClient } },
  );
  return { api, navigate };
}

describe("inbox model", () => {
  it("groups blocking before tidy items and drops empty groups", () => {
    expect(
      groupInboxItems(response).map((group) => [
        group.title,
        group.items.length,
      ]),
    ).toEqual([
      ["需要處理", 2],
      ["待整理", 2],
    ]);
    expect(
      groupInboxItems({ ...response, items: items.slice(2) }).map(
        (group) => group.severity,
      ),
    ).toEqual(["tidy"]);
  });

  it("maps API targets (including the old activity route) to the new pages", () => {
    expect(inboxNavigation(items[0]!)).toEqual({
      view: "data-sources",
      options: { query: "connector=esun", connectorId: "esun" },
    });
    expect(inboxNavigation(items[1]!)).toEqual({
      view: "cards",
      options: { query: "issuer=cathaybk" },
    });
    expect(inboxNavigation(items[2]!)).toEqual({
      view: "transactions",
      options: { query: "month=2026-09&activity=bank%3Atx-1" },
    });
  });

  it("only offers inline role choices for needs-review activities", () => {
    expect(inboxRoleActivity(items[2]!)).toEqual({
      source: "bank",
      id: "tx-1",
    });
    expect(inboxRoleActivity(items[3]!)).toBeNull();
    expect(inboxRoleActivity(items[0]!)).toBeNull();
  });
});

describe("inbox page", () => {
  it("lists blocking and tidy items with amounts and opens their targets", async () => {
    const { navigate } = renderInbox();
    const blocking = await screen.findByRole("region", { name: /需要處理/ });
    const tidy = screen.getByRole("region", { name: /待整理/ });
    expect(within(blocking).getAllByTestId("inbox-item")).toHaveLength(2);
    expect(within(tidy).getAllByTestId("inbox-item")).toHaveLength(2);
    expect(blocking).toHaveTextContent("國泰世華卡費尚未繳款");
    expect(blocking).toHaveTextContent("NT$12,000");
    expect(tidy).toHaveTextContent("NT$4,200・5 筆");
    await fireEvent.click(
      within(blocking).getByRole("button", { name: "查看帳單" }),
    );
    expect(navigate).toHaveBeenCalledWith("cards", {
      query: "issuer=cathaybk",
    });
    await fireEvent.click(within(tidy).getByRole("button", { name: "分類" }));
    expect(navigate).toHaveBeenLastCalledWith("transactions", {
      query: "month=2026-09&uncategorized=1",
    });
  });

  it("confirms a role right on a needs-review item", async () => {
    const { api } = renderInbox();
    const select = await screen.findByRole("combobox", {
      name: "確認「跨行轉帳」是哪一種活動",
    });
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
    await fireEvent.change(select, { target: { value: "own_transfer" } });
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith(
        "/api/activity/role-overrides/bank_transaction/tx-1",
        { economicRole: "own_transfer" },
      ),
    );
  });

  it("says when there is nothing to do and when some sources could not be checked", async () => {
    renderInbox({
      counts: { blocking: 0, tidy: 0 },
      months: ["2026-08", "2026-09"],
      items: [],
      unavailable: ["cards"],
    });
    expect(await screen.findByText("目前沒有待處理的事項")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("信用卡");
  });
});
