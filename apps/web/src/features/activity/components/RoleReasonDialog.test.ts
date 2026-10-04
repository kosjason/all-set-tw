import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import RoleReasonDialog from "./RoleReasonDialog.svelte";

describe("RoleReasonDialog", () => {
  it("requires a counterparty for advances and submits it normalized", async () => {
    const onSubmit = vi.fn();
    render(RoleReasonDialog, {
      props: {
        title: "虛構電信門市",
        roleLabel: "代墊（幫別人付，等對方還）",
        askCounterparty: true,
        counterpartySuggestions: ["Irene", "Bob"],
        onCancel: vi.fn(),
        onSubmit,
      },
    });
    const submit = screen.getByRole("button", { name: "確定" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    const input = screen.getByLabelText("對象（必填）");
    await fireEvent.input(input, { target: { value: "  Ｉrene  " } });
    expect((submit as HTMLButtonElement).disabled).toBe(false);
    await fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledWith("", "Irene");
    expect(
      [
        ...document.querySelectorAll("#role-counterparty-suggestions option"),
      ].map((option) => (option as HTMLOptionElement).value),
    ).toEqual(["Irene", "Bob"]);
  });

  it("prefills the current counterparty and keeps other roles unchanged", async () => {
    const onSubmit = vi.fn();
    const { unmount } = render(RoleReasonDialog, {
      props: {
        title: "轉帳存入",
        roleLabel: "收回代墊（對方還我的錢）",
        askCounterparty: true,
        counterparty: "Irene",
        onCancel: vi.fn(),
        onSubmit,
      },
    });
    expect(
      (screen.getByLabelText("對象（必填）") as HTMLInputElement).value,
    ).toBe("Irene");
    unmount();

    render(RoleReasonDialog, {
      props: {
        title: "跨行轉出",
        roleLabel: "轉到自己帳戶",
        onCancel: vi.fn(),
        onSubmit,
      },
    });
    expect(screen.queryByLabelText("對象（必填）")).toBeNull();
    await fireEvent.click(screen.getByRole("button", { name: "確定" }));
    expect(onSubmit).toHaveBeenLastCalledWith("");
  });
});
