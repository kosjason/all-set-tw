import { fireEvent, render, screen, within } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import ActivityToolbar, {
  type ActivityToolbarProps,
} from "./ActivityToolbar.svelte";
import { defaultActivityViewState } from "../model/url-state";
import { activityFilterChips } from "../model/view-filters";

const categories = [
  { id: "food", label: "餐飲" },
  { id: "other", label: "未分類" },
];

function renderToolbar(props: Partial<ActivityToolbarProps> = {}) {
  const handlers = {
    onSearchInput: vi.fn(),
    onSearchSubmit: vi.fn(),
    onSearchClear: vi.fn(),
    onSelectMonth: vi.fn(),
    onChange: vi.fn(),
    onClearChip: vi.fn(),
    onClearAll: vi.fn(),
  };
  render(ActivityToolbar, {
    searching: false,
    searchValue: "",
    months: ["2026-09", "2026-08"],
    selectedMonth: "2026-09",
    view: defaultActivityViewState(),
    categories,
    chips: [],
    ...handlers,
    ...props,
  });
  return handlers;
}

describe("activity toolbar", () => {
  it("keeps month, role, needs-review, filters and sort in one group", () => {
    renderToolbar();
    const group = screen.getByRole("group", { name: "活動篩選與排序" });
    for (const name of ["選擇活動月份", "活動角色", "活動排序"])
      expect(within(group).getByRole("combobox", { name })).toBeInTheDocument();
    expect(within(group).getByText("排序")).toBeInTheDocument();
    expect(
      within(group).getByRole("button", { name: "只看待確認" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(within(group).getByRole("button", { name: "篩選" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    // 次要篩選收在「篩選」裡，工具列上不直接出現。
    expect(screen.queryByRole("combobox", { name: "活動分類" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "活動來源" })).toBeNull();
    expect(screen.getByRole("searchbox", { name: "搜尋活動" })).toBeVisible();
  });

  it("keeps the desktop toolbar on one line with a search box of at least 240px", () => {
    renderToolbar();
    // lg（1024px）以上：整列不換行，搜尋框吃掉剩餘空間且至少 15rem（240px），
    // 其餘控制項不縮小；次要篩選已收進 popover，1440px 內容寬度放得下。
    expect(screen.getByTestId("activity-toolbar-row")).toHaveClass(
      "lg:flex-row",
      "lg:flex-nowrap",
    );
    expect(screen.getByTestId("activity-search-form")).toHaveClass(
      "lg:min-w-60",
      "lg:flex-1",
    );
    expect(screen.getByTestId("activity-toolbar-controls")).toHaveClass(
      "lg:flex-nowrap",
      "lg:shrink-0",
    );
  });

  it("offers the economic roles as the role filter", () => {
    renderToolbar();
    const role = screen.getByRole("combobox", { name: "活動角色" });
    expect(
      within(role)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual([
      "全部角色",
      "消費",
      "收入",
      "投資",
      "轉到自己帳戶",
      "繳卡費",
      "不計入",
    ]);
  });

  it("reports role, month, sort and secondary filter changes", async () => {
    const handlers = renderToolbar();
    await fireEvent.change(screen.getByRole("combobox", { name: "活動角色" }), {
      target: { value: "own_transfer" },
    });
    expect(handlers.onChange).toHaveBeenLastCalledWith({
      role: "own_transfer",
      slice: null,
    });
    await fireEvent.click(screen.getByRole("button", { name: "只看待確認" }));
    expect(handlers.onChange).toHaveBeenLastCalledWith({ review: true });
    await fireEvent.change(screen.getByRole("combobox", { name: "活動排序" }), {
      target: { value: "amount-desc" },
    });
    expect(handlers.onChange).toHaveBeenLastCalledWith({
      sort: "amount-desc",
    });
    await fireEvent.change(
      screen.getByRole("combobox", { name: "選擇活動月份" }),
      { target: { value: "2026-08" } },
    );
    expect(handlers.onSelectMonth).toHaveBeenCalledWith("2026-08");

    await fireEvent.click(screen.getByRole("button", { name: "篩選" }));
    const panel = screen.getByRole("dialog", { name: "活動篩選" });
    await fireEvent.change(
      within(panel).getByRole("combobox", { name: "活動分類" }),
      { target: { value: "food" } },
    );
    expect(handlers.onChange).toHaveBeenLastCalledWith({ categoryId: "food" });
    await fireEvent.click(
      within(panel).getByRole("button", { name: "只看未分類" }),
    );
    expect(handlers.onChange).toHaveBeenLastCalledWith({
      uncategorized: true,
    });
    await fireEvent.click(
      within(panel).getByRole("button", { name: "查看結果" }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("submits a full-history search and clears it", async () => {
    const handlers = renderToolbar({ searchValue: "咖啡" });
    const input = screen.getByRole("searchbox", { name: "搜尋活動" });
    await fireEvent.input(input, { target: { value: "咖啡店" } });
    expect(handlers.onSearchInput).toHaveBeenLastCalledWith("咖啡店");
    await fireEvent.click(screen.getByRole("button", { name: "搜尋" }));
    expect(handlers.onSearchSubmit).toHaveBeenCalled();
    await fireEvent.click(
      screen.getByRole("button", { name: "清空搜尋，返回月報" }),
    );
    expect(handlers.onSearchClear).toHaveBeenCalled();
  });

  it("shows applied filters as clearable chips", async () => {
    const view = {
      ...defaultActivityViewState(),
      role: "spending" as const,
      categoryId: "food",
      uncategorized: true,
    };
    const chips = activityFilterChips(view, {
      searching: false,
      text: "",
      categoryLabel: (id) => categories.find((c) => c.id === id)?.label,
    });
    const handlers = renderToolbar({ view, chips });
    const applied = screen.getByRole("group", { name: "已套用的篩選" });
    expect(
      within(applied)
        .getAllByRole("button")
        .map((button) => button.textContent?.trim()),
    ).toEqual(["消費", "分類：餐飲", "未分類", "清除全部"]);
    await fireEvent.click(
      within(applied).getByRole("button", { name: "清除篩選：分類：餐飲" }),
    );
    expect(handlers.onClearChip).toHaveBeenCalledWith("category");
    await fireEvent.click(
      within(applied).getByRole("button", { name: "清除全部" }),
    );
    expect(handlers.onClearAll).toHaveBeenCalled();
    // 分類與未分類收在「篩選」裡，按鈕上顯示套用數。
    expect(screen.getByRole("button", { name: /^篩選/ })).toHaveTextContent(
      "篩選2",
    );
  });

  it("moves the search range into the filters panel while searching", async () => {
    const handlers = renderToolbar({
      searching: true,
      searchValue: "airbnb",
      view: { ...defaultActivityViewState(), query: "airbnb", time: "custom" },
      invalidDates: true,
    });
    expect(screen.queryByRole("combobox", { name: "選擇活動月份" })).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "開始日期不得晚於結束日期",
    );
    await fireEvent.click(screen.getByRole("button", { name: /^篩選/ }));
    await fireEvent.input(screen.getByLabelText("搜尋開始日期"), {
      target: { value: "2024-06-15" },
    });
    expect(handlers.onChange).toHaveBeenLastCalledWith({ from: "2024-06-15" });
  });
});
