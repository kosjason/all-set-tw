import { render, screen } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import NetWorthHistoryChart from "./NetWorthHistoryChart.svelte";
import type { NetWorthHistoryRow } from "@/data/assets/types";

function recentDate(daysAgo: number) {
  const value = new Date();
  value.setDate(value.getDate() - daysAgo);
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${value.getFullYear()}-${month}-${day}`;
}

describe("NetWorthHistoryChart", () => {
  it("explains a single data point instead of rendering an empty chart", () => {
    render(NetWorthHistoryChart, {
      data: [
        {
          date: recentDate(0),
          netWorth: 1000,
          assetType: "deposit",
          source: "bank",
        },
      ],
    });
    expect(
      screen.getByText("資料累積中，至少需要兩天的快照才會顯示走勢。"),
    ).toBeTruthy();
    expect(
      screen.getByText("目前走勢僅含銀行存款，尚未包含投資部位。"),
    ).toBeTruthy();
  });

  it("labels deposit balances derived from transaction history", () => {
    const rows: NetWorthHistoryRow[] = [2, 1, 0].map((daysAgo) => ({
      date: recentDate(daysAgo),
      netWorth: 1000 + daysAgo,
      assetType: "deposit",
      source: "bank",
      ...(daysAgo > 0 ? { derived: true } : {}),
    }));
    render(NetWorthHistoryChart, { data: rows });
    const today = new Date();
    const label = `${today.getMonth() + 1}/${today.getDate()}`;
    const notes = screen.getByTestId("net-worth-chart-notes");
    expect(notes.textContent).toContain(
      `${label} 以前的存款餘額由交易明細推算`,
    );
    expect(notes.textContent).toContain("目前走勢僅含銀行存款");
  });
});
