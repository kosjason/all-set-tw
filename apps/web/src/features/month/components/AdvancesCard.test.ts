import { render, screen, within } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import type { AdvancesResponse } from "@/data/advances/queries";
import AdvancesCard from "./AdvancesCard.svelte";

function advances(
  counterparties: AdvancesResponse["counterparties"],
): AdvancesResponse {
  return {
    since: "2026-08",
    counterparties,
    outstanding: {},
    complete: true,
    incompleteReasons: [],
  };
}

describe("AdvancesCard", () => {
  it("lists who still owes money and who paid extra", () => {
    render(AdvancesCard, {
      props: {
        advances: advances([
          {
            name: "Bob",
            balances: { TWD: 1200 },
            advanced: { TWD: 1200 },
            reimbursed: {},
            lastDay: "2026-10-01",
            entries: [
              {
                id: "a",
                source: "card",
                day: "2026-10-01",
                role: "advance",
                displayName: "虛構餐廳",
                currency: "TWD",
                amount: -1200,
                receivableDelta: 1200,
                pending: true,
              },
            ],
          },
          {
            name: "Irene",
            balances: { TWD: -220 },
            advanced: { TWD: 31300 },
            reimbursed: { TWD: 31520 },
            lastDay: "2026-09-29",
            entries: [],
          },
          {
            name: "Cara",
            balances: { TWD: 0 },
            advanced: { TWD: 500 },
            reimbursed: { TWD: 500 },
            lastDay: "2026-08-01",
            entries: [],
          },
        ]),
      },
    });

    const card = screen.getByTestId("month-advances");
    expect(screen.getByTestId("advances-owed").textContent).toContain("1,200");
    expect(card.textContent).toContain("2 人還沒結清");
    expect(card.textContent).toContain("有人多給");
    expect(within(card).getByText("Bob")).toBeTruthy();
    expect(card.textContent).toContain("還欠");
    expect(card.textContent).toContain("多給");
    expect(card.textContent).toContain("已結清 1 人");
    expect(card.textContent).toContain("（待入帳）");
    expect(within(card).queryByText("Cara")).toBeNull();
  });
});

it("shows foreign-currency balances when nothing is owed in TWD", () => {
  render(AdvancesCard, {
    props: {
      advances: advances([
        {
          name: "Dana",
          balances: { USD: 25 },
          advanced: { USD: 25 },
          reimbursed: {},
          lastDay: "2026-09-01",
          entries: [],
        },
      ]),
    },
  });
  expect(screen.getByTestId("advances-owed").textContent).toContain("USD 25");
});
