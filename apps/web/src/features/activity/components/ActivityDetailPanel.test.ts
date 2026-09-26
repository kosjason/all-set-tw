import { render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import type { InvoiceRow } from "@/data/invoices/types";
import ActivityDetailPanel, {
  type ActivityDetailPanelProps,
} from "./ActivityDetailPanel.svelte";
import type { ActivityItem } from "../model/types";

const usdInvoice: ActivityItem = {
  id: "inv-usd",
  source: "invoice",
  date: "2026-09-02",
  title: "Anthropic",
  subtitle: "",
  amount: 10.98,
  currency: "USD",
  amountTwd: 356,
  category: "未分類",
  categoryId: "other",
  status: "已開立",
  invoiceId: "inv-usd",
  economicRole: "spending",
  reviewStatus: "auto",
  duplicateOf: null,
  roleReason: "invoice",
};

const invoiceRow: InvoiceRow = {
  id: "inv-usd",
  invoiceNumber: "AB12345678",
  invoiceDate: "2026-09-02",
  sellerName: "Anthropic",
  amount: 10.98,
  currency: "USD",
  items: [
    {
      id: "line-1",
      description: "Claude Pro",
      quantity: 1,
      unitPrice: 10.98,
      amount: 10.98,
    },
  ],
} as unknown as InvoiceRow;

function renderPanel(props: Partial<ActivityDetailPanelProps> = {}) {
  render(ActivityDetailPanel, {
    item: usdInvoice,
    invoice: invoiceRow,
    rates: { USD: 32.4 },
    invoiceDetail: invoiceRow,
    invoiceDetailPending: false,
    invoiceDetailFailed: false,
    categoryOptions: [{ id: "other", label: "未分類" }],
    calculationDisabled: false,
    onClose: vi.fn(),
    onCategoryChange: vi.fn(),
    onCalculationChange: vi.fn(),
    onOpenMapping: vi.fn(),
    onRoleChange: vi.fn(),
    onRoleReset: vi.fn(),
    onNoteSave: vi.fn().mockResolvedValue(undefined),
    ...props,
  });
  return screen.getByRole("dialog", { name: "活動明細" });
}

describe("activity detail panel · foreign invoices", () => {
  it("shows the invoice total in its currency with the TWD conversion", () => {
    const dialog = renderPanel();
    expect(dialog).toHaveTextContent("總額 US$10.98（≈NT$356）");
    // 品項也以原幣（含小數）顯示，不會誤顯成 NT$10.98。
    expect(dialog).toHaveTextContent("× US$10.98");
    expect(dialog).not.toHaveTextContent("NT$10.98");
    expect(dialog).not.toHaveTextContent("NT$11");
  });

  it("uses the matched card item's converted invoice amount", () => {
    const dialog = renderPanel({
      item: {
        ...usdInvoice,
        id: "tx-1",
        source: "card",
        transactionId: undefined,
        currency: "TWD",
        amount: -360,
        amountTwd: -360,
        invoiceAmount: 356,
        invoiceCurrency: "USD",
        invoiceOriginalAmount: 10.98,
      },
    });
    expect(dialog).toHaveTextContent("總額 US$10.98（≈NT$356）");
    expect(dialog).not.toHaveTextContent("點數折抵");
  });

  it("explains repeated invoices and foreign transaction fees", () => {
    const dialog = renderPanel({
      item: {
        ...usdInvoice,
        roleReason: "invoice_repeat",
        reviewStatus: "needs_review",
        duplicateOf: { kind: "invoice", id: "inv-first" },
      },
      foreignFee: "屬於 Claude 的國外交易服務費",
    });
    expect(dialog).toHaveTextContent("同一筆消費可能重複開立發票");
    expect(dialog).toHaveTextContent(
      "屬於 Claude 的國外交易服務費，分類沿用該筆消費",
    );
  });
});
