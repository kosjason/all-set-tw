import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ActivityNoteField from "./ActivityNoteField.svelte";

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
});

function renderField(
  note: string | null = null,
  onSave = vi.fn().mockResolvedValue(undefined),
) {
  const view = render(ActivityNoteField, {
    note,
    onSave,
    label: "星巴克",
  });
  const field = screen.getByRole("textbox", { name: "星巴克 的備註" });
  return { onSave, field, ...view };
}

describe("activity note field", () => {
  it("autosaves 800ms after typing stops and shows 已儲存", async () => {
    const { onSave, field } = renderField();
    await fireEvent.input(field, { target: { value: "請客" } });
    await vi.advanceTimersByTimeAsync(500);
    await fireEvent.input(field, { target: { value: "請客，朋友生日 " } });
    await vi.advanceTimersByTimeAsync(799);
    expect(onSave).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith("請客，朋友生日");
    await waitFor(() => expect(screen.getByText("已儲存")).toBeInTheDocument());
  });

  it("saves on blur without waiting and skips unchanged text", async () => {
    const { onSave, field } = renderField("代墊");
    expect(field).toHaveValue("代墊");
    await fireEvent.blur(field);
    expect(onSave).not.toHaveBeenCalled();
    await fireEvent.input(field, { target: { value: "代墊，下週還" } });
    await fireEvent.blur(field);
    expect(onSave).toHaveBeenCalledWith("代墊，下週還");
    await vi.advanceTimersByTimeAsync(1000);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("deletes the note when cleared", async () => {
    const { onSave, field } = renderField("代墊");
    await fireEvent.input(field, { target: { value: "   " } });
    await fireEvent.blur(field);
    expect(onSave).toHaveBeenCalledWith("");
  });

  it("shows an error when saving fails and retries on the next edit", async () => {
    const onSave = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(undefined);
    const { field } = renderField(null, onSave);
    await fireEvent.input(field, { target: { value: "測試" } });
    await fireEvent.blur(field);
    await waitFor(() =>
      expect(screen.getByText("無法儲存，請稍後再試")).toBeInTheDocument(),
    );
    await fireEvent.blur(field);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText("已儲存")).toBeInTheDocument());
  });

  it("flushes a pending edit when the drawer closes", async () => {
    const { onSave, field, unmount } = renderField();
    await fireEvent.input(field, { target: { value: "未實際扣款" } });
    unmount();
    expect(onSave).toHaveBeenCalledWith("未實際扣款");
  });

  it("limits the note to 1000 characters", () => {
    const { field } = renderField();
    expect(field).toHaveAttribute("maxlength", "1000");
    expect(screen.getByText("0/1000")).toBeInTheDocument();
  });
});
