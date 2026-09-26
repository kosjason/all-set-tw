import { fireEvent, render, screen, within } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import SpendingCategoryPie from "./SpendingCategoryPie.svelte";

const slices = [
  {
    categoryId: "food",
    category: "餐飲",
    amount: 6000,
    percentage: 60,
    color: "#2a78d6",
    emoji: "🍜",
  },
  {
    categoryId: "transport",
    category: "交通",
    amount: 4000,
    percentage: 40,
    color: "#eb6834",
    emoji: "🚇",
  },
];

describe("spending category pie", () => {
  it("lists every category with amount and share, and selects on click", async () => {
    const onSelect = vi.fn();
    render(SpendingCategoryPie, {
      slices,
      total: 10000,
      selectedCategoryId: "food",
      onSelect,
    });
    const legend = screen.getByRole("list", { name: "消費分類圖例" });
    const buttons = within(legend).getAllByRole("button");
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveTextContent("🍜 餐飲");
    expect(buttons[0]).toHaveTextContent("NT$6,000");
    expect(buttons[0]).toHaveTextContent("60%");
    expect(buttons[0]).toHaveAttribute("aria-pressed", "true");
    expect(buttons[1]).toHaveAttribute("aria-pressed", "false");

    await fireEvent.click(buttons[1]!);
    expect(onSelect).toHaveBeenCalledWith("transport");
  });

  it("shows placeholders when the summary is unavailable or empty", () => {
    const { unmount } = render(SpendingCategoryPie, {
      slices: [],
      total: 0,
      unavailable: true,
      onSelect: vi.fn(),
    });
    expect(screen.getByText("月收支摘要尚未載入。")).toBeInTheDocument();
    unmount();
    render(SpendingCategoryPie, { slices: [], total: 0, onSelect: vi.fn() });
    expect(screen.getByText("這個月還沒有消費。")).toBeInTheDocument();
  });
});
