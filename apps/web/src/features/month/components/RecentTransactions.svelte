<!--
  本月頁「最近交易」：去重後最新的幾筆，連到交易頁。金額以原幣顯示（發票為支出）。
  主標為商家顯示名稱（沒有才用原始標題），發票相關的列加上前 3 個品項；
  有備註時在名稱下方顯示一行「📝 備註」（截斷）。
-->
<script lang="ts">
  import {
    activityDateKey,
    activityDisplayAmount,
    formatActivityDateGroup,
    type ActivityItem,
  } from "@taiwan-fin-hub/core";
  import { formatCurrency } from "@/shared/format/financial";
  import {
    activityDisplayName,
    activityItemsSummary,
  } from "@/data/activity/names";

  let {
    items,
    loading = false,
    failed = false,
    onOpenAll,
  }: {
    items: ActivityItem[];
    loading?: boolean;
    failed?: boolean;
    onOpenAll: () => void;
  } = $props();

  const SOURCE_LABELS = {
    bank: "銀行",
    card: "信用卡",
    investment: "投資",
    invoice: "發票",
  } as const;
</script>

<section class="min-w-0" aria-labelledby="month-recent">
  <div class="flex items-baseline justify-between gap-3">
    <h2 id="month-recent" class="text-base font-semibold">最近交易</h2>
    <button
      type="button"
      class="text-sm font-semibold text-steel hover:text-steel/80"
      onclick={onOpenAll}>查看全部交易 →</button
    >
  </div>
  {#if loading}
    <p class="mt-3 text-caption text-subtle">載入交易中…</p>
  {:else if failed}
    <p class="mt-3 text-caption text-coral">無法載入交易，請稍後再試。</p>
  {:else if items.length === 0}
    <p class="mt-3 text-caption text-subtle">這個月還沒有交易。</p>
  {:else}
    <ul class="mt-2 divide-y divide-ink/8" aria-label="最近交易">
      {#each items as item (`${item.source}-${item.id}`)}
        {@const amount = activityDisplayAmount(item)}
        <li class="flex min-w-0 items-center gap-3 py-2.5">
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium">
              {activityDisplayName(item)}
            </p>
            {#if activityItemsSummary(item)}<p
                class="truncate text-caption text-subtle"
                data-activity-items
              >
                {activityItemsSummary(item)}
              </p>{/if}
            {#if item.note}<p
                class="truncate text-caption text-subtle"
                data-activity-note
                title={item.note}
              >
                <span aria-hidden="true">📝</span>
                <span class="sr-only">備註：</span>{item.note}
              </p>{/if}
            <p class="truncate text-caption text-subtle">
              {formatActivityDateGroup(activityDateKey(item))} · {SOURCE_LABELS[
                item.source
              ]}{item.institutionName ? ` · ${item.institutionName}` : ""}
            </p>
          </div>
          <span
            class={`shrink-0 text-sm font-semibold tabular-nums ${amount != null && amount > 0 ? "text-moss" : ""}`}
            >{amount == null
              ? "—"
              : `${amount > 0 ? "+" : ""}${formatCurrency(amount, item.currency)}`}</span
          >
        </li>
      {/each}
    </ul>
  {/if}
</section>
