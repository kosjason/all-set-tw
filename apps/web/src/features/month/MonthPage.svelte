<!--
  本月（首頁）：月份切換與資料更新時間 → 條件式待處理提示條 → 收支算式
  （收入 − 消費 ＝ 存下來，其中投資／留在帳戶）→ 卡費提醒（7 天內未繳）→
  消費分類排行 → 近 6 月消費／存下來 → 最近交易 → 淨資產一行 → 發票去重摘要。
  收支數字一律來自 summary API。
-->
<script lang="ts">
  import { ChevronLeft, ChevronRight, CreditCard, Inbox } from "@lucide/svelte";
  import { currentActivityMonthKey } from "@taiwan-fin-hub/core";
  import { createQuery, keepPreviousData } from "@tanstack/svelte-query";
  import { toStore } from "svelte/store";
  import type { Navigate } from "@/app/types";
  import {
    activityMonthQuery,
    activitySummaryQuery,
  } from "@/data/activity/queries";
  import { buildSpendingCategoryRanking } from "@/data/activity/categories";
  import {
    activitySummaryEquation,
    activitySummaryExcludedParts,
    activitySummaryIncompleteLabels,
  } from "@/data/activity/summary";
  import {
    exchangeRatesQuery,
    manualAssetsQuery,
    netWorthHistoryQuery,
  } from "@/data/assets/queries";
  import {
    NET_WORTH_ASSET_SERIES,
    buildNetWorthChartData,
    getNetWorthComparison,
  } from "@/data/assets/net-worth-chart";
  import { calculateAssetSummary } from "@/data/assets/summary";
  import { bankRangeQuery } from "@/data/bank/queries";
  import { classificationCategoriesQuery } from "@/data/classification/queries";
  import { syncJobsQuery } from "@/data/connectors/queries";
  import { investmentsQuery } from "@/data/investments/queries";
  import type { ApiClient } from "@/shared/api/client";
  import { recentMonthKeys } from "@/shared/date-range";
  import { formatCurrency, formatDateTime } from "@/shared/format/financial";
  import CashFlowSummary from "@/shared/ui/cash-flow-summary/CashFlowSummary.svelte";
  import MonthTrend from "./components/MonthTrend.svelte";
  import RecentTransactions from "./components/RecentTransactions.svelte";
  import SpendingCategoryRanking from "./components/SpendingCategoryRanking.svelte";
  import { cardsSummaryQuery } from "@/data/cards/queries";
  import { monthDedupeCounts } from "./model/dedupe";
  import {
    adjacentMonth,
    buildMonthTrend,
    cardDueLabel,
    cardDueReminder,
    categoryTransactionsQuery,
    latestSyncSuccess,
    monthLabel,
    monthTitle,
    monthTransactionsQuery,
    pendingBanner,
    recentTransactions,
    type InboxCounts,
  } from "./model/month";

  let {
    api,
    navigate,
    inboxCounts,
  }: { api: ApiClient; navigate: Navigate; inboxCounts?: InboxCounts } =
    $props();

  const currentMonth = currentActivityMonthKey();
  // 月份選項與 summary 範圍都以台北月份為準（與交易頁一致）。
  const months = recentMonthKeys(
    6,
    new Date(`${currentMonth}-15T12:00:00+08:00`),
  );

  function monthFromHash() {
    const query = window.location.hash.split("?")[1] ?? "";
    const month = new URLSearchParams(query).get("month") ?? "";
    return months.includes(month) ? month : currentMonth;
  }
  let selectedMonth = $state(monthFromHash());
  $effect(() => {
    const hash =
      selectedMonth === currentMonth
        ? "#/month"
        : `#/month?month=${selectedMonth}`;
    if (!window.location.hash.startsWith("#/month")) return;
    if (window.location.hash === hash) return;
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${window.location.search}${hash}`,
    );
  });

  const summaries = createQuery(
    activitySummaryQuery(() => api, { from: months[0]!, to: months.at(-1)! }),
  );
  const monthItems = createQuery(
    toStore(() => ({
      ...activityMonthQuery(() => api, selectedMonth),
      placeholderData: keepPreviousData,
    })),
  );
  const categoryRows = createQuery(classificationCategoriesQuery(() => api));
  const jobs = createQuery(syncJobsQuery(() => api));
  // 卡費提醒：載入失敗時不顯示，不當成本月頁的錯誤。
  const cards = createQuery({
    ...cardsSummaryQuery(() => api),
    retry: false,
  });
  const bank = createQuery(
    bankRangeQuery(() => api, { from: currentMonth, to: currentMonth }),
  );
  const investments = createQuery(investmentsQuery(() => api));
  const manualAssets = createQuery(manualAssetsQuery(() => api));
  const rates = createQuery(exchangeRatesQuery(() => api));
  const history = createQuery(netWorthHistoryQuery(() => api));

  const summary = $derived(
    $summaries.data?.months.find((row) => row.month === selectedMonth) ??
      ($monthItems.data?.month === selectedMonth
        ? $monthItems.data.summary
        : undefined),
  );
  const summaryUnavailable = $derived(!summary);
  const banner = $derived(pendingBanner(inboxCounts, summary));
  const updatedAt = $derived(latestSyncSuccess($jobs.data ?? []));
  const reminder = $derived(
    $cards.isSuccess ? cardDueReminder($cards.data) : null,
  );
  const ranking = $derived(
    buildSpendingCategoryRanking(
      summary?.spendingByCategory ?? {},
      $categoryRows.data ?? [],
    ),
  );
  const trend = $derived(
    buildMonthTrend($summaries.data?.months ?? [], months, currentMonth),
  );
  const recent = $derived(recentTransactions($monthItems.data?.items ?? []));
  const dedupe = $derived(monthDedupeCounts(summary));

  const netWorthReady = $derived(
    $bank.isSuccess && $investments.isSuccess && $manualAssets.isSuccess,
  );
  const assetSummary = $derived(
    calculateAssetSummary({
      bank: $bank.data ?? { accounts: [], transactions: [] },
      investments: $investments.data ?? [],
      manualAssets: $manualAssets.data ?? [],
      rates: $rates.data,
    }),
  );
  const netWorthChange = $derived(
    getNetWorthComparison(
      buildNetWorthChartData(
        $history.data ?? [],
        NET_WORTH_ASSET_SERIES.map(({ key }) => key),
        "ALL",
      ),
      "month",
    ),
  );
  const previousMonth = $derived(adjacentMonth(months, selectedMonth, -1));
  const nextMonth = $derived(adjacentMonth(months, selectedMonth, 1));

  function openCategory(categoryId: string) {
    navigate("transactions", {
      query: categoryTransactionsQuery(categoryId, selectedMonth, currentMonth),
    });
  }
  function openTransactions(extra: Record<string, string> = {}) {
    navigate("transactions", {
      query: monthTransactionsQuery(selectedMonth, currentMonth, extra),
    });
  }
</script>

<div class="grid min-w-0 gap-6 pt-3 md:gap-8 md:pt-0">
  <div class="flex min-w-0 flex-wrap items-center justify-between gap-3">
    <div class="flex items-center gap-1" role="group" aria-label="切換月份">
      <button
        type="button"
        class="flex size-10 items-center justify-center rounded-full text-ink hover:bg-ink/5 disabled:opacity-30"
        aria-label="上個月"
        disabled={!previousMonth}
        onclick={() => previousMonth && (selectedMonth = previousMonth)}
        ><ChevronLeft class="size-5" /></button
      >
      <h2 class="min-w-28 text-center text-lg font-semibold" aria-live="polite">
        {monthTitle(selectedMonth)}
      </h2>
      <button
        type="button"
        class="flex size-10 items-center justify-center rounded-full text-ink hover:bg-ink/5 disabled:opacity-30"
        aria-label="下個月"
        disabled={!nextMonth}
        onclick={() => nextMonth && (selectedMonth = nextMonth)}
        ><ChevronRight class="size-5" /></button
      >
      {#if selectedMonth !== currentMonth}<button
          type="button"
          class="ml-1 text-sm font-semibold text-steel"
          onclick={() => (selectedMonth = currentMonth)}>回到本月</button
        >{/if}
    </div>
    <p class="text-caption text-subtle" data-testid="month-updated-at">
      {#if $jobs.isPending}
        讀取更新時間…
      {:else if updatedAt}
        資料更新於 {formatDateTime(updatedAt)}
      {:else}
        尚無同步紀錄
      {/if}
    </p>
  </div>

  {#if banner}
    <button
      type="button"
      data-testid="month-pending-banner"
      class={`flex min-h-12 min-w-0 items-center gap-3 rounded-xl border px-4 text-left text-sm transition ${banner.kind === "inbox" && banner.blocking ? "border-coral/30 bg-coral/5 text-coral hover:bg-coral/10" : "border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100"}`}
      onclick={() =>
        banner?.kind === "inbox"
          ? navigate("inbox")
          : openTransactions({ review: "1" })}
    >
      <Inbox class="size-4 shrink-0" />
      <span class="min-w-0 flex-1 font-semibold">
        {#if banner.kind === "inbox"}
          有 {banner.count} 件待處理
        {:else}
          {banner.count} 筆交易待確認（金額 {formatCurrency(banner.amount)}）
        {/if}
      </span>
      <ChevronRight class="size-4 shrink-0" />
    </button>
  {/if}

  <CashFlowSummary
    size="lg"
    title={`${monthLabel(selectedMonth)}收支`}
    note={summaryUnavailable
      ? $summaries.isError
        ? "月收支摘要無法載入"
        : "正在計算收支"
      : undefined}
    equation={activitySummaryEquation(summary)}
    unavailable={summaryUnavailable}
    excluded={activitySummaryExcludedParts(summary)}
    incompleteReasons={activitySummaryIncompleteLabels(summary)}
  />

  {#if reminder}
    <button
      type="button"
      data-testid="month-card-due"
      class="flex min-h-14 min-w-0 items-center gap-3 rounded-xl border border-coral/30 bg-coral/5 px-4 text-left text-sm transition hover:bg-coral/10"
      onclick={() => navigate("cards")}
    >
      <CreditCard class="size-5 shrink-0 text-coral" />
      <span class="min-w-0 flex-1">
        <span class="block font-semibold"
          >{reminder.name} 卡費{cardDueLabel(reminder.daysUntilDue)}</span
        >
        <span class="block text-caption text-subtle"
          >截止日 {reminder.paymentDueDate}{reminder.remainingAmount != null
            ? ` · 尚未繳 ${formatCurrency(reminder.remainingAmount)}`
            : ""}</span
        >
      </span>
      <ChevronRight class="size-4 shrink-0 text-subtle" />
    </button>
  {/if}

  <div
    class="grid min-w-0 gap-6 border-t border-ink/10 pt-5 lg:grid-cols-2 lg:gap-10"
  >
    <SpendingCategoryRanking
      {ranking}
      total={summary?.spending ?? 0}
      unavailable={summaryUnavailable}
      onSelect={openCategory}
    />
    <MonthTrend
      points={trend}
      {selectedMonth}
      unavailable={!$summaries.data}
      onSelectMonth={(month) => (selectedMonth = month)}
    />
  </div>

  <div class="min-w-0 border-t border-ink/10 pt-5">
    <RecentTransactions
      items={recent}
      loading={$monthItems.isPending}
      failed={$monthItems.isError}
      onOpenAll={() => openTransactions()}
    />
  </div>

  <div class="grid min-w-0 gap-2 border-t border-ink/10 pt-5">
    <button
      type="button"
      data-testid="month-net-worth"
      class="group flex min-h-11 min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 rounded-sm text-left hover:bg-ink/3"
      onclick={() => navigate("assets")}
    >
      <span class="text-sm font-semibold">淨資產</span>
      <span class="text-lg font-semibold tabular-nums">
        {netWorthReady ? formatCurrency(assetSummary.netWorth) : "—"}
      </span>
      {#if netWorthChange}
        <span
          class={`text-caption tabular-nums ${netWorthChange.changeValue < 0 ? "text-coral" : "text-moss"}`}
          >較上月 {netWorthChange.changeValue >= 0 ? "+" : ""}{formatCurrency(
            netWorthChange.changeValue,
          )}</span
        >
      {/if}
      <span class="ml-auto text-sm font-semibold text-steel">查看資產 →</span>
    </button>
    {#if dedupe}
      <p class="text-caption text-subtle" data-testid="month-dedupe">
        {dedupe.merged} 張發票已併入刷卡、{dedupe.unmatched} 張未對應{dedupe.awaitingCard
          ? `、${dedupe.awaitingCard} 張等待刷卡入帳`
          : ""}{dedupe.ambiguous ? `、${dedupe.ambiguous} 張待確認` : ""}
        <button
          type="button"
          class="ml-1 font-semibold text-steel"
          onclick={() => openTransactions({ tab: "invoice" })}>查看發票</button
        >
      </p>
    {/if}
  </div>
</div>
