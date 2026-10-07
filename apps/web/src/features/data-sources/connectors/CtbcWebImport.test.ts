import { fireEvent, render, waitFor } from "@testing-library/svelte";
import { QueryClient, QueryClientProvider } from "@tanstack/svelte-query";
import { expect, it, vi } from "vitest";
import { ApiRequestError, type ApiClient } from "@/shared/api/client";
import { queryKeys } from "@/shared/api/query-keys";
import type { CtbcWebImportStatus } from "@/data/connectors/types";
import CtbcWebImport from "./CtbcWebImport.svelte";

function setup(
  statuses: CtbcWebImportStatus[],
  post = vi.fn().mockResolvedValue({ started: true, running: true }),
  demoMode = false,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
  });
  let request = 0;
  const api = {
    get: vi.fn((path: string) => {
      if (path !== "/api/connectors/ctbc/web-import")
        return Promise.resolve({});
      return Promise.resolve(
        statuses[Math.min(request++, statuses.length - 1)],
      );
    }),
    post,
  } as unknown as ApiClient;
  const view = render(
    CtbcWebImport,
    { props: { api, demoMode } },
    {
      wrapper: QueryClientProvider,
      wrapperProps: { client: queryClient },
    },
  );
  return { ...view, api, queryClient };
}

const idle: CtbcWebImportStatus = {
  available: true,
  running: false,
  last: { finishedAt: "2026-10-08 21:30:00", exitCode: 0 },
};

it("沒有設定觸發器時維持半自動匯入說明，不顯示按鈕", async () => {
  const { findByTestId, queryByRole } = setup([{ available: false }]);
  expect((await findByTestId("ctbc-import-only")).textContent).toContain(
    "半自動匯入",
  );
  expect(queryByRole("button")).toBeNull();
});

it("按下按鈕請 mini 開網銀視窗，並顯示登入步驟", async () => {
  const { findByRole, findByTestId, api } = setup([
    idle,
    { ...idle, running: true },
  ]);
  await fireEvent.click(
    await findByRole("button", { name: "在 mini 開啟網銀匯入" }),
  );
  expect(api.post).toHaveBeenCalledWith("/api/connectors/ctbc/web-import");
  expect((await findByTestId("ctbc-web-import-running")).textContent).toContain(
    "30 分鐘內登入",
  );
  expect(
    ((await findByRole("button", { name: "匯入進行中…" })) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});

it("上次匯入沒有完成時提示可以再開一次", async () => {
  const { findByText } = setup([
    {
      available: true,
      running: false,
      last: { finishedAt: "2026-10-08 21:30:00", exitCode: 1 },
    },
  ]);
  expect(
    await findByText(/上次網銀匯入沒有完成（2026-10-08 21:30:00）/),
  ).toBeTruthy();
});

it("觸發器失敗時顯示錯誤", async () => {
  const post = vi
    .fn()
    .mockRejectedValue(
      new ApiRequestError(
        "CTBC_WEB_IMPORT_UNAVAILABLE",
        "無法連到 mini 上的中信匯入觸發器，請稍後再試。",
        502,
      ),
    );
  const { findByRole } = setup([idle], post);
  await fireEvent.click(
    await findByRole("button", { name: "在 mini 開啟網銀匯入" }),
  );
  expect((await findByRole("alert")).textContent).toContain("mini");
});

it("Demo 模式不能啟動匯入", async () => {
  const { findByRole } = setup([idle], undefined, true);
  expect(
    (
      (await findByRole("button", {
        name: "在 mini 開啟網銀匯入",
      })) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});

it("匯入結束後重新讀取同步狀態與帳務資料", async () => {
  const { findByRole, queryClient } = setup([{ ...idle, running: true }, idle]);
  await findByRole("button", { name: "匯入進行中…" });
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  await queryClient.refetchQueries({ queryKey: queryKeys.ctbcWebImport });
  await findByRole("button", { name: "在 mini 開啟網銀匯入" });
  await waitFor(() =>
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.syncJobs }),
  );
  expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.bank });
});
