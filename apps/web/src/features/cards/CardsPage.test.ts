import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/svelte";
import { QueryClient, QueryClientProvider } from "@tanstack/svelte-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  CardBillsResponse,
  CardIssuerSummary,
  CardsSummaryResponse,
} from "@taiwan-fin-hub/core";
import type { ApiClient } from "@/shared/api/client";
import CardsPage from "./CardsPage.svelte";

function issuer(
  overrides: Partial<CardIssuerSummary> &
    Pick<CardIssuerSummary, "issuer" | "name">,
): CardIssuerSummary {
  return {
    bankCode: null,
    combinedStatement: false,
    currentBill: null,
    unbilled: {
      since: "2026-09-07",
      amount: 0,
      pendingAmount: 0,
      transactionCount: 0,
      missingCurrencies: [],
    },
    cards: [],
    source: {
      connectorId: overrides.issuer,
      name: overrides.name,
      mode: "sync",
      lastSuccessAt: "2026-09-25T22:00:00.000Z",
      lastStatus: "success",
    },
    lastUpdatedAt: "2026-09-25T22:00:00.000Z",
    estimated: false,
    estimatedReasons: [],
    ...overrides,
  };
}

const bill = (
  overrides: Partial<NonNullable<CardIssuerSummary["currentBill"]>>,
) => ({
  billingPeriod: "2026-09",
  currency: "TWD",
  statementBalance: 30000,
  statementEstimated: false,
  minimumPayment: 3000,
  paymentDueDate: "2026-10-01",
  statementClosingDate: "2026-09-06",
  paidAmount: 0,
  remainingAmount: 30000,
  paymentStatus: "unpaid" as const,
  minimumPaid: false,
  payments: [],
  daysUntilDue: 5,
  ...overrides,
});

const cathay = issuer({
  issuer: "cathaybk",
  name: "國泰世華銀行",
  combinedStatement: true,
  currentBill: bill({
    paidAmount: 10000,
    remainingAmount: 20000,
    paymentStatus: "partial",
    minimumPaid: true,
    payments: [
      {
        transactionId: "pay",
        date: "2026-09-20",
        amount: 10000,
        side: "bank",
        description: "信用卡款",
      },
    ],
  }),
  unbilled: {
    since: "2026-09-07",
    amount: 2100,
    pendingAmount: 800,
    transactionCount: 4,
    missingCurrencies: [],
  },
  cards: [
    {
      key: "cathay-1111:1111",
      accountId: "cathay-1111",
      last4: "1111",
      name: "國泰信用卡 1111",
      unbilledAmount: 1000,
      pendingAmount: 0,
      transactionCount: 2,
      activityFilter: {
        q: "國泰信用卡 1111",
        source: "card",
        from: "2026-09-07",
      },
      activityFilterExact: true,
    },
    {
      key: "cathay-2222:2222",
      accountId: "cathay-2222",
      last4: "2222",
      name: "國泰信用卡 2222",
      unbilledAmount: 800,
      pendingAmount: 800,
      transactionCount: 1,
      activityFilter: {
        q: "國泰信用卡 2222",
        source: "card",
        from: "2026-09-07",
      },
      activityFilterExact: true,
    },
  ],
});

const ctbc = issuer({
  issuer: "ctbc",
  name: "中國信託銀行",
  currentBill: bill({
    statementBalance: 5000,
    remainingAmount: 5000,
    paymentDueDate: "2026-09-30",
    daysUntilDue: 4,
  }),
  source: {
    connectorId: "ctbc",
    name: "中國信託銀行",
    mode: "manual_import",
    lastSuccessAt: "2026-09-10T12:00:00.000Z",
    lastStatus: "success",
  },
  lastUpdatedAt: "2026-09-10T12:00:00.000Z",
  estimated: true,
  estimatedReasons: ["manual_import"],
});

function summary(
  overrides: Partial<CardsSummaryResponse> = {},
): CardsSummaryResponse {
  return {
    asOf: "2026-09-26",
    currency: "TWD",
    totals: {
      statementBalance: 35000,
      remainingAmount: 25000,
      unbilledAmount: 2100,
    },
    nextDue: {
      issuer: "ctbc",
      name: "中國信託銀行",
      paymentDueDate: "2026-09-30",
      daysUntilDue: 4,
      remainingAmount: 5000,
      paymentStatus: "unpaid",
    },
    issuers: [ctbc, cathay],
    ...overrides,
  };
}

function history(issuerId: string): CardBillsResponse {
  return {
    issuer: issuerId,
    name: issuerId,
    estimated: false,
    estimatedReasons: [],
    bills: [
      {
        ...bill({}),
        billingPeriod: issuerId === "ctbc" ? "2026-09" : "2026-08",
      },
    ],
  };
}

function renderPage(data: CardsSummaryResponse) {
  const get = vi.fn(async (path: string) => {
    if (path === "/api/cards/summary") return data;
    const match = path.match(/^\/api\/cards\/([^/]+)\/bills$/);
    if (match) return history(match[1]!);
    throw new Error(`unexpected ${path}`);
  });
  const api = { get } as unknown as ApiClient;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    CardsPage,
    { props: { api } },
    { wrapper: QueryClientProvider, wrapperProps: { client: queryClient } },
  );
  return get;
}

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("CardsPage", () => {
  it("shows the total due and highlights a countdown within seven days", async () => {
    renderPage(summary());
    expect(await screen.findByTestId("cards-total-due")).toHaveTextContent(
      "NT$35,000",
    );
    const nextDue = screen.getByTestId("cards-next-due");
    expect(nextDue).toHaveAttribute("data-urgency", "soon");
    expect(nextDue).toHaveAttribute("role", "alert");
    expect(nextDue).toHaveTextContent("還有 4 天");
    expect(nextDue).toHaveTextContent("中國信託銀行");
  });

  it("does not highlight a due date more than seven days away", async () => {
    renderPage(
      summary({
        nextDue: {
          issuer: "ctbc",
          name: "中國信託銀行",
          paymentDueDate: "2026-10-10",
          daysUntilDue: 14,
          remainingAmount: 5000,
          paymentStatus: "unpaid",
        },
      }),
    );
    const nextDue = await screen.findByTestId("cards-next-due");
    expect(nextDue).toHaveAttribute("data-urgency", "normal");
    expect(nextDue).not.toHaveAttribute("role");
    expect(nextDue).toHaveTextContent("還有 14 天");
  });

  it("marks estimated issuers with their source and update time", async () => {
    renderPage(summary());
    const row = await screen.findByTestId("issuer-ctbc");
    expect(within(row).getByText("推估")).toBeInTheDocument();
    expect(within(row).getByTestId("issuer-estimated")).toHaveTextContent(
      "半自動匯入",
    );
    expect(within(row).getByTestId("issuer-estimated")).toHaveTextContent(
      "更新於",
    );
    const cathayRow = screen.getByTestId("issuer-cathaybk");
    expect(within(cathayRow).queryByText("推估")).not.toBeInTheDocument();
    expect(within(cathayRow).getByText("部分繳")).toBeInTheDocument();
  });

  it("expands an issuer group into per-card unbilled rows linking to transactions", async () => {
    renderPage(summary());
    const row = await screen.findByTestId("issuer-cathaybk");
    const toggle = within(row).getAllByRole("button")[0]!;
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(within(row).queryByTestId("card-cathay-1111:1111")).toBeNull();

    await fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const card = within(row).getByTestId("card-cathay-1111:1111");
    expect(card).toHaveTextContent("國泰信用卡 1111");
    expect(card).toHaveTextContent("NT$1,000");
    expect(
      within(card).getByRole("link", { name: "查看明細" }),
    ).toHaveAttribute("href", "#/transactions?tab=card&card=1111");
    expect(within(row).getByTestId("card-cathay-2222:2222")).toHaveTextContent(
      "待入帳",
    );
    expect(row).toHaveTextContent("存款扣款");
    expect(within(row).getByTestId("issuer-source")).toHaveTextContent(
      "自動同步",
    );

    await fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("opens the issuer from the hash and switches bill history", async () => {
    window.history.replaceState(null, "", "/#/cards?issuer=cathaybk");
    const get = renderPage(summary());
    const row = await screen.findByTestId("issuer-cathaybk");
    expect(within(row).getAllByRole("button")[0]).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await waitFor(() =>
      expect(get).toHaveBeenCalledWith("/api/cards/cathaybk/bills"),
    );
    expect(await screen.findByText("2026-08")).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("tab", { name: "中國信託銀行" }));
    await waitFor(() =>
      expect(get).toHaveBeenCalledWith("/api/cards/ctbc/bills"),
    );
    expect(screen.getByRole("tab", { name: "中國信託銀行" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});
