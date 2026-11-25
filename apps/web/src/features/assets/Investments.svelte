<!--
  投資頁：持倉市值（未實現）、本金與損益、配息，每檔可展開明細與時間軸；另列已出清
  的部位、對不到持股的配息與集保原始交易紀錄。本金與損益來自 /api/investments/performance，
  讀不到時仍顯示市值。
-->
<script lang="ts">
  import { createQuery } from "@tanstack/svelte-query";
  import { ChevronRight, Search } from "@lucide/svelte";
  import EmptyState from "@/shared/ui/EmptyState.svelte";
  import Input from "@/shared/ui/Input.svelte";
  import Select from "@/shared/ui/Select.svelte";
  import type { ApiClient } from "@/shared/api/client";
  import { exchangeRatesQuery } from "@/data/assets/queries";
  import {
    investmentPerformanceQuery,
    investmentsQuery,
    investmentTransactionsQuery,
  } from "@/data/investments/queries";
  import type { InvestmentTransactionRow } from "@/data/investments/types";
  import type { InvestmentHolding } from "@taiwan-fin-hub/shared";
  import {
    formatCurrency,
    formatDate,
    formatNumber,
    rateMap,
  } from "@/shared/format/financial";
  import { investmentBrokerLabel } from "./model/investment-label";
  import {
    estimateNote,
    findHoldingPerformance,
    formatSharePrice,
    formatSignedCurrency,
    formatSignedPercent,
    pnlTone,
    shortDate,
  } from "./model/investment-performance";
  import InvestmentHoldingDetail from "./components/InvestmentHoldingDetail.svelte";

  let { api }: { api: ApiClient } = $props();
  const investments = createQuery(investmentsQuery(() => api));
  const performance = createQuery(investmentPerformanceQuery(() => api));
  const trades = createQuery(investmentTransactionsQuery(() => api));
  const rates = createQuery(exchangeRatesQuery(() => api));
  let search = $state("");
  let tradeType = $state("all");
  let expanded = $state<string | null>(null);

  const matchesSearch = (text: string) =>
    text.toLowerCase().includes(search.trim().toLowerCase());
  const rateValues = $derived(rateMap($rates.data));
  const total = $derived(
    ($investments.data ?? []).reduce((s, p) => {
      const value = (p.marketValue ?? 0) + (p.cashBalance ?? 0);
      return (
        s +
        (p.currency === "TWD" ? value : value * (rateValues[p.currency] ?? 0))
      );
    }, 0),
  );
  const perf = $derived($performance.data);
  const holdings = $derived(
    (perf?.holdings ?? []).filter((holding) =>
      matchesSearch(`${holding.symbol} ${holding.name}`),
    ),
  );
  // 績效讀不到（或不是集保的持倉）時，仍以市值列出。
  const otherPositions = $derived(
    ($investments.data ?? []).filter(
      (position) =>
        !findHoldingPerformance(perf, position) &&
        matchesSearch(`${position.symbol ?? ""} ${position.name}`),
    ),
  );
  const closed = $derived(
    (perf?.closed ?? []).filter((holding) =>
      matchesSearch(`${holding.symbol} ${holding.name}`),
    ),
  );
  // 股票型持股沒有對到任何配息：可能匯到沒有同步的帳戶，不能當成沒配息。
  const missingDividendSymbols = $derived([
    ...new Set(
      (perf?.holdings ?? [])
        .filter(
          (holding) => holding.dividends === 0 && holding.category === "equity",
        )
        .map((holding) => holding.symbol),
    ),
  ]);
  const unrealizedPct = $derived(
    perf?.totals.costBasis && perf.totals.unrealizedPnl != null
      ? (perf.totals.unrealizedPnl / perf.totals.costBasis) * 100
      : null,
  );
  const bondShare = $derived(
    perf && perf.totals.marketValue > 0
      ? (perf.totals.marketValueByCategory.bond / perf.totals.marketValue) * 100
      : null,
  );
  const filteredTrades = $derived(
    ($trades.data ?? [])
      .filter(
        (t) =>
          (tradeType === "all" || t.assetType === tradeType) &&
          matchesSearch(
            `${t.symbol ?? ""} ${t.name ?? ""} ${t.transactionName ?? ""}`,
          ),
      )
      .slice(0, 100),
  );
  function tradeDisplay(t: InvestmentTransactionRow) {
    if (t.amount != null && t.price != null && t.price !== 1)
      return formatCurrency(t.amount, t.currency);
    if (t.quantity != null) return `${formatNumber(t.quantity)} 股`;
    return "金額未提供";
  }
  function toggle(key: string) {
    expanded = expanded === key ? null : key;
  }
</script>

{#snippet holdingRow(holding: InvestmentHolding, closedRow: boolean)}
  {@const open = expanded === holding.key}
  <div class={open ? "border-b border-ink/15" : "border-b border-ink/8"}>
    <button
      type="button"
      class="grid w-full grid-cols-[minmax(0,1fr)_auto_16px] items-center gap-3 py-3 text-left transition hover:bg-ink/3"
      aria-expanded={open}
      onclick={() => toggle(holding.key)}
    >
      <span class="min-w-0">
        <strong class="block truncate text-sm">
          {holding.symbol}
          {holding.name}
        </strong>
        <small class="mt-1 block truncate text-caption text-subtle">
          {#if investmentBrokerLabel(holding)}{investmentBrokerLabel(holding)} ·
          {/if}{#if closedRow}已全部賣出{:else}{formatNumber(holding.quantity)} 股{#if holding.closePrice != null}
              · 收盤 {formatSharePrice(
                holding.closePrice,
              )}{/if}{#if holding.averageCost != null}
              · 均價 {formatSharePrice(holding.averageCost)}{/if}{/if}
        </small>
      </span>
      <span class="text-right">
        {#if closedRow}
          <strong
            class={`block text-sm tabular-nums ${pnlTone(holding.realizedPnl)}`}
          >
            {holding.realizedPnl == null
              ? "—"
              : formatSignedCurrency(holding.realizedPnl)}
          </strong>
          <small class="mt-1 block text-caption text-subtle"
            >已實現（估算）</small
          >
        {:else}
          <strong class="block text-sm tabular-nums">
            {formatCurrency(holding.marketValue)}
          </strong>
          <small
            class={`mt-1 block text-caption tabular-nums ${pnlTone(holding.unrealizedPnl)}`}
          >
            {#if holding.unrealizedPnl == null}
              <span class="text-subtle">本金待補</span>
            {:else}
              {formatSignedCurrency(
                holding.unrealizedPnl,
              )}{#if holding.unrealizedPct != null}（{formatSignedPercent(
                  holding.unrealizedPct,
                )}）{/if}
            {/if}
          </small>
        {/if}
      </span>
      <ChevronRight
        class={`size-4 text-subtle transition ${open ? "rotate-90" : ""}`}
      />
    </button>
    {#if open}
      <div class="pl-1">
        <InvestmentHoldingDetail
          {holding}
          {api}
          dividendsSince={perf?.dividendsSince ?? null}
        />
      </div>
    {/if}
  </div>
{/snippet}

{#if $investments.isPending}
  <EmptyState title="載入投資中" body="正在讀取投資持倉。" />
{:else if $investments.isError || $rates.isError}
  <EmptyState
    alert
    title="無法載入投資"
    body="必要的投資或匯率資料目前無法取得，請稍後再試。"
  />
{:else}
  <div class="grid min-w-0 gap-6">
    <section class="min-w-0 pt-3 md:pt-2" aria-label="投資摘要">
      <p class="flex items-center gap-2 text-sm text-subtle">
        持倉市值
        <span
          class="rounded bg-ink/5 px-1.5 py-0.5 text-caption font-medium text-subtle"
          >未實現</span
        >
      </p>
      <p
        class="mt-3 break-all text-[clamp(2rem,7vw,2.75rem)] leading-tight font-semibold tracking-tight tabular-nums"
      >
        {formatCurrency(total)}
      </p>
      {#if perf}
        <p class="mt-2 text-sm text-subtle" data-investment-cost-summary>
          {#if perf.totals.costBasis != null && perf.totals.unrealizedPnl != null}
            本金 <span class="font-medium text-ink tabular-nums"
              >{formatCurrency(perf.totals.costBasis)}</span
            >
            · 未實現損益
            <span
              class={`font-medium tabular-nums ${pnlTone(perf.totals.unrealizedPnl)}`}
              >{formatSignedCurrency(
                perf.totals.unrealizedPnl,
              )}{#if unrealizedPct != null}（{formatSignedPercent(
                  unrealizedPct,
                )}）{/if}</span
            >
          {:else if perf.pricesPending}
            本金：歷史收盤價補抓中，稍後才會出現。
          {:else}
            本金：部分持股無法估算，展開各檔查看原因。
          {/if}
        </p>
        <div class="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-6">
          <div class="min-w-0">
            <p class="text-caption text-subtle">已實現損益（估算）</p>
            <p
              class={`mt-2 text-lg font-medium tracking-tight tabular-nums ${pnlTone(perf.totals.realizedPnl)}`}
            >
              {perf.totals.realizedPnl == null
                ? "—"
                : formatSignedCurrency(perf.totals.realizedPnl)}
            </p>
          </div>
          <div class="min-w-0">
            <p class="text-caption text-subtle">
              配息{perf.dividendsSince
                ? `（${shortDate(perf.dividendsSince)} 起）`
                : ""}
            </p>
            <p class="mt-2 text-lg font-medium tracking-tight tabular-nums">
              {formatCurrency(perf.totals.dividends)}
            </p>
          </div>
          <div class="min-w-0">
            <p class="text-caption text-subtle">含息總報酬</p>
            <p
              class={`mt-2 text-lg font-medium tracking-tight tabular-nums ${pnlTone(perf.totals.totalReturn)}`}
            >
              {perf.totals.totalReturn == null
                ? "—"
                : formatSignedCurrency(perf.totals.totalReturn)}
            </p>
          </div>
          <div class="min-w-0">
            <p class="text-caption text-subtle">股票型／債券型</p>
            <p class="mt-2 text-lg font-medium tracking-tight tabular-nums">
              {bondShare == null
                ? "—"
                : `${(100 - bondShare).toFixed(0)}% / ${bondShare.toFixed(0)}%`}
            </p>
          </div>
        </div>
        <p class="mt-4 text-caption text-subtle">{estimateNote(perf)}</p>
      {:else if $performance.isError}
        <p class="mt-2 text-caption text-coral">
          本金與損益暫時無法載入，市值不受影響。
        </p>
      {/if}
    </section>

    <section class="min-w-0 border-t border-ink/10 pt-5" aria-label="投資持倉">
      <div class="flex flex-wrap items-center justify-between gap-3 pb-2">
        <h2 class="text-base font-semibold">投資持倉</h2>
        <div class="relative w-52">
          <Search
            class="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-subtle"
          />
          <Input
            class="pl-9"
            placeholder="搜尋股票／基金"
            bind:value={search}
          />
        </div>
      </div>
      {#if holdings.length === 0 && otherPositions.length === 0}
        <p class="py-8 text-center text-sm text-subtle">
          {search.trim() ? "沒有符合的持倉。" : "尚無投資持倉。"}
        </p>
      {:else}
        {#each holdings as holding (holding.key)}
          {@render holdingRow(holding, false)}
        {/each}
        {#each otherPositions as p (p.id)}
          <div
            class="flex items-center justify-between gap-3 border-b border-ink/8 py-3"
          >
            <div class="min-w-0">
              <p class="truncate text-sm font-semibold">
                {p.symbol ? `${p.symbol} ` : ""}{p.name}
              </p>
              <p class="mt-1 text-caption text-subtle">
                {#if investmentBrokerLabel(p)}{investmentBrokerLabel(p)} ·
                {/if}{formatNumber(p.quantity ?? 0)} 單位 · {formatDate(
                  p.asOfDate,
                )}
              </p>
            </div>
            <p class="shrink-0 text-sm font-semibold tabular-nums">
              {formatCurrency(
                (p.marketValue ?? 0) + (p.cashBalance ?? 0),
                p.currency,
              )}
            </p>
          </div>
        {/each}
      {/if}
    </section>

    {#if closed.length > 0}
      <section class="min-w-0 border-t border-ink/10 pt-5" aria-label="已出清">
        <h2 class="pb-2 text-base font-semibold">已出清</h2>
        {#each closed as holding (holding.key)}
          {@render holdingRow(holding, true)}
        {/each}
      </section>
    {/if}

    {#if perf && perf.unattributedDividends.length > 0}
      <section
        class="min-w-0 border-t border-ink/10 pt-5"
        aria-label="未歸屬配息"
      >
        <h2 class="text-base font-semibold">未歸屬配息</h2>
        <p class="mt-1 text-caption text-subtle">
          看起來是配息、但從說明對不到持股的銀行入帳。
        </p>
        <ul class="mt-2 divide-y divide-ink/8">
          {#each perf.unattributedDividends as dividend, index (`${dividend.date}-${index}`)}
            <li class="flex items-center justify-between gap-3 py-2 text-sm">
              <span class="min-w-0 truncate">
                <span class="tabular-nums text-subtle"
                  >{shortDate(dividend.date)}</span
                >
                {dividend.description}
              </span>
              <span class="shrink-0 tabular-nums text-moss"
                >+{formatCurrency(dividend.amount)}</span
              >
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if missingDividendSymbols.length > 0}
      <p class="text-caption text-subtle">
        {missingDividendSymbols.join(
          "、",
        )}：銀行資料裡沒有找到配息入帳（可能匯到沒有同步的帳戶），配息顯示「未找到」。
      </p>
    {/if}

    <details class="min-w-0 border-t border-ink/10 pt-5" aria-label="交易紀錄">
      <summary class="cursor-pointer text-base font-semibold">
        集保原始交易紀錄{$trades.data ? `（${$trades.data.length} 筆）` : ""}
      </summary>
      <p class="mt-1 text-caption text-subtle">
        每檔的成本與損益已整理在上方各持股的時間軸；這裡是集保回傳的原始紀錄（只有股數）。
      </p>
      <div class="flex flex-wrap items-center justify-end gap-3 pt-3 pb-4">
        <Select class="w-36" bind:value={tradeType}>
          <option value="all">全部類型</option>
          <option value="stock">股票</option>
          <option value="etf">ETF</option>
          <option value="fund">基金</option>
        </Select>
      </div>
      {#if $trades.isPending}
        <p class="py-8 text-center text-sm text-subtle">正在載入交易紀錄。</p>
      {:else if $trades.isError}
        <p class="py-8 text-center text-sm text-coral">
          交易紀錄暫時無法載入。
        </p>
      {:else if filteredTrades.length === 0}
        <p class="py-8 text-center text-sm text-subtle">尚無交易紀錄。</p>
      {:else}
        <div class="divide-y divide-ink/8">
          {#each filteredTrades as t (t.id)}
            <div class="flex items-center justify-between gap-3 py-3 text-sm">
              <div class="min-w-0">
                <p class="truncate font-semibold">
                  {t.name ?? t.symbol ?? "投資交易"}
                </p>
                <p class="mt-1 text-caption text-subtle">
                  {t.transactionName ?? t.transactionCode ?? ""} · {formatDate(
                    t.tradeDate ?? t.postedDate,
                  )}
                </p>
              </div>
              <span class="shrink-0 font-medium tabular-nums">
                {tradeDisplay(t)}
              </span>
            </div>
          {/each}
        </div>
      {/if}
    </details>
  </div>
{/if}
