<script lang="ts">
  import {
    createMutation,
    createQuery,
    useQueryClient,
  } from "@tanstack/svelte-query";
  import { MonitorUp } from "@lucide/svelte";
  import Button from "@/shared/ui/Button.svelte";
  import { messageFromError, type ApiClient } from "@/shared/api/client";
  import { queryKeys } from "@/shared/api/query-keys";
  import { ctbcWebImportQuery } from "@/data/connectors/queries";
  import type {
    CtbcWebImportStart,
    CtbcWebImportStatus,
  } from "@/data/connectors/types";

  // fork 自架：中信會擋自動登入，只能在 mini 開網銀視窗讓使用者登入後匯入。
  let { api, demoMode }: { api: ApiClient; demoMode: boolean } = $props();
  const qc = useQueryClient();
  const status = createQuery(ctbcWebImportQuery(() => api));
  let error = $state("");
  const RUNNING_HINT =
    "mini 上已開好中信網銀視窗：請在 30 分鐘內登入。登入後不用再點任何地方，工具會自動匯入信用卡帳單、未出帳與即時消費；完成前請勿操作視窗，完成會發 TG 通知。";

  const start = createMutation({
    mutationFn: () =>
      // 送 JSON body：後端要求 application/json，跨站表單無法觸發。
      api.post<CtbcWebImportStart>("/api/connectors/ctbc/web-import", {}),
    onMutate: async () => {
      error = "";
      // 先取消進行中的狀態查詢，避免較早發出的「未執行」結果蓋掉下方的樂觀更新。
      await qc.cancelQueries({ queryKey: queryKeys.ctbcWebImport });
    },
    onSuccess: (result) => {
      // 先標成執行中讓輪詢立即開始，之後以觸發器回報的狀態為準。
      qc.setQueryData<CtbcWebImportStatus>(
        queryKeys.ctbcWebImport,
        (previous) => ({
          available: true,
          running: result.running,
          last: previous?.available ? previous.last : null,
        }),
      );
    },
    onError: (cause) => {
      error = messageFromError(cause);
    },
  });

  const current = $derived($status.data?.available ? $status.data : undefined);
  const running = $derived(current?.running === true);
</script>

{#if current}
  <Button
    size="sm"
    disabled={demoMode || running || $start.isPending}
    onclick={() => $start.mutate()}
    ><MonitorUp class="size-4" />{running
      ? "匯入進行中…"
      : $start.isPending
        ? "啟動中…"
        : "在 mini 開啟網銀匯入"}</Button
  >
  {#if running}
    <p
      class="basis-full text-sm text-muted-foreground"
      role="status"
      data-testid="ctbc-web-import-running"
    >
      {RUNNING_HINT}
    </p>
  {/if}
  {#if $status.isError}
    <!-- 輪詢失敗時保留上次狀態（避免重複啟動），但要讓使用者知道狀態未確認。 -->
    <p class="basis-full text-sm text-muted-foreground">
      {running
        ? "目前無法確認 mini 的匯入狀態，正在重試。"
        : "目前無法確認 mini 的匯入狀態。"}
    </p>
  {:else if !running && current.last && current.last.exitCode !== 0}
    <p class="basis-full text-sm text-muted-foreground">
      上次網銀匯入沒有完成（{current.last.finishedAt}），可以再開一次。
    </p>
  {/if}
{:else}
  <!-- 中信會擋自動登入（App 回 0131、網銀防機器人），只提供網銀半自動匯入。 -->
  <span class="text-sm text-muted-foreground" data-testid="ctbc-import-only"
    >中信不支援自動同步，請用網銀半自動匯入{$status.isError
      ? "（目前連不到 mini 的匯入觸發器）"
      : ""}</span
  >
{/if}
{#if error}
  <p class="basis-full text-sm font-medium text-coral" role="alert">{error}</p>
{/if}
