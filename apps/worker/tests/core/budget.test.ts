import { describe, expect, it } from "vitest";
import {
  activitySpendingEntries,
  addDays,
  computeBudget,
  DEFAULT_BUDGET_SETTINGS,
  detectFixedCandidates,
  summarizeActivityMonths,
  summarizeWeek,
  weekStartOf,
  type SpendingEntry,
  type SummaryActivity,
} from "@taiwan-fin-hub/core";

type Item = Parameters<typeof activitySpendingEntries>[0][number];

function item(
  id: string,
  source: SummaryActivity["source"],
  date: string,
  amount: number,
  extra: Partial<Item> = {},
): Item {
  return {
    id,
    title: id,
    status: "posted",
    source,
    date,
    amount,
    currency: "TWD",
    categoryId: "food",
    economicRole: "spending",
    reviewStatus: "auto",
    duplicateOf: null,
    ...extra,
  };
}

function entry(
  day: string,
  amount: number,
  extra: Partial<SpendingEntry> = {},
): SpendingEntry {
  return {
    id: `${day}:${amount}:${extra.merchantKey ?? ""}`,
    source: "card",
    day,
    amount,
    categoryId: "food",
    displayName: extra.merchantKey ?? "商家",
    pending: false,
    ...extra,
  };
}

describe("activitySpendingEntries", () => {
  it("uses the same scope as the monthly spending total", () => {
    const items = [
      item("coffee", "card", "2026-09-03", -120, {
        merchantKey: "name:coffee",
      }),
      item("refund", "card", "2026-09-04", 20, {
        economicRole: "spending",
      }),
      item("invoice", "invoice", "2026-09-05", 300),
      item("dup", "invoice", "2026-09-03", 120, {
        duplicateOf: { kind: "bank_transaction", id: "coffee" },
      }),
      item("excluded", "card", "2026-09-06", -999, {
        economicRole: "excluded",
      }),
      item("salary", "bank", "2026-09-05", 50000, { economicRole: "income" }),
      item("usd", "card", "2026-09-07", -10, { currency: "USD" }),
      item("jpy", "card", "2026-09-07", -100, { currency: "JPY" }),
    ];
    const rates = { USD: 32 };
    const entries = activitySpendingEntries(items, rates);
    const [summary] = summarizeActivityMonths(items, ["2026-09"], rates);
    expect(entries.map((spending) => spending.id).sort()).toEqual(
      ["coffee", "invoice", "refund", "usd"].sort(),
    );
    expect(entries.reduce((sum, spending) => sum + spending.amount, 0)).toBe(
      summary!.spending,
    );
    expect(entries.find((spending) => spending.id === "refund")!.amount).toBe(
      -20,
    );
  });
});

describe("week helpers", () => {
  it("finds Monday of the week", () => {
    expect(weekStartOf("2026-09-28")).toBe("2026-09-28");
    expect(weekStartOf("2026-10-04")).toBe("2026-09-28");
    expect(weekStartOf("2026-10-01")).toBe("2026-09-28");
    expect(addDays("2026-09-28", -7)).toBe("2026-09-21");
  });
});

describe("summarizeWeek", () => {
  // 過去 8 週每週週一 100、週五 500；本週週一 400、週三 50，今天週三。
  const past = Array.from({ length: 8 }, (_, index) => {
    const monday = addDays("2026-09-28", -7 * (index + 1));
    return [
      entry(monday, 100, { merchantKey: "name:lunch" }),
      entry(addDays(monday, 4), 500, {
        merchantKey: "name:dinner",
        categoryId: "entertainment",
      }),
    ];
  }).flat();
  const current = [
    entry("2026-09-28", 400, { merchantKey: "name:lunch" }),
    entry("2026-09-30", 50, {
      merchantKey: "name:new-shop",
      categoryId: "shopping",
      pending: true,
    }),
  ];

  it("compares an in-progress week with the same days of past weeks", () => {
    const review = summarizeWeek([...past, ...current], {
      weekStart: "2026-09-28",
      today: "2026-09-30",
    });
    expect(review).toMatchObject({
      weekEnd: "2026-10-04",
      complete: false,
      elapsedDays: 3,
      total: 450,
      pendingAmount: 50,
      // 過去各週週一到週三只有 100，週五的 500 不算。
      baseline: { weeks: 8, median: 100 },
      difference: 350,
      possiblyIncompleteFrom: "2026-09-28",
    });
    expect(review.byDay.map((day) => day.amount)).toEqual([
      400, 0, 50, 0, 0, 0, 0,
    ]);
    expect(review.largest.map((largest) => largest.amount)).toEqual([400, 50]);
    expect(review.newMerchants).toEqual([
      {
        merchantKey: "name:new-shop",
        displayName: "name:new-shop",
        amount: 50,
        count: 1,
      },
    ]);
    expect(review.topCategoryIncreases[0]).toMatchObject({
      categoryId: "food",
      amount: 400,
      baseline: 100,
      delta: 300,
    });
  });

  it("compares a finished week with whole past weeks", () => {
    const review = summarizeWeek([...past, ...current], {
      weekStart: "2026-09-21",
      today: "2026-09-30",
    });
    expect(review).toMatchObject({
      complete: true,
      elapsedDays: 7,
      total: 600,
      baseline: { median: 600 },
      difference: 0,
      possiblyIncompleteFrom: null,
    });
  });
});

describe("detectFixedCandidates", () => {
  const months = ["2026-06", "2026-07", "2026-08"];
  const history = new Map(
    months.map((month, index) => [
      month,
      [
        entry(`${month}-05`, 15000, { merchantKey: "name:rent" }),
        entry(`${month}-10`, 390 + index * 10, { merchantKey: "name:netflix" }),
        entry(`${month}-12`, index === 1 ? 3000 : 800, {
          merchantKey: "name:grocery",
        }),
        ...(index === 2
          ? [entry(`${month}-20`, 500, { merchantKey: "name:once" })]
          : []),
        // 常去的店：每月金額穩定但筆數多，不是固定支出。
        ...[3, 13, 23].map((date) =>
          entry(`${month}-${String(date).padStart(2, "0")}`, 300, {
            merchantKey: "name:cafe",
          }),
        ),
        // 國外交易服務費這類小額費用不列入。
        entry(`${month}-11`, 12, { merchantKey: "name:fee" }),
      ],
    ]),
  );

  it("lists merchants charged every month with stable amounts", () => {
    const candidates = detectFixedCandidates(history, months, new Set());
    expect(candidates.map((candidate) => candidate.merchantKey)).toEqual([
      "name:rent",
      "name:netflix",
    ]);
    expect(candidates[1]).toMatchObject({
      monthlyAmounts: [390, 400, 410],
      typicalAmount: 400,
    });
  });

  it("skips merchants the user already decided", () => {
    expect(
      detectFixedCandidates(history, months, new Set(["name:rent"])).map(
        (candidate) => candidate.merchantKey,
      ),
    ).toEqual(["name:netflix"]);
  });
});

describe("computeBudget", () => {
  const months = ["2026-06", "2026-07", "2026-08"];
  const history = new Map(
    months.map((month) => [
      month,
      [entry(`${month}-05`, 15000, { merchantKey: "name:rent" })],
    ]),
  );
  const base = {
    month: "2026-09",
    today: "2026-09-21",
    historicalIncome: 160000,
    historyByMonth: history,
    historyMonths: months,
  };

  it("subtracts savings, reserve, spending and fixed costs not yet paid", () => {
    const budget = computeBudget({
      ...base,
      settings: {
        expectedIncome: 150000,
        savingsTargetType: "percent",
        savingsTargetValue: 20,
        annualReserve: 24000,
      },
      decisions: [
        {
          merchantKey: "name:rent",
          kind: "monthly",
          displayName: "房租",
          expectedAmount: null,
        },
        {
          merchantKey: "name:insurance",
          kind: "annual",
          displayName: "保險",
          expectedAmount: null,
        },
      ],
      currentEntries: [
        entry("2026-09-03", 10000),
        entry("2026-09-10", 36000, { merchantKey: "name:insurance" }),
      ],
    });
    expect(budget).toMatchObject({
      daysLeft: 10,
      expectedIncome: { amount: 150000, source: "settings" },
      savingsTarget: 30000,
      monthlyReserve: 2000,
      // 年繳保險由準備金支付，不扣本月可花。
      spent: 10000,
      spentFromReserve: 36000,
      spentFixed: 0,
      // 房租本月還沒扣款，依近 3 個月中位數預留。
      fixedRemaining: 15000,
      available: 150000 - 30000 - 2000 - 10000 - 15000,
      dailyAllowance: 9300,
    });
    expect(budget.fixedMerchants[0]).toMatchObject({
      merchantKey: "name:rent",
      expectedAmount: 15000,
      expectedAmountSource: "history",
      paidThisMonth: 0,
    });
    expect(budget.candidates).toEqual([]);
  });

  it("stops reserving a fixed cost once it has been paid", () => {
    const budget = computeBudget({
      ...base,
      settings: DEFAULT_BUDGET_SETTINGS,
      decisions: [
        {
          merchantKey: "name:rent",
          kind: "monthly",
          displayName: "房租",
          expectedAmount: 15000,
        },
      ],
      currentEntries: [
        entry("2026-09-05", 15000, { merchantKey: "name:rent" }),
      ],
    });
    expect(budget).toMatchObject({
      expectedIncome: { amount: 160000, source: "history" },
      spent: 15000,
      spentFixed: 15000,
      fixedRemaining: 0,
      available: 145000,
    });
  });

  it("cannot compute an amount without any income", () => {
    const budget = computeBudget({
      ...base,
      historicalIncome: null,
      settings: DEFAULT_BUDGET_SETTINGS,
      decisions: [],
      currentEntries: [],
    });
    expect(budget).toMatchObject({
      expectedIncome: { amount: null, source: "none" },
      available: null,
      dailyAllowance: null,
    });
    expect(budget.candidates.map((candidate) => candidate.merchantKey)).toEqual(
      ["name:rent"],
    );
  });
});
