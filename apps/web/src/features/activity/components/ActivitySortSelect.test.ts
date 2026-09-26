import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import ActivitySortSelect from "./ActivitySortSelect.svelte";

describe("activity sort select", () => {
  it("defaults to newest first and lists every sort mode", () => {
    render(ActivitySortSelect);
    const select = screen.getByRole("combobox", { name: "活動排序" });
    expect(select).toHaveValue("date-desc");
    expect(screen.getByText("排序")).toBeInTheDocument();
    expect(
      screen.getAllByRole("option").map((option) => option.textContent),
    ).toEqual([
      "日期（新→舊）",
      "日期（舊→新）",
      "金額（大→小）",
      "金額（小→大）",
    ]);
  });

  it("switches modes and reports the chosen mode", async () => {
    const onchange = vi.fn();
    render(ActivitySortSelect, { value: "date-desc", onchange });
    const select = screen.getByRole("combobox", { name: "活動排序" });
    await fireEvent.change(select, { target: { value: "amount-desc" } });
    expect(select).toHaveValue("amount-desc");
    expect(onchange).toHaveBeenLastCalledWith("amount-desc");
    await fireEvent.change(select, { target: { value: "date-asc" } });
    expect(onchange).toHaveBeenLastCalledWith("date-asc");
  });
});
