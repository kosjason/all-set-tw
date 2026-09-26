import { fireEvent, render, screen, within } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import CashFlowSummary from "./CashFlowSummary.svelte";
import {
  activitySummaryEquation,
  activitySummaryExcludedParts,
  activitySummaryIncompleteLabels,
} from "@/data/activity/summary";
import { summaryFixture } from "@/testing/activity-summary";

const september = summaryFixture("2026-09", {
  income: 162200,
  spending: 111690,
  investment: 41663,
  saved: 50510,
  ownTransfer: 20000,
  cardPayment: 15000,
  duplicateExcluded: 420,
  needsReview: { count: 2, amount: 3500 },
  activityCount: 12,
});

describe("cash flow summary", () => {
  it("shows income − spending ＝ saved, then where the saved money went", () => {
    render(CashFlowSummary, {
      title: "9 月收支",
      equation: activitySummaryEquation(september),
      excluded: activitySummaryExcludedParts(september),
      review: september.needsReview,
    });
    const region = screen.getByRole("region", { name: "9 月收支" });
    expect(
      within(region)
        .getAllByRole("term")
        .map((term) => term.textContent?.trim()),
    ).toEqual(["收入", "消費", "存下來"]);
    expect(screen.getByTestId("cash-flow-income")).toHaveTextContent(
      "NT$162,200",
    );
    expect(screen.getByTestId("cash-flow-spending")).toHaveTextContent(
      "NT$111,690",
    );
    const saved = screen.getByTestId("cash-flow-saved");
    expect(saved).toHaveTextContent("NT$50,510");
    expect(saved).toHaveClass("text-moss");
    // 算式符號保留：收入 − 消費 ＝ 存下來。
    expect(region.querySelector("dl")?.textContent?.replace(/\s+/g, "")).toBe(
      "收入NT$162,200−消費NT$111,690＝存下來NT$50,510",
    );
    // 投資不是與收入、消費並列的一格，而是存下來的去向。
    expect(
      screen
        .getByTestId("cash-flow-destination")
        .textContent?.replace(/\s+/g, ""),
    ).toBe("其中投資NT$41,663／留在帳戶NT$8,847");
    expect(region).toHaveTextContent("投資是存下來的錢的去向，不是消費");
    expect(region).toHaveTextContent(
      "轉到自己帳戶（例如轉到交割帳戶）不算投資，實際扣款買進才算",
    );
    expect(region).toHaveTextContent(
      "另有 轉到自己帳戶 NT$20,000、繳卡費 NT$15,000、重複發票 NT$420 未計入",
    );
  });

  it("computes money kept in accounts as saved minus investment", () => {
    expect(activitySummaryEquation(september)).toEqual({
      income: 162200,
      spending: 111690,
      saved: 50510,
      investment: 41663,
      keptInAccounts: 8847,
    });
    expect(activitySummaryEquation(undefined).keptInAccounts).toBeNull();
  });

  it("says 動用存款 when investment exceeds what was saved", () => {
    render(CashFlowSummary, {
      title: "9 月收支",
      equation: activitySummaryEquation(
        summaryFixture("2026-09", {
          income: 50000,
          spending: 30000,
          saved: 20000,
          investment: 26000,
        }),
      ),
    });
    const destination = screen.getByTestId("cash-flow-destination");
    expect(destination.textContent?.replace(/\s+/g, "")).toBe(
      "其中投資NT$26,000／動用存款NT$6,000",
    );
    expect(screen.getByTestId("cash-flow-saved")).toHaveClass("text-moss");
  });

  it("labels a negative month as 超支 in coral", () => {
    render(CashFlowSummary, {
      title: "9 月收支",
      equation: activitySummaryEquation(
        summaryFixture("2026-09", {
          income: 1000,
          spending: 3000,
          saved: -2000,
        }),
      ),
    });
    const region = screen.getByRole("region", { name: "9 月收支" });
    expect(region.querySelector("dl")?.textContent?.replace(/\s+/g, "")).toBe(
      "收入NT$1,000−消費NT$3,000＝超支NT$2,000",
    );
    expect(screen.getByTestId("cash-flow-saved")).toHaveClass("text-coral");
    expect(
      screen
        .getByTestId("cash-flow-destination")
        .textContent?.replace(/\s+/g, ""),
    ).toBe("投資NT$0／動用存款NT$2,000");
  });

  it("links the needs-review count to the review filter", async () => {
    const onShowReview = vi.fn();
    render(CashFlowSummary, {
      title: "9 月收支",
      equation: activitySummaryEquation(september),
      review: september.needsReview,
      onShowReview,
    });
    await fireEvent.click(
      screen.getByRole("button", { name: "2 筆待確認（金額 NT$3,500）" }),
    );
    expect(onShowReview).toHaveBeenCalledOnce();
  });

  it("shows why the data is incomplete in Chinese", () => {
    const incomplete = summaryFixture("2026-09", {
      income: 100,
      saved: 100,
      complete: false,
      incompleteReasons: ["missing_exchange_rates", "own_accounts_unavailable"],
      missingCurrencies: ["JPY", "USD"],
    });
    render(CashFlowSummary, {
      title: "9 月收支",
      equation: activitySummaryEquation(incomplete),
      incompleteReasons: activitySummaryIncompleteLabels(incomplete),
    });
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("資料不完整");
    expect(status).toHaveTextContent("缺少 JPY、USD 匯率，這些外幣未計入");
    expect(status).toHaveTextContent(
      "「我的其他帳戶」無法載入，互轉可能被算進收支",
    );
    expect(screen.getByTestId("cash-flow-income")).toHaveTextContent("NT$100");
  });

  it("hides totals while the summary is unavailable", () => {
    render(CashFlowSummary, {
      title: "9 月收支",
      equation: activitySummaryEquation(undefined),
      unavailable: true,
      review: september.needsReview,
    });
    expect(screen.getAllByText("—")).toHaveLength(5);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("summary view model", () => {
  it("omits zero exclusions and returns nothing for a complete summary", () => {
    expect(
      activitySummaryExcludedParts(
        summaryFixture("2026-09", { cardPayment: 500 }),
      ),
    ).toEqual([{ key: "cardPayment", label: "繳卡費", amount: 500 }]);
    expect(activitySummaryExcludedParts(undefined)).toEqual([]);
    expect(activitySummaryIncompleteLabels(summaryFixture("2026-09"))).toEqual(
      [],
    );
  });
});
