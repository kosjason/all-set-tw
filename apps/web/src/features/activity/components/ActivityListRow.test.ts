import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import ActivityListRow from "./ActivityListRow.svelte";
import ActivityTableRow, {
  type ActivityTableRowProps,
} from "./ActivityTableRow.svelte";
import type { ActivityItem } from "../model/types";

const item: ActivityItem = {
  id: "tx-1",
  source: "card",
  date: "2026-09-04",
  title: "全聯福利中心",
  subtitle: "",
  amount: -450,
  currency: "TWD",
  category: "餐飲",
  categoryId: "food",
  status: "posted",
  transactionId: "tx-1",
  institutionName: "國泰世華",
  accountName: "CUBE 卡",
};

const categoryOptions = [
  { id: "food", label: "餐飲" },
  { id: "shopping", label: "購物" },
  { id: "other", label: "未分類" },
];

function renderTableRow(props: Partial<ActivityTableRowProps> = {}) {
  const onOpen = vi.fn();
  const onCategoryChange = vi.fn();
  render(ActivityTableRow, {
    target: document.body
      .appendChild(document.createElement("table"))
      .appendChild(document.createElement("tbody")),
    props: {
      item,
      date: "9/4",
      time: "12:30",
      query: "",
      searching: false,
      rates: {},
      categoryOptions,
      onCategoryChange,
      onOpen,
      ...props,
    },
  });
  return { onOpen, onCategoryChange };
}

describe("activity list row", () => {
  it("renders title, time, institution, account, category and amount", async () => {
    const onOpen = vi.fn();
    render(ActivityListRow, {
      item,
      time: "12:30",
      query: "",
      searching: false,
      rates: {},
      onOpen,
    });
    const row = screen.getByRole("button", {
      name: "查看 全聯福利中心 活動詳情",
    });
    expect(row).toHaveTextContent("全聯福利中心");
    expect(row).toHaveTextContent("12:30 · 國泰世華 · CUBE 卡");
    expect(screen.getByText("🍜 餐飲")).toBeInTheDocument();
    expect(screen.getByText("−NT$450")).toBeInTheDocument();
    await fireEvent.click(row);
    expect(onOpen).toHaveBeenCalledWith(item);
  });

  it("falls back to the source label and shows matched search text", () => {
    render(ActivityListRow, {
      item: {
        ...item,
        institutionName: undefined,
        invoiceId: "inv-1",
        searchText: "發票品項 牛奶",
      },
      query: "牛奶",
      searching: true,
      rates: {},
      onOpen: () => {},
    });
    expect(screen.getByText("信用卡＋發票")).toBeInTheDocument();
    expect(screen.getByText("牛奶")).toBeInTheDocument();
  });

  it("keeps excluded activities visible with a strikethrough", () => {
    render(ActivityListRow, {
      item: { ...item, excludedFromCalculation: true },
      query: "",
      searching: false,
      rates: {},
      onOpen: () => {},
    });
    expect(screen.getByText("全聯福利中心").closest("p")).toHaveClass(
      "line-through",
    );
    expect(screen.getByText(/不計入/)).toBeInTheDocument();
  });

  it("shows 電子發票 instead of the invoice number and fades duplicates", () => {
    render(ActivityListRow, {
      item: {
        ...item,
        id: "inv-1",
        source: "invoice",
        title: "全聯",
        institutionName: "電子發票",
        accountName: "AB12345678",
        subtitle: "AB12345678",
        transactionId: undefined,
        invoiceId: "inv-1",
        amount: 450,
        category: "發票",
        categoryId: undefined,
        economicRole: "spending",
        duplicateOf: { kind: "bank_transaction", id: "tx-1" },
      },
      duplicateLabel: "已併入信用卡交易",
      query: "",
      searching: false,
      rates: {},
      onOpen: () => {},
    });
    const row = screen.getByRole("button", { name: "查看 全聯 活動詳情" });
    expect(row).toHaveTextContent("電子發票");
    expect(row).not.toHaveTextContent("AB12345678");
    expect(row).toHaveTextContent("已併入信用卡交易");
    expect(row).toHaveTextContent("不重複計算");
    expect(row.parentElement).toHaveAttribute("data-duplicate", "true");
  });

  it("shows the role instead of 未分類 and names the role when excluded", () => {
    render(ActivityListRow, {
      item: {
        ...item,
        title: "中信卡",
        category: "未分類",
        categoryId: "other",
        economicRole: "card_payment",
        excludedFromCalculation: true,
      },
      query: "",
      searching: false,
      rates: {},
      onOpen: () => {},
    });
    const row = screen.getByRole("button", { name: "查看 中信卡 活動詳情" });
    expect(row).not.toHaveTextContent("未分類");
    expect(row).toHaveTextContent("繳卡費 · 繳卡費");
    expect(row.querySelector("[data-category-label]")).not.toHaveClass(
      "bg-amber-50",
    );
  });

  it("lets a needs-review row pick its role outside the row button", async () => {
    const onRoleChange = vi.fn();
    const onOpen = vi.fn();
    const review: ActivityItem = {
      ...item,
      economicRole: "card_payment",
      reviewStatus: "needs_review",
      roleReason: "possible_unsynced_card",
    };
    render(ActivityListRow, {
      item: review,
      query: "",
      searching: false,
      rates: {},
      onRoleChange,
      onOpen,
    });
    const row = screen.getByRole("button", {
      name: "查看 全聯福利中心 活動詳情",
    });
    expect(row).toHaveTextContent("繳卡費");
    expect(row).toHaveTextContent("待確認");
    const select = screen.getByRole("combobox", {
      name: "確認「全聯福利中心」是哪一種活動",
    });
    expect(row).not.toContainElement(select);
    await fireEvent.change(select, { target: { value: "spending" } });
    expect(onRoleChange).toHaveBeenCalledWith(review, "spending");
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe("activity table row", () => {
  it("opens details from the merchant button and from the row", async () => {
    const { onOpen } = renderTableRow({
      item: { ...item, invoiceId: "inv-1", invoiceAmount: 500 },
    });
    const button = screen.getByRole("button", {
      name: "查看 全聯福利中心 活動詳情",
    });
    expect(screen.getByText("點數折抵 NT$50")).toBeInTheDocument();
    await fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledTimes(1);
    await fireEvent.click(screen.getByText("國泰世華"));
    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(onOpen).toHaveBeenCalledWith(
      expect.objectContaining({ id: "tx-1" }),
    );
  });

  it("changes the category inline without opening details", async () => {
    const { onOpen, onCategoryChange } = renderTableRow();
    const select = screen.getByRole("combobox", {
      name: "變更「全聯福利中心」的分類",
    });
    expect(select).toHaveValue("food");
    await fireEvent.click(select);
    await fireEvent.change(select, { target: { value: "shopping" } });
    expect(onCategoryChange).toHaveBeenCalledWith(item, "shopping");
    // 確認對話框送出前仍顯示原分類。
    expect(select).toHaveValue("food");
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("lets an unmatched invoice change its category from the chip", async () => {
    const { onCategoryChange } = renderTableRow({
      item: {
        ...item,
        id: "inv-1",
        source: "invoice",
        transactionId: undefined,
        invoiceId: "inv-1",
        category: "未分類",
        categoryId: "other",
      },
    });
    const chip = screen.getByRole("combobox", {
      name: "變更「全聯福利中心」的分類",
    });
    await fireEvent.change(chip, { target: { value: "food" } });
    expect(onCategoryChange).toHaveBeenCalledWith(
      expect.objectContaining({ id: "inv-1" }),
      "food",
    );
  });

  it("shows a read-only category for activities that cannot be reclassified", () => {
    renderTableRow({
      item: {
        ...item,
        source: "investment",
        transactionId: undefined,
        category: "投資活動",
        categoryId: undefined,
      },
    });
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText("投資活動")).toBeInTheDocument();
  });

  it("marks excluded activities without hiding them", () => {
    renderTableRow({ item: { ...item, excludedFromCalculation: true } });
    expect(
      screen.getByRole("button", { name: "查看 全聯福利中心 活動詳情" }),
    ).toHaveClass("line-through");
    expect(screen.getByText("不計入收支")).toBeInTheDocument();
  });

  it("shows the role instead of 未分類 for activities that are not spending", async () => {
    const onRoleChange = vi.fn();
    const payment: ActivityItem = {
      ...item,
      title: "本行扣繳",
      amount: 89571,
      category: "未分類",
      categoryId: "other",
      economicRole: "card_payment",
      reviewStatus: "auto",
      roleReason: "card_payment",
    };
    const { onOpen, onCategoryChange } = renderTableRow({
      item: payment,
      onRoleChange,
    });
    expect(screen.queryByText("未分類")).toBeNull();
    expect(
      screen.queryByRole("combobox", { name: "變更「本行扣繳」的分類" }),
    ).toBeNull();
    const role = screen.getByRole("combobox", {
      name: "變更「本行扣繳」的角色",
    });
    expect(role).toHaveAttribute("data-role-cell", "card_payment");
    expect(role).toHaveTextContent("繳卡費");
    // 已確認的角色再選一次不送出。
    await fireEvent.change(role, { target: { value: "card_payment" } });
    expect(onRoleChange).not.toHaveBeenCalled();
    await fireEvent.change(role, { target: { value: "spending" } });
    expect(onRoleChange).toHaveBeenCalledWith(payment, "spending");
    expect(onCategoryChange).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.queryByRole("combobox", { name: /是哪一種活動/ })).toBeNull();
  });

  it("confirms a needs-review non-spending role from the role chip", async () => {
    const onRoleChange = vi.fn();
    const review: ActivityItem = {
      ...item,
      economicRole: "card_payment",
      reviewStatus: "needs_review",
      roleReason: "possible_unsynced_card",
    };
    renderTableRow({ item: review, onRoleChange });
    const role = screen.getByRole("combobox", {
      name: "變更「全聯福利中心」的角色",
    });
    expect(role).toHaveTextContent("繳卡費（待確認）");
    expect(screen.queryByRole("combobox", { name: /是哪一種活動/ })).toBeNull();
    await fireEvent.change(role, { target: { value: "card_payment" } });
    expect(onRoleChange).toHaveBeenCalledWith(review, "card_payment");
  });

  it("names the role for excluded transfers and card payments", () => {
    renderTableRow({
      item: {
        ...item,
        excludedFromCalculation: true,
        economicRole: "own_transfer",
      },
    });
    const status = screen.getAllByRole("cell").at(-1)!;
    expect(status).toHaveTextContent("轉到自己帳戶");
    expect(status).not.toHaveTextContent("不計入收支");
    expect(
      screen.getByRole("button", { name: "查看 全聯福利中心 活動詳情" }),
    ).toHaveClass("line-through");
  });

  it("picks a role inline for needs-review activities without opening details", async () => {
    const onRoleChange = vi.fn();
    const review: ActivityItem = {
      ...item,
      economicRole: "spending",
      reviewStatus: "needs_review",
    };
    const { onOpen } = renderTableRow({ item: review, onRoleChange });
    expect(screen.getByText("待確認")).toBeInTheDocument();
    await fireEvent.change(
      screen.getByRole("combobox", {
        name: "確認「全聯福利中心」是哪一種活動",
      }),
      { target: { value: "own_transfer" } },
    );
    expect(onRoleChange).toHaveBeenCalledWith(review, "own_transfer");
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("shows a truncated note line under the name on mobile and desktop", () => {
    const noted = { ...item, note: "幫室友代墊\n下週還" };
    render(ActivityListRow, {
      item: noted,
      query: "",
      searching: false,
      rates: {},
      onOpen: vi.fn(),
    });
    renderTableRow({ item: noted });
    const lines = document.querySelectorAll("[data-activity-note]");
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line).toHaveClass("truncate");
      expect(line).toHaveTextContent("📝 備註：幫室友代墊 下週還");
    }
  });

  it("strikes through 不計入 activities", () => {
    render(ActivityListRow, {
      item: { ...item, economicRole: "excluded", roleReason: "override" },
      query: "",
      searching: false,
      rates: {},
      onOpen: vi.fn(),
    });
    const row = screen.getByRole("button", {
      name: "查看 全聯福利中心 活動詳情",
    });
    expect(row.querySelector("p")).toHaveClass("line-through");
    expect(row).toHaveTextContent("不計入");
  });

  it("uses the merchant display name and lists invoice items under it", () => {
    const matched: ActivityItem = {
      ...item,
      title: "連支＊路易莎咖啡-信義門市",
      displayName: "路易莎咖啡",
      invoiceId: "inv-1",
      itemsPreview: ["拿鐵", "可頌", "司康"],
      categorySource: "auto_suggestion",
    };
    render(ActivityListRow, {
      item: matched,
      query: "",
      searching: false,
      rates: {},
      onOpen: vi.fn(),
    });
    renderTableRow({ item: matched });
    expect(
      screen.getAllByRole("button", { name: "查看 路易莎咖啡 活動詳情" }),
    ).toHaveLength(2);
    expect(screen.queryByText("連支＊路易莎咖啡-信義門市")).toBeNull();
    for (const line of document.querySelectorAll("[data-activity-items]"))
      expect(line).toHaveTextContent("拿鐵、可頌、司康");
    // 自動套用的分類標「自動」（手機列與桌面 chip 各一）。
    expect(document.querySelectorAll("[data-category-auto]")).toHaveLength(2);
  });

  it("shows items only for invoices or activities with a matched invoice", () => {
    renderTableRow({ item: { ...item, itemsPreview: ["牛奶"] } });
    expect(document.querySelector("[data-activity-items]")).toBeNull();
  });

  it("offers the eight categories with emoji in a single-level chip menu", async () => {
    const { onCategoryChange } = renderTableRow({
      categoryOptions: [
        { id: "food", label: "餐飲", emoji: "🍜" },
        { id: "shopping", label: "購物", emoji: "🛍️" },
      ],
      item: { ...item, categoryId: "other", category: "未分類" },
    });
    const chip = screen.getByRole("combobox", {
      name: "變更「全聯福利中心」的分類",
    });
    expect(chip.querySelectorAll("optgroup")).toHaveLength(0);
    expect(
      [...chip.querySelectorAll("option")].map((option) => option.textContent),
    ).toEqual(["❔ 未分類", "🍜 餐飲", "🛍️ 購物"]);
    await fireEvent.change(chip, { target: { value: "shopping" } });
    expect(onCategoryChange).toHaveBeenCalledWith(
      expect.objectContaining({ id: "tx-1" }),
      "shopping",
    );
  });
});
