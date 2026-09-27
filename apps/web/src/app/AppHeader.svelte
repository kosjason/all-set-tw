<!--
  頁首：頁面標題與說明（子頁顯示「← 返回…」）；md 以上有全域搜尋（Enter 開啟交易頁搜尋）與
  同步狀態；xl 以上有待處理與右側概況欄開關。手機保留待處理與隱藏金額。
-->
<script lang="ts">
  import {
    Eye,
    EyeOff,
    Inbox,
    PanelRight,
    RefreshCw,
    Search,
  } from "@lucide/svelte";
  import { formatDateTime } from "@/shared/format/financial";
  import { moneyState } from "@/shared/state/money-visibility.svelte";
  import InboxBadge from "./InboxBadge.svelte";
  import { inboxAccessibleLabel, type InboxCounts } from "./navigation-config";
  import type { SyncOverview } from "./shell-status";
  import type { Navigate, View } from "./types";

  let {
    view,
    title,
    description,
    backLabel,
    onBack,
    inboxCounts,
    sync,
    panelOpen,
    onTogglePanel,
    onToggleMoney,
    navigate,
    height = $bindable(0),
  }: {
    view: View;
    title: string;
    description?: string;
    backLabel?: string;
    onBack?: () => void;
    inboxCounts: InboxCounts;
    sync?: SyncOverview;
    panelOpen: boolean;
    onTogglePanel: () => void;
    onToggleMoney: () => void;
    navigate: Navigate;
    height?: number;
  } = $props();

  let search = $state("");

  function submitSearch(event: SubmitEvent) {
    event.preventDefault();
    const query = search.trim();
    navigate(
      "transactions",
      query ? { query: new URLSearchParams({ q: query }).toString() } : {},
    );
    search = "";
  }

  const syncLabel = $derived.by(() => {
    if (!sync) return "讀取同步狀態…";
    if (sync.running) return "同步中";
    if (sync.attention) return `${sync.attention} 個來源需處理`;
    return sync.lastSuccessAt
      ? `同步於 ${formatDateTime(sync.lastSuccessAt)}`
      : "尚未同步";
  });
  const syncTone = $derived(
    sync?.attention
      ? "border-coral/30 bg-coral/5 text-coral"
      : "border-ink/10 bg-card text-subtle",
  );
</script>

<header
  bind:offsetHeight={height}
  class="sticky top-0 z-20 border-b border-ink/10 bg-paper/95 backdrop-blur-sm"
>
  <div
    class="flex min-w-0 items-center justify-between gap-3 px-4 py-4 sm:px-6 xl:px-8 xl:py-3"
  >
    <div class="min-w-0">
      {#if backLabel && onBack}
        <button
          type="button"
          class="mb-0.5 inline-flex items-center gap-1 text-xs font-medium text-steel"
          onclick={onBack}>← 返回{backLabel}</button
        >
      {/if}
      <h1 class="truncate text-2xl font-semibold tracking-tight xl:text-xl">
        {title}
      </h1>
      {#if description}
        <p class="mt-0.5 hidden truncate text-caption text-subtle md:block">
          {description}
        </p>
      {/if}
    </div>

    <div class="flex shrink-0 items-center gap-2">
      <form
        role="search"
        class="relative hidden md:block"
        onsubmit={submitSearch}
      >
        <Search
          class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle"
        />
        <input
          type="search"
          aria-label="搜尋交易"
          placeholder="搜尋交易、商家、品項"
          class="h-10 w-56 rounded-lg border border-ink/10 bg-card pr-3 pl-9 text-sm outline-none transition focus:border-steel/50 focus:ring-2 focus:ring-steel/15 lg:w-72"
          bind:value={search}
        />
      </form>

      <button
        type="button"
        data-testid="header-sync-status"
        class={`hidden h-10 items-center gap-2 rounded-lg border px-3 text-caption font-medium transition hover:bg-ink/5 lg:flex ${syncTone}`}
        onclick={() => navigate("data-sources")}
      >
        <RefreshCw class={`size-3.5 ${sync?.running ? "animate-spin" : ""}`} />
        <span class="max-w-48 truncate">{syncLabel}</span>
      </button>

      <button
        type="button"
        class={`relative flex size-10 items-center justify-center rounded-full ${view === "inbox" ? "bg-ink text-white" : "bg-secondary text-ink hover:bg-ink/10"}`}
        aria-label={inboxAccessibleLabel(inboxCounts)}
        onclick={() => navigate("inbox")}
        ><Inbox class="size-5" /><span aria-hidden="true"
          ><InboxBadge counts={inboxCounts} variant="overlay" /></span
        ></button
      >

      <button
        type="button"
        class={`hidden size-10 items-center justify-center rounded-full xl:flex ${panelOpen ? "bg-ink text-white" : "bg-secondary text-ink hover:bg-ink/10"}`}
        aria-label={panelOpen ? "收起概況欄" : "開啟概況欄"}
        aria-pressed={panelOpen}
        onclick={onTogglePanel}><PanelRight class="size-5" /></button
      >

      <button
        type="button"
        class="flex size-10 items-center justify-center rounded-full bg-secondary text-ink hover:bg-ink/10"
        aria-label={moneyState.hidden ? "顯示金額" : "隱藏金額"}
        onclick={onToggleMoney}
      >
        {#if moneyState.hidden}<Eye class="size-5" />{:else}<EyeOff
            class="size-5"
          />{/if}
      </button>
    </div>
  </div>
</header>
