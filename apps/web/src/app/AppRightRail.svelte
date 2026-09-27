<!--
  右側概況欄：待處理（前幾項）、近期卡費（未繳清、依截止日）、資料來源同步狀態。
  寬螢幕常駐於頁面右側，較窄時由頁首按鈕以抽屜開啟。
-->
<script lang="ts">
  import { ChevronRight, CreditCard, Inbox, PlugZap, X } from "@lucide/svelte";
  import type { InboxItem } from "@taiwan-fin-hub/core";
  import { inboxNavigation } from "@/features/inbox/model/inbox";
  import {
    formatCurrency,
    formatDate,
    formatDateTime,
  } from "@/shared/format/financial";
  import type {
    SourceHealth,
    SyncOverview,
    UpcomingCardDue,
  } from "./shell-status";
  import type { Navigate } from "./types";

  let {
    inboxItems,
    inboxLoading = false,
    dues,
    duesLoading = false,
    sync,
    navigate,
    onClose,
  }: {
    inboxItems: InboxItem[];
    inboxLoading?: boolean;
    dues: UpcomingCardDue[];
    duesLoading?: boolean;
    sync?: SyncOverview;
    navigate: Navigate;
    /** 抽屜模式才有關閉鈕。 */
    onClose?: () => void;
  } = $props();

  const INBOX_LIMIT = 4;
  const shownInbox = $derived(
    [...inboxItems]
      .sort(
        (a, b) =>
          Number(b.severity === "blocking") - Number(a.severity === "blocking"),
      )
      .slice(0, INBOX_LIMIT),
  );

  const HEALTH_LABEL: Record<SourceHealth, string> = {
    ok: "正常",
    running: "同步中",
    attention: "需處理",
    unscheduled: "未排程",
    never: "尚未同步",
  };
  const HEALTH_DOT: Record<SourceHealth, string> = {
    ok: "bg-moss",
    running: "bg-steel",
    attention: "bg-coral",
    unscheduled: "bg-amber-400",
    never: "bg-ink/25",
  };

  function dueLabel(days: number) {
    if (days < 0) return `逾期 ${-days} 天`;
    if (days === 0) return "今天截止";
    return `${days} 天後`;
  }

  function go(...args: Parameters<Navigate>) {
    navigate(...args);
    onClose?.();
  }
</script>

{#snippet sectionHeader(title: string, Icon: typeof Inbox, onMore: () => void)}
  <div class="flex items-center justify-between gap-3">
    <h2 class="flex items-center gap-2 text-sm font-semibold">
      <Icon class="size-4 text-subtle" />{title}
    </h2>
    <button
      type="button"
      class="flex items-center text-caption font-medium text-steel hover:text-steel/80"
      onclick={onMore}>全部<ChevronRight class="size-3.5" /></button
    >
  </div>
{/snippet}

<div class="grid content-start gap-4 p-4" data-testid="right-rail">
  {#if onClose}
    <div class="flex items-center justify-between">
      <p class="text-sm font-semibold">概況</p>
      <button
        type="button"
        class="flex size-9 items-center justify-center rounded-full hover:bg-ink/5"
        aria-label="關閉概況欄"
        onclick={onClose}><X class="size-4" /></button
      >
    </div>
  {/if}

  <section
    class="rounded-xl border border-border bg-card p-4 shadow-xs"
    aria-label="待處理概況"
  >
    {@render sectionHeader("待處理", Inbox, () => go("inbox"))}
    {#if inboxLoading}
      <p class="mt-3 text-caption text-subtle">讀取中…</p>
    {:else if shownInbox.length === 0}
      <p class="mt-3 text-caption text-subtle">目前沒有待處理的事項。</p>
    {:else}
      <ul class="mt-3 grid gap-1">
        {#each shownInbox as item (item.id)}
          {@const target = inboxNavigation(item)}
          <li>
            <button
              type="button"
              class="grid w-full grid-cols-[8px_minmax(0,1fr)] items-start gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-ink/4"
              onclick={() => go(target.view, target.options)}
            >
              <span
                class={`mt-1.5 size-2 rounded-full ${item.severity === "blocking" ? "bg-coral" : "bg-amber-400"}`}
                aria-hidden="true"
              ></span>
              <span class="min-w-0">
                <span class="block truncate text-sm font-medium"
                  >{item.title}</span
                >
                <span class="block truncate text-caption text-subtle"
                  >{item.severity === "blocking" ? "需要處理" : "待整理"} · {item.detail}</span
                >
              </span>
            </button>
          </li>
        {/each}
      </ul>
      {#if inboxItems.length > INBOX_LIMIT}
        <p class="mt-1 px-2 text-caption text-subtle">
          另有 {inboxItems.length - INBOX_LIMIT} 項
        </p>
      {/if}
    {/if}
  </section>

  <section
    class="rounded-xl border border-border bg-card p-4 shadow-xs"
    aria-label="近期卡費"
  >
    {@render sectionHeader("近期卡費", CreditCard, () => go("cards"))}
    {#if duesLoading}
      <p class="mt-3 text-caption text-subtle">讀取中…</p>
    {:else if dues.length === 0}
      <p class="mt-3 text-caption text-subtle">本期帳單都已繳清。</p>
    {:else}
      <ul class="mt-3 grid gap-2.5">
        {#each dues as due (due.issuer)}
          <li class="flex items-start justify-between gap-3 text-sm">
            <span class="min-w-0">
              <span class="block truncate font-medium">{due.name}</span>
              <span
                class={`block text-caption ${due.daysUntilDue <= 3 ? "font-medium text-coral" : "text-subtle"}`}
                >{due.paymentDueDate} · {dueLabel(due.daysUntilDue)}</span
              >
            </span>
            <span class="shrink-0 font-semibold tabular-nums">
              {due.remainingAmount != null
                ? formatCurrency(due.remainingAmount)
                : "—"}
            </span>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section
    class="rounded-xl border border-border bg-card p-4 shadow-xs"
    aria-label="資料來源狀態"
  >
    {@render sectionHeader("資料來源", PlugZap, () => go("data-sources"))}
    {#if !sync}
      <p class="mt-3 text-caption text-subtle">讀取中…</p>
    {:else if sync.sources.length === 0}
      <p class="mt-3 text-caption text-subtle">尚未設定資料來源。</p>
    {:else}
      <ul class="mt-3 grid gap-2">
        {#each sync.sources as source (source.connectorId)}
          <li>
            <button
              type="button"
              class="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-ink/4"
              onclick={() =>
                go("data-sources", { connectorId: source.connectorId })}
            >
              <span class="flex min-w-0 items-center gap-2">
                <span
                  class={`size-2 shrink-0 rounded-full ${HEALTH_DOT[source.health]}`}
                  aria-hidden="true"
                ></span>
                <span class="truncate">{source.name}</span>
              </span>
              <span
                class={`shrink-0 text-caption ${source.health === "attention" ? "font-medium text-coral" : "text-subtle"}`}
              >
                {#if source.health === "unscheduled"}
                  未排程 · {formatDate(source.lastSuccessAt ?? undefined)}
                {:else if source.health === "ok" && source.lastSuccessAt}
                  {formatDateTime(source.lastSuccessAt)}
                {:else}
                  {HEALTH_LABEL[source.health]}
                {/if}
              </span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</div>
