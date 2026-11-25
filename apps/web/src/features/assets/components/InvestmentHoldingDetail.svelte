<!--
  單一持股的明細：平均成本、本金、損益、配息、本金來源、期初持股成本（可改填實際
  成本）、市值與本金走勢，以及買進、賣出、分割、配息的時間軸。
  - holding：持股績效。
  - api：寫入期初成本用。
  - dividendsSince：配息資料起始日（銀行資料的第一天）。
-->
<script lang="ts">
  import { createMutation, useQueryClient } from "@tanstack/svelte-query";
  import type { InvestmentHolding } from "@taiwan-fin-hub/shared";
  import type { ApiClient } from "@/shared/api/client";
  import { queryKeys } from "@/shared/api/query-keys";
  import Button from "@/shared/ui/Button.svelte";
  import Input from "@/shared/ui/Input.svelte";
  import { formatCurrency } from "@/shared/format/financial";
  import {
    clearOpeningCostMutation,
    setOpeningCostMutation,
  } from "@/data/investments/mutations";
  import InvestmentHistoryChart from "./InvestmentHistoryChart.svelte";
  import {
    costBreakdownText,
    costIssueText,
    dividendText,
    eventDetail,
    eventLabel,
    formatSharePrice,
    formatSignedCurrency,
    formatSignedPercent,
    openingText,
    pnlTone,
    shortDate,
  } from "../model/investment-performance";

  let {
    holding,
    api,
    dividendsSince,
  }: {
    holding: InvestmentHolding;
    api: ApiClient;
    dividendsSince: string | null;
  } = $props();

  const TIMELINE_PREVIEW = 12;
  const qc = useQueryClient();
  let showAll = $state(false);
  let editing = $state(false);
  let costInput = $state("");
  let formError = $state("");

  const timeline = $derived([...holding.events].reverse());
  const visibleTimeline = $derived(
    showAll ? timeline : timeline.slice(0, TIMELINE_PREVIEW),
  );

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: queryKeys.investmentPerformance });
  const setCost = createMutation({
    ...setOpeningCostMutation(() => api),
    onSuccess: async () => {
      await invalidate();
      editing = false;
    },
  });
  const clearCost = createMutation({
    ...clearOpeningCostMutation(() => api),
    onSuccess: invalidate,
  });

  function startEditing() {
    costInput = holding.opening?.manual
      ? String(holding.opening.cost ?? "")
      : "";
    formError = "";
    editing = true;
  }

  function submit(event: SubmitEvent) {
    event.preventDefault();
    const cost = Number(costInput.replace(/[,\s]/gu, ""));
    if (!Number.isInteger(cost) || cost < 1) {
      formError = "請輸入正整數的金額（新台幣）。";
      return;
    }
    formError = "";
    $setCost.mutate({ key: holding.key, cost });
  }

  const metrics = $derived([
    {
      label: "平均成本",
      value:
        holding.averageCost == null
          ? "—"
          : formatSharePrice(holding.averageCost),
    },
    {
      label: "本金",
      value:
        holding.costBasis == null ? "—" : formatCurrency(holding.costBasis),
    },
    {
      label: "未實現損益",
      value:
        holding.unrealizedPnl == null
          ? "—"
          : `${formatSignedCurrency(holding.unrealizedPnl)}${holding.unrealizedPct == null ? "" : `（${formatSignedPercent(holding.unrealizedPct)}）`}`,
      tone: pnlTone(holding.unrealizedPnl),
    },
    {
      label: "已實現損益（估算）",
      value:
        holding.realizedPnl == null
          ? "—"
          : formatSignedCurrency(holding.realizedPnl),
      tone: pnlTone(holding.realizedPnl),
    },
    {
      label: dividendsSince
        ? `配息（${shortDate(dividendsSince)} 起）`
        : "配息",
      value: dividendText(holding),
    },
    {
      label: "含息總報酬",
      value:
        holding.totalReturn == null
          ? "—"
          : formatSignedCurrency(holding.totalReturn),
      tone: pnlTone(holding.totalReturn),
    },
  ]);
</script>

<div class="grid gap-4 pb-4" data-holding-detail>
  {#if holding.issues.length > 0}
    <ul
      class="grid gap-1 rounded-lg bg-amber-50 px-3 py-2 text-caption text-amber-900"
      role="status"
    >
      {#each holding.issues as issue (issue)}
        <li>{costIssueText(issue, holding)}</li>
      {/each}
    </ul>
  {/if}

  <dl class="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
    {#each metrics as metric (metric.label)}
      <div class="min-w-0">
        <dt class="text-caption text-subtle">{metric.label}</dt>
        <dd
          class={`mt-0.5 text-sm font-semibold tabular-nums ${metric.tone ?? ""}`}
        >
          {metric.value}
        </dd>
      </div>
    {/each}
  </dl>

  {#if holding.costBasis != null && holding.quantity > 0}
    <p class="text-caption text-subtle">
      本金來源：{costBreakdownText(holding)}
    </p>
  {/if}

  {#if holding.opening}
    <div class="grid gap-2 rounded-lg border border-ink/8 px-3 py-2.5">
      <p class="text-caption text-subtle">{openingText(holding)}</p>
      {#if editing}
        <form class="flex flex-wrap items-center gap-2" onsubmit={submit}>
          <label class="sr-only" for={`opening-${holding.key}`}
            >期初持股的實際總成本</label
          >
          <Input
            id={`opening-${holding.key}`}
            class="h-9 w-40"
            inputmode="numeric"
            placeholder="實際總成本"
            bind:value={costInput}
          />
          <Button size="sm" type="submit" disabled={$setCost.isPending}
            >儲存</Button
          >
          <Button
            size="sm"
            variant="ghost"
            onclick={() => (editing = false)}
            disabled={$setCost.isPending}>取消</Button
          >
        </form>
        {#if formError || $setCost.isError}
          <p class="text-caption text-coral" role="alert">
            {formError || $setCost.error?.message}
          </p>
        {/if}
      {:else}
        <div class="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onclick={startEditing}>
            {holding.opening.manual ? "修改實際成本" : "填入實際成本"}
          </Button>
          {#if holding.opening.manual}
            <Button
              size="sm"
              variant="ghost"
              disabled={$clearCost.isPending}
              onclick={() => $clearCost.mutate(holding.key)}>改回估算</Button
            >
          {/if}
        </div>
        {#if $clearCost.isError}
          <p class="text-caption text-coral" role="alert">
            {$clearCost.error?.message}
          </p>
        {/if}
      {/if}
    </div>
  {/if}

  {#if holding.quantity > 0}
    <section aria-label={`${holding.symbol} 市值走勢`}>
      <h4 class="mb-1 text-caption font-medium text-subtle">市值與本金</h4>
      <InvestmentHistoryChart history={holding.history} />
    </section>
  {/if}

  <section aria-label={`${holding.symbol} 時間軸`}>
    <h4 class="mb-1 text-caption font-medium text-subtle">
      時間軸（{holding.events.length} 筆）
    </h4>
    <ol class="divide-y divide-ink/6">
      {#each visibleTimeline as event, index (`${event.date}-${event.kind}-${index}`)}
        <li class="flex items-start justify-between gap-3 py-2 text-sm">
          <div class="min-w-0">
            <p class="font-medium">
              <span class="tabular-nums text-subtle"
                >{shortDate(event.date)}</span
              >
              {eventLabel(event)}
            </p>
            {#if eventDetail(event)}
              <p class="mt-0.5 text-caption text-subtle">
                {eventDetail(event)}
              </p>
            {/if}
          </div>
          <div class="shrink-0 text-right tabular-nums">
            {#if event.amount != null}
              <p
                class={event.kind === "dividend" ? "font-medium text-moss" : ""}
              >
                {event.kind === "dividend"
                  ? `+${formatCurrency(event.amount)}`
                  : formatCurrency(event.amount)}
              </p>
            {:else if event.kind === "buy" || event.kind === "sell"}
              <p class="text-subtle">—</p>
            {/if}
            {#if event.realizedPnl != null}
              <p class={`text-caption ${pnlTone(event.realizedPnl)}`}>
                已實現 {formatSignedCurrency(event.realizedPnl)}
              </p>
            {/if}
          </div>
        </li>
      {/each}
    </ol>
    {#if timeline.length > TIMELINE_PREVIEW}
      <Button
        size="sm"
        variant="ghost"
        class="mt-1"
        onclick={() => (showAll = !showAll)}
      >
        {showAll ? "收合" : `顯示全部 ${timeline.length} 筆`}
      </Button>
    {/if}
  </section>
</div>
