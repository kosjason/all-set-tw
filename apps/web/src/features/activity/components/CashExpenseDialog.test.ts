import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import CashExpenseDialog from "./CashExpenseDialog.svelte";

const categoryOptions = [
  { id: "food", label: "餐飲", emoji: "🍜" },
  { id: "transport", label: "交通", emoji: "🚇" },
  { id: "misc", label: "其他", emoji: "📌" },
];

describe("CashExpenseDialog", () => {
  it("submits a new cash expense with a normalized amount", async () => {
    const onSubmit = vi.fn();
    render(CashExpenseDialog, {
      props: {
        categoryOptions,
        defaultDate: "2026-10-11",
        maxDate: "2026-10-11",
        onCancel: vi.fn(),
        onSubmit,
      },
    });
    const save = screen.getByRole("button", { name: "儲存" });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    const amount = screen.getByLabelText("金額");
    expect(document.activeElement).toBe(amount);
    await fireEvent.input(amount, { target: { value: "１,２００" } });
    // 沒選分類前不能送出。
    expect((save as HTMLButtonElement).disabled).toBe(true);
    await fireEvent.click(screen.getByRole("radio", { name: /交通/u }));
    await fireEvent.input(screen.getByLabelText("說明（選填）"), {
      target: { value: "  計程車 " },
    });
    expect((save as HTMLButtonElement).disabled).toBe(false);
    await fireEvent.click(save);
    expect(onSubmit).toHaveBeenCalledWith({
      date: "2026-10-11",
      amount: 1200,
      categoryId: "transport",
      description: "計程車",
    });
  });

  it("rejects invalid amounts and future dates", async () => {
    render(CashExpenseDialog, {
      props: {
        categoryOptions,
        defaultDate: "2026-10-11",
        maxDate: "2026-10-11",
        onCancel: vi.fn(),
        onSubmit: vi.fn(),
      },
    });
    const save = screen.getByRole("button", { name: "儲存" });
    await fireEvent.click(screen.getByRole("radio", { name: /餐飲/u }));
    await fireEvent.input(screen.getByLabelText("金額"), {
      target: { value: "12.5" },
    });
    expect(
      screen.getByText("請輸入 1 到 1,000 萬之間的整數金額。"),
    ).toBeTruthy();
    expect((save as HTMLButtonElement).disabled).toBe(true);
    await fireEvent.input(screen.getByLabelText("金額"), {
      target: { value: "120" },
    });
    expect((save as HTMLButtonElement).disabled).toBe(false);
    await fireEvent.input(screen.getByLabelText("日期"), {
      target: { value: "2026-10-12" },
    });
    expect((save as HTMLButtonElement).disabled).toBe(true);
  });

  it("prefills an existing expense and confirms before deleting", async () => {
    const onDelete = vi.fn();
    render(CashExpenseDialog, {
      props: {
        expense: {
          id: "c-1",
          date: "2026-09-05",
          amount: 300,
          categoryId: "food",
          description: "夜市",
        },
        categoryOptions,
        defaultDate: "2026-10-11",
        maxDate: "2026-10-11",
        onCancel: vi.fn(),
        onSubmit: vi.fn(),
        onDelete,
      },
    });
    expect(screen.getByRole("heading", { name: "編輯現金支出" })).toBeTruthy();
    expect((screen.getByLabelText("金額") as HTMLInputElement).value).toBe(
      "300",
    );
    expect(
      (screen.getByRole("radio", { name: /餐飲/u }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    await fireEvent.click(screen.getByRole("button", { name: "刪除" }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByText("刪除這筆現金支出？")).toBeTruthy();
    await fireEvent.click(screen.getByRole("button", { name: "刪除" }));
    expect(onDelete).toHaveBeenCalledOnce();
  });

  describe("常用", () => {
    const frequent = [
      {
        description: "鮮奶茶",
        amount: 35,
        categoryId: "food",
        uses: 3,
        lastDate: "2026-10-09",
      },
      {
        description: "計程車",
        amount: 200,
        categoryId: "transport",
        uses: 2,
        lastDate: "2026-09-21",
      },
    ];

    it("records a frequent expense with one tap on the chosen date", async () => {
      const onQuickAdd = vi.fn();
      const onSubmit = vi.fn();
      render(CashExpenseDialog, {
        props: {
          categoryOptions,
          defaultDate: "2026-10-11",
          maxDate: "2026-10-11",
          frequent,
          onCancel: vi.fn(),
          onSubmit,
          onQuickAdd,
        },
      });
      expect(screen.getByText("點一下直接記")).toBeTruthy();
      // 有常用時不自動聚焦金額（手機不會先跳出鍵盤）。
      expect(document.activeElement).not.toBe(
        screen.getByLabelText("或輸入金額"),
      );
      // 有常用時金額欄改叫「或輸入金額」。
      expect(screen.getByLabelText("或輸入金額")).toBeTruthy();
      await fireEvent.click(
        screen.getByRole("button", { name: "記一筆 鮮奶茶 NT$35" }),
      );
      expect(onQuickAdd).toHaveBeenCalledWith({
        date: "2026-10-11",
        amount: 35,
        categoryId: "food",
        description: "鮮奶茶",
      });
      expect(onSubmit).not.toHaveBeenCalled();

      await fireEvent.input(screen.getByLabelText("日期"), {
        target: { value: "2026-09-30" },
      });
      expect(screen.getByText("點一下直接記（記在 9/30）")).toBeTruthy();
      await fireEvent.click(
        screen.getByRole("button", { name: "記一筆 計程車 NT$200" }),
      );
      expect(onQuickAdd).toHaveBeenLastCalledWith({
        date: "2026-09-30",
        amount: 200,
        categoryId: "transport",
        description: "計程車",
      });
    });

    it("disables the chips while saving or for a future date", async () => {
      const onQuickAdd = vi.fn();
      render(CashExpenseDialog, {
        props: {
          categoryOptions,
          defaultDate: "2026-10-11",
          maxDate: "2026-10-11",
          frequent,
          submitting: true,
          onCancel: vi.fn(),
          onSubmit: vi.fn(),
          onQuickAdd,
        },
      });
      const chip = screen.getByRole("button", {
        name: "記一筆 鮮奶茶 NT$35",
      }) as HTMLButtonElement;
      expect(chip.disabled).toBe(true);
      await fireEvent.click(chip);
      expect(onQuickAdd).not.toHaveBeenCalled();
    });

    it("is hidden when editing or when nothing has been recorded", () => {
      const { unmount } = render(CashExpenseDialog, {
        props: {
          expense: {
            id: "c-1",
            date: "2026-09-05",
            amount: 35,
            categoryId: "food",
            description: "鮮奶茶",
          },
          categoryOptions,
          defaultDate: "2026-10-11",
          maxDate: "2026-10-11",
          frequent,
          onCancel: vi.fn(),
          onSubmit: vi.fn(),
          onQuickAdd: vi.fn(),
        },
      });
      expect(screen.queryByTestId("cash-expense-frequent")).toBeNull();
      unmount();
      render(CashExpenseDialog, {
        props: {
          categoryOptions,
          defaultDate: "2026-10-11",
          maxDate: "2026-10-11",
          frequent: [],
          onCancel: vi.fn(),
          onSubmit: vi.fn(),
          onQuickAdd: vi.fn(),
        },
      });
      expect(screen.queryByTestId("cash-expense-frequent")).toBeNull();
      expect(screen.getByLabelText("金額")).toBeTruthy();
    });
  });
});
