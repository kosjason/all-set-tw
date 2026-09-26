import { fireEvent, render, screen, within } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import AppSidebar from "./AppSidebar.svelte";
import MobileTabBar from "./MobileTabBar.svelte";
import MoreMenu from "./MoreMenu.svelte";

describe("desktop sidebar", () => {
  it("puts 待處理 on top, the five pages in the middle and 設定 at the bottom", async () => {
    const navigate = vi.fn();
    render(AppSidebar, {
      activeView: "transactions",
      inboxCounts: { blocking: 1, tidy: 4 },
      navigate,
    });
    const sidebar = screen.getByRole("complementary", { name: "側欄" });
    const buttons = within(sidebar)
      .getAllByRole("button")
      .map((button) => button.textContent?.replace(/\s+/g, ""));
    expect(buttons).toEqual([
      "待處理4",
      "本月",
      "交易",
      "信用卡",
      "資產",
      "資料來源",
      "設定",
    ]);
    const inbox = within(sidebar).getByRole("button", {
      name: "待處理（1 件需要處理、4 件待整理）",
    });
    expect(within(inbox).getByTestId("inbox-badge-blocking")).toBeVisible();
    expect(within(inbox).getByTestId("inbox-badge-tidy")).toHaveTextContent(
      "4",
    );
    expect(
      within(sidebar).getByRole("button", { name: "交易" }),
    ).toHaveAttribute("aria-current", "page");
    await fireEvent.click(
      within(sidebar).getByRole("button", { name: "設定" }),
    );
    expect(navigate).toHaveBeenCalledWith("settings");
  });

  it("hides the badge when nothing is pending", () => {
    render(AppSidebar, {
      activeView: "month",
      inboxCounts: { blocking: 0, tidy: 0 },
      navigate: vi.fn(),
    });
    expect(screen.queryByTestId("inbox-badge")).toBeNull();
    expect(screen.getByRole("button", { name: "待處理" })).toBeVisible();
  });

  it("shows only the red dot when there are blocking items but nothing to tidy", () => {
    render(AppSidebar, {
      activeView: "month",
      inboxCounts: { blocking: 2, tidy: 0 },
      navigate: vi.fn(),
    });
    expect(screen.getByTestId("inbox-badge-blocking")).toBeVisible();
    expect(screen.queryByTestId("inbox-badge-tidy")).toBeNull();
  });
});

describe("mobile tab bar", () => {
  it("shows 本月｜交易｜信用卡｜資產｜更多 and marks 更多 for pages inside it", async () => {
    const navigate = vi.fn();
    render(MobileTabBar, {
      activeView: "data-sources",
      inboxCounts: { blocking: 1, tidy: 0 },
      navigate,
    });
    const nav = screen.getByRole("navigation", { name: "主要導覽" });
    expect(
      within(nav)
        .getAllByRole("button")
        .map((button) => button.textContent?.trim()),
    ).toEqual(["本月", "交易", "信用卡", "資產", "更多"]);
    expect(within(nav).getByRole("button", { name: "更多" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await fireEvent.click(within(nav).getByRole("button", { name: "信用卡" }));
    expect(navigate).toHaveBeenCalledWith("cards");
  });
});

describe("more menu", () => {
  it("lists 資料來源, 待處理 with its badge and 設定", async () => {
    const navigate = vi.fn();
    render(MoreMenu, {
      inboxCounts: { blocking: 0, tidy: 3 },
      navigate,
    });
    const menu = screen.getByRole("navigation", { name: "更多功能" });
    const inbox = within(menu).getByRole("button", {
      name: "待處理（3 件待整理）",
    });
    expect(within(inbox).getByTestId("inbox-badge-tidy")).toHaveTextContent(
      "3",
    );
    await fireEvent.click(inbox);
    expect(navigate).toHaveBeenCalledWith("inbox");
    await fireEvent.click(
      within(menu).getByRole("button", { name: /資料來源/ }),
    );
    expect(navigate).toHaveBeenLastCalledWith("data-sources");
  });
});
