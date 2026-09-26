<!--
  交易頁「銀行／信用卡／發票」分頁：只列該來源的原始紀錄（含已併入其他紀錄的
  重複項目），不顯示消費合計。
  - 銀行：帳戶、對方帳戶與角色。
  - 信用卡：依卡片（卡名＋末四碼）分組，標示未入帳／已入帳與是否已對應發票。
  - 發票：對應狀態（已對應刷卡／已對應銀行或電支／等待刷卡入帳／疑似重複／未對應）
    與前 3 個品項。
  點選一列開啟明細抽屜。
-->
<script module lang="ts">
  import type { ActivityItem } from "../model/types";
  import type { CardIdentity } from "../model/source-tabs";

  export interface TransactionSourceListProps {
    api: import("@/shared/api/client").ApiClient;
    tab: "bank" | "card" | "invoice";
    items: ActivityItem[];
    /** 目前載入的所有活動（找出發票併入的對象）。 */
    allItems: ActivityItem[];
    cardOf: (item: ActivityItem) => CardIdentity;
    emptyMessage: string;
    onOpen: (item: ActivityItem) => void;
  }
</script>

<script lang="ts">
  import { activityDisplayAmount } from "@taiwan-fin-hub/core";
  import { formatCurrencyPrecise } from "@/shared/format/financial";
  import InvoiceItemsPreview from "./InvoiceItemsPreview.svelte";
  import { formatActivityDate } from "../model/list";
  import { ECONOMIC_ROLE_LABELS } from "../model/roles";
  import {
    cardPostingLabel,
    groupByCard,
    invoiceItemsPreview,
    invoiceMatchStatus,
    type InvoiceMatchStatus,
  } from "../model/source-tabs";

  let {
    api,
    tab,
    items,
    allItems,
    cardOf,
    emptyMessage,
    onOpen,
  }: TransactionSourceListProps = $props();

  const groups = $derived(tab === "card" ? groupByCard(items, cardOf) : []);
  const toneClass: Record<InvoiceMatchStatus["tone"], string> = {
    matched: "bg-moss/10 text-moss",
    waiting: "bg-steel/10 text-steel",
    warning: "bg-amber-100 text-amber-900",
    muted: "bg-ink/6 text-subtle",
  };

  function amountText(item: ActivityItem) {
    const amount = activityDisplayAmount(item);
    if (amount == null) return "—";
    return `${amount > 0 ? "+" : ""}${formatCurrencyPrecise(amount, item.currency)}`;
  }
</script>

{#snippet amount(item: ActivityItem)}
  {@const value = activityDisplayAmount(item)}
  <span
    class={`shrink-0 text-sm font-semibold tabular-nums ${item.duplicateOf ? "text-subtle line-through decoration-ink/30" : value != null && value > 0 ? "text-moss" : ""}`}
    >{amountText(item)}</span
  >
{/snippet}

{#snippet row(item: ActivityItem)}
  <li>
    <button
      type="button"
      data-testid="source-row"
      class="flex w-full min-w-0 items-center gap-3 px-1 py-2.5 text-left transition hover:bg-ink/3"
      onclick={() => onOpen(item)}
    >
      <span class="min-w-0 flex-1">
        <span class="block truncate text-sm font-medium">{item.title}</span>
        <span
          class="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-caption text-subtle"
        >
          <span class="shrink-0">{formatActivityDate(item)}</span>
          {#if tab === "bank"}
            <span class="truncate"
              >{[item.institutionName, item.accountName]
                .filter(Boolean)
                .join(" ")}</span
            >
            {#if item.counterpartyAccount}<span
                class="truncate"
                data-testid="counterparty">{item.counterpartyAccount}</span
              >{/if}
            {#if item.economicRole}<span
                data-testid="role"
                class={`rounded-full px-2 font-semibold ${item.reviewStatus === "needs_review" ? "bg-amber-100 text-amber-900" : "bg-ink/6 text-ink"}`}
                >{ECONOMIC_ROLE_LABELS[item.economicRole]}{item.reviewStatus ===
                "needs_review"
                  ? "・待確認"
                  : ""}</span
              >{/if}
          {:else if tab === "card"}
            <span
              data-testid="posting"
              class={`rounded-full px-2 font-semibold ${item.status === "pending" ? "bg-amber-100 text-amber-900" : "bg-ink/6 text-ink"}`}
              >{cardPostingLabel(item)}</span
            >
            {#if item.invoiceId}<span class="text-moss">已對應發票</span>{/if}
          {:else}
            {@const match = invoiceMatchStatus(item, allItems)}
            <span
              data-testid="match-status"
              class={`rounded-full px-2 font-semibold ${toneClass[match.tone]}`}
              >{match.label}</span
            >
          {/if}
        </span>
        {#if tab === "invoice"}
          <InvoiceItemsPreview
            {api}
            invoiceId={item.invoiceId ?? item.id}
            preview={invoiceItemsPreview(item)}
          />
        {/if}
      </span>
      {@render amount(item)}
    </button>
  </li>
{/snippet}

<p
  class="rounded-lg bg-muted px-3 py-2 text-caption text-subtle"
  data-testid="raw-records-note"
>
  原始紀錄，不等於消費：同一筆消費可能同時出現在信用卡與發票，消費金額請看「總帳」。
</p>

{#if items.length === 0}
  <p class="py-10 text-center text-sm text-subtle">{emptyMessage}</p>
{:else if tab === "card"}
  <div class="grid gap-4 pt-2">
    {#each groups as group (group.key)}
      <section
        class="min-w-0"
        aria-label={`${group.name}${group.last4 ? ` 末四碼 ${group.last4}` : ""}`}
      >
        <h3
          class="flex min-w-0 items-baseline gap-2 border-b border-ink/10 pb-1.5 text-sm font-semibold"
        >
          <span class="truncate">{group.name}</span>
          {#if group.last4}<span class="shrink-0 tabular-nums text-subtle"
              >••{group.last4}</span
            >{/if}
          <span class="ml-auto shrink-0 text-caption font-normal text-subtle"
            >{group.items.length} 筆{group.pendingCount
              ? `・${group.pendingCount} 筆未入帳`
              : ""}</span
          >
        </h3>
        <ul class="divide-y divide-ink/8">
          {#each group.items as item (`${item.source}-${item.id}`)}
            {@render row(item)}
          {/each}
        </ul>
      </section>
    {/each}
  </div>
{:else}
  <ul class="divide-y divide-ink/8 pt-1">
    {#each items as item (`${item.source}-${item.id}`)}
      {@render row(item)}
    {/each}
  </ul>
{/if}
