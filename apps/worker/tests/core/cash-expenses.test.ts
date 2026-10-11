import { describe, expect, it } from "vitest";
import {
  activitySpendingEntries,
  allocateCashExpenses,
  cashExpenseActivityItem,
  isCashWithdrawalPool,
  summarizeActivityMonths,
  type ActivityItem,
  type CashExpense,
} from "@taiwan-fin-hub/shared";

// 合成資料：虛構的提款與現金支出。
function withdrawal(
  id: string,
  date: string,
  amount: number,
  overrides: Partial<ActivityItem> = {},
): ActivityItem {
  return {
    id,
    source: "bank",
    date: `${date}T12:00:00+08:00`,
    dateHasTime: true,
    title: `無卡提款 ${id.toUpperCase()}`,
    subtitle: "某銀行",
    amount: -amount,
    currency: "TWD",
    amountTwd: -amount,
    category: "其他",
    categoryId: "misc",
    categorySource: "auto_suggestion",
    status: "posted",
    economicRole: "spending",
    reviewStatus: "auto",
    duplicateOf: null,
    investmentEventKind: null,
    roleReason: "sign",
    ...overrides,
  };
}

function cash(
  id: string,
  date: string,
  amount: number,
  categoryId = "food",
): ActivityItem {
  const expense: CashExpense = {
    id,
    date,
    amount,
    categoryId,
    description: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
  return cashExpenseActivityItem(expense, categoryId === "food" ? "餐飲" : "");
}

function allocation(items: ActivityItem[], id: string) {
  return items.find((item) => item.id === id)?.cashWithdrawal;
}

describe("isCashWithdrawalPool", () => {
  it("accepts unexplained TWD bank withdrawals only", () => {
    expect(isCashWithdrawalPool(withdrawal("w", "2026-09-03", 5000))).toBe(
      true,
    );
    expect(
      isCashWithdrawalPool(
        withdrawal("w", "2026-09-03", 5000, { categoryId: "other" }),
      ),
    ).toBe(true);
    expect(
      isCashWithdrawalPool(
        withdrawal("w", "2026-09-03", 5000, { title: "ATM 提款" }),
      ),
    ).toBe(true);
  });

  it("rejects withdrawals with a known purpose or another role", () => {
    // 使用者把提款歸到具體分類（付房租）、改成代墊，或不是提款文字。
    for (const overrides of [
      { categoryId: "housing" },
      { economicRole: "advance" as const },
      { economicRole: "own_transfer" as const },
      { duplicateOf: { kind: "bank_transaction" as const, id: "x" } },
      { source: "card" as const },
      { currency: "USD", amountTwd: -150000 },
      { title: "提款卡年費" },
      { title: "跨行提款手續費" },
      { title: "ATM 提款 FEE" },
      { amount: 5000, amountTwd: 5000 },
    ])
      expect(
        isCashWithdrawalPool(withdrawal("w", "2026-09-03", 5000, overrides)),
      ).toBe(false);
  });
});

describe("allocateCashExpenses", () => {
  it("deducts same-month cash expenses from withdrawals, earliest first", () => {
    const items = allocateCashExpenses([
      withdrawal("w1", "2026-09-03", 5000),
      withdrawal("w2", "2026-09-21", 5000),
      cash("c1", "2026-09-05", 3000),
      cash("c2", "2026-09-25", 4000),
    ]);
    expect(allocation(items, "w1")).toEqual({ allocated: 5000, remaining: 0 });
    expect(allocation(items, "w2")).toEqual({
      allocated: 2000,
      remaining: 3000,
    });
  });

  it("uses the previous month's leftover only after this month's withdrawals", () => {
    const items = allocateCashExpenses([
      withdrawal("aug1", "2026-08-02", 2000),
      withdrawal("aug2", "2026-08-30", 3000),
      cash("aug-cash", "2026-08-10", 1000),
      withdrawal("sep", "2026-09-10", 1000),
      cash("sep-cash", "2026-09-02", 2500),
    ]);
    // 九月先扣九月的 1,000，剩 1,500 從八月月底領的那筆扣。
    expect(allocation(items, "sep")).toEqual({ allocated: 1000, remaining: 0 });
    expect(allocation(items, "aug2")).toEqual({
      allocated: 1500,
      remaining: 1500,
    });
    // 八月自己的 1,000 先扣八月最早的提款。
    expect(allocation(items, "aug1")).toEqual({
      allocated: 1000,
      remaining: 1000,
    });
  });

  it("never reaches back two months and never goes below zero", () => {
    const items = allocateCashExpenses([
      withdrawal("jul", "2026-07-30", 5000),
      withdrawal("aug", "2026-08-30", 500),
      cash("sep-cash", "2026-09-05", 2000),
    ]);
    expect(allocation(items, "aug")).toEqual({ allocated: 500, remaining: 0 });
    expect(allocation(items, "jul")).toEqual({
      allocated: 0,
      remaining: 5000,
    });
  });

  it("marks pool withdrawals even when nothing is recorded", () => {
    const items = allocateCashExpenses([withdrawal("w", "2026-09-03", 5000)]);
    expect(allocation(items, "w")).toEqual({ allocated: 0, remaining: 5000 });
  });

  it("leaves withdrawals with a known purpose untouched", () => {
    const items = allocateCashExpenses([
      withdrawal("rent", "2026-09-01", 20000, { categoryId: "housing" }),
      cash("c", "2026-09-05", 300),
    ]);
    expect(allocation(items, "rent")).toBeUndefined();
  });
});

describe("summary with cash expenses", () => {
  const items = allocateCashExpenses([
    withdrawal("w", "2026-09-03", 5000),
    cash("c-food", "2026-09-05", 300),
    cash("c-misc", "2026-09-06", 200, "misc"),
  ]);

  it("keeps the monthly total and moves the recorded part to its category", () => {
    const [summary] = summarizeActivityMonths(items, ["2026-09"], {});
    expect(summary!.spending).toBe(5000);
    expect(summary!.spendingByCategory).toEqual({ food: 300, misc: 4700 });
    expect(summary!.activityCount).toBe(3);
  });

  it("counts cash beyond the withdrawals as extra spending", () => {
    const [summary] = summarizeActivityMonths(
      allocateCashExpenses([
        withdrawal("w", "2026-09-03", 500),
        cash("c", "2026-09-05", 800),
      ]),
      ["2026-09"],
      {},
    );
    expect(summary!.spending).toBe(800);
    expect(summary!.spendingByCategory).toEqual({ food: 800 });
  });

  it("does not let advance withdrawals absorb cash expenses", () => {
    const [summary] = summarizeActivityMonths(
      allocateCashExpenses([
        withdrawal("w", "2026-09-03", 24000, {
          economicRole: "advance",
          advanceCounterparty: "朋友",
        }),
        cash("c", "2026-09-05", 300),
      ]),
      ["2026-09"],
      {},
    );
    expect(summary!.spending).toBe(300);
    expect(summary!.advanceAmount).toBe(24000);
  });

  it("lists spending entries with the unallocated withdrawal amount", () => {
    const entries = activitySpendingEntries(
      items.map((item) => ({ ...item, title: item.title })),
      {},
    );
    expect(
      entries.map(({ id, source, amount, categoryId }) => ({
        id,
        source,
        amount,
        categoryId,
      })),
    ).toEqual([
      { id: "w", source: "bank", amount: 4500, categoryId: "misc" },
      { id: "c-food", source: "cash", amount: 300, categoryId: "food" },
      { id: "c-misc", source: "cash", amount: 200, categoryId: "misc" },
    ]);
  });

  it("drops fully allocated withdrawals from spending entries", () => {
    const entries = activitySpendingEntries(
      allocateCashExpenses([
        withdrawal("w", "2026-09-03", 300),
        cash("c", "2026-09-05", 300),
      ]),
      {},
    );
    expect(entries.map((entry) => entry.id)).toEqual(["c"]);
  });
});
