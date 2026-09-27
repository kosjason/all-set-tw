<!--
  單一發卡行的本期帳單列；展開後列出本期繳款、未出帳，以及各卡本期帳單與未出帳消費和交易頁連結。
  推估資料標示「推估」並說明原因、來源與更新時間。
-->
<script lang="ts">
  import { ChevronDown } from "@lucide/svelte";
  import type { CardIssuerSummary } from "@/data/cards/queries";
  import {
    formatCurrency,
    formatDate,
    formatDateTime,
  } from "@/shared/format/financial";
  import {
    cardActivityHash,
    countdownLabel,
    dueUrgency,
    ESTIMATED_REASON_LABELS,
    isDueHighlighted,
    PAYMENT_STATUS_LABELS,
    sourceModeLabel,
  } from "../model/cards";

  let {
    issuer,
    expanded = false,
    onToggle,
  }: {
    issuer: CardIssuerSummary;
    expanded?: boolean;
    onToggle: () => void;
  } = $props();

  const bill = $derived(issuer.currentBill);
  const urgency = $derived(dueUrgency(bill));
  const highlighted = $derived(isDueHighlighted(urgency));
  const panelId = $derived(`card-issuer-${issuer.issuer}`);

  const statusClasses = {
    paid: "bg-moss/10 text-moss",
    partial: "bg-amber-100 text-amber-900",
    unpaid: "bg-coral/10 text-coral",
    unknown: "bg-ink/5 text-subtle",
  } as const;
  // 部署期間前端可能先於 API 更新；舊版 API 沒有這個欄位時視為沒有缺匯率。
  const statementMissingCurrencies = $derived(
    issuer.statementMissingCurrencies ?? [],
  );
</script>

<article
  class="rounded-xl border border-ink/10 bg-card shadow-xs"
  data-testid={`issuer-${issuer.issuer}`}
>
  <button
    type="button"
    class="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-4 py-4 text-left transition hover:bg-ink/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-steel md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:px-5"
    aria-expanded={expanded}
    aria-controls={panelId}
    onclick={onToggle}
  >
    <div class="min-w-0">
      <div class="flex flex-wrap items-center gap-2">
        <h3 class="text-base font-semibold tracking-tight">{issuer.name}</h3>
        {#if bill}
          <span
            class={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusClasses[bill.paymentStatus]}`}
            >{PAYMENT_STATUS_LABELS[bill.paymentStatus]}</span
          >
        {/if}
        {#if issuer.estimated}
          <span
            class="rounded-full border border-dashed border-amber-500 px-2 py-0.5 text-xs font-semibold text-amber-900"
            >推估</span
          >
        {/if}
      </div>
      <p class="mt-1 text-caption text-subtle">
        {issuer.cards.length} 張卡{issuer.combinedStatement
          ? " · 合併帳單"
          : ""}{bill ? ` · ${bill.billingPeriod} 帳單` : " · 尚無帳單"}
      </p>
      {#if issuer.estimated}
        <p class="text-caption text-amber-900" data-testid="issuer-estimated">
          {sourceModeLabel(issuer.source)} · {issuer.lastUpdatedAt
            ? `更新於 ${formatDateTime(issuer.lastUpdatedAt)}`
            : "尚無更新時間"}
        </p>
      {/if}
    </div>

    <div class="hidden md:block">
      <p class="text-caption text-subtle">本期應繳</p>
      <p class="mt-1 font-semibold tabular-nums">
        {bill?.statementBalance != null
          ? formatCurrency(bill.statementBalance, bill.currency)
          : "—"}
      </p>
      {#if bill?.minimumPayment != null}
        <p class="text-caption text-subtle">
          最低 {formatCurrency(bill.minimumPayment, bill.currency)}
        </p>
      {/if}
    </div>

    <div class="hidden md:block">
      <p class="text-caption text-subtle">截止日</p>
      <p
        class={`mt-1 font-semibold ${highlighted ? "text-coral" : ""}`}
        data-testid="issuer-countdown"
        data-urgency={urgency}
      >
        {bill?.paymentDueDate ? countdownLabel(bill.daysUntilDue) : "—"}
      </p>
      {#if bill?.paymentDueDate}
        <p class="text-caption text-subtle">
          {formatDate(bill.paymentDueDate)}
        </p>
      {/if}
    </div>

    <div class="flex items-center gap-3">
      <div class="text-right md:hidden">
        <p class="font-semibold tabular-nums">
          {bill?.statementBalance != null
            ? formatCurrency(bill.statementBalance, bill.currency)
            : "—"}
        </p>
        <p
          class={`text-caption ${highlighted ? "font-semibold text-coral" : "text-subtle"}`}
        >
          {bill?.paymentDueDate ? countdownLabel(bill.daysUntilDue) : "—"}
        </p>
      </div>
      <ChevronDown
        class={`size-5 shrink-0 text-subtle transition-transform ${expanded ? "rotate-180" : ""}`}
        aria-hidden="true"
      />
    </div>
  </button>

  {#if expanded}
    <div
      id={panelId}
      class="grid gap-4 border-t border-ink/10 px-4 py-4 md:px-5"
    >
      {#if bill}
        <dl class="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt class="text-caption text-subtle">已繳</dt>
            <dd class="font-medium tabular-nums">
              {formatCurrency(bill.paidAmount, bill.currency)}
            </dd>
          </div>
          <div>
            <dt class="text-caption text-subtle">尚需繳</dt>
            <dd class="font-medium tabular-nums">
              {bill.remainingAmount != null
                ? formatCurrency(bill.remainingAmount, bill.currency)
                : "—"}
            </dd>
          </div>
          <div>
            <dt class="text-caption text-subtle">結帳日</dt>
            <dd class="font-medium">
              {bill.statementClosingDate
                ? formatDate(bill.statementClosingDate)
                : "—"}
            </dd>
          </div>
          <div>
            <dt class="text-caption text-subtle">最低應繳</dt>
            <dd class="font-medium tabular-nums">
              {bill.minimumPayment != null
                ? formatCurrency(bill.minimumPayment, bill.currency)
                : "—"}
            </dd>
          </div>
        </dl>
        {#if bill.payments.length > 0}
          <div>
            <h4 class="text-caption font-semibold text-subtle">本期繳款</h4>
            <ul class="mt-1 divide-y divide-border text-sm">
              {#each bill.payments as payment (payment.transactionId)}
                <li class="flex items-center justify-between gap-3 py-2">
                  <span class="min-w-0 truncate"
                    >{formatDate(payment.date)} · {payment.side === "bank"
                      ? "存款扣款"
                      : "卡片入帳"}{payment.description
                      ? ` · ${payment.description}`
                      : ""}</span
                  >
                  <span class="shrink-0 tabular-nums"
                    >{formatCurrency(payment.amount)}</span
                  >
                </li>
              {/each}
            </ul>
          </div>
        {/if}
      {/if}

      <div>
        <div class="flex items-baseline justify-between gap-3">
          <h4 class="text-caption font-semibold text-subtle">
            未出帳（{formatDate(issuer.unbilled.since)} 起）
          </h4>
          <p class="text-sm font-semibold tabular-nums">
            {formatCurrency(issuer.unbilled.amount)}
          </p>
        </div>
        {#if issuer.unbilled.pendingAmount}
          <p class="text-caption text-subtle">
            含待入帳 {formatCurrency(issuer.unbilled.pendingAmount)}
          </p>
        {/if}
        {#if issuer.unbilled.missingCurrencies.length > 0}
          <p class="text-caption text-coral">
            缺少 {issuer.unbilled.missingCurrencies.join("、")} 匯率，未計入。
          </p>
        {/if}
      </div>

      <div>
        <div
          class="grid grid-cols-[minmax(0,1fr)_5.5rem_5.5rem] items-baseline gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_7rem] sm:gap-3 border-b border-border pb-1.5 text-caption font-semibold text-subtle"
        >
          <h4>各卡消費</h4>
          <span
            class="text-right"
            title={issuer.statementPeriod
              ? `${formatDate(issuer.statementPeriod.from)}～${formatDate(issuer.statementPeriod.to)}`
              : undefined}>本期帳單</span
          >
          <span class="text-right">未出帳</span>
        </div>
        <ul class="divide-y divide-border">
          {#each issuer.cards as card (card.key)}
            <li
              class="grid grid-cols-[minmax(0,1fr)_5.5rem_5.5rem] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_7rem_7rem] sm:gap-3 py-2"
              data-testid={`card-${card.key}`}
            >
              <div class="min-w-0">
                <p class="break-words text-sm font-medium sm:truncate">
                  {card.name}
                </p>
                <a
                  class="text-caption font-medium text-steel underline-offset-2 hover:underline"
                  href={cardActivityHash(card)}
                  >{card.activityFilterExact
                    ? "查看明細"
                    : `查看${issuer.name}明細`}</a
                >
              </div>
              <div class="text-right" data-testid="card-statement">
                {#if card.statementAmount == null}
                  <p class="text-sm text-subtle">—</p>
                {:else}
                  <p
                    class={`text-sm font-semibold tabular-nums ${card.statementAmount === 0 ? "text-subtle" : ""}`}
                  >
                    {formatCurrency(card.statementAmount)}
                  </p>
                  <p class="text-caption text-subtle">
                    {card.statementTransactionCount} 筆
                  </p>
                {/if}
              </div>
              <div class="text-right" data-testid="card-unbilled">
                <p
                  class={`text-sm font-semibold tabular-nums ${card.unbilledAmount === 0 ? "text-subtle" : ""}`}
                >
                  {formatCurrency(card.unbilledAmount)}
                </p>
                <p class="text-caption text-subtle">
                  {card.transactionCount} 筆{card.pendingAmount
                    ? ` · 待入帳 ${formatCurrency(card.pendingAmount)}`
                    : ""}
                </p>
              </div>
            </li>
          {:else}
            <li class="py-2 text-sm text-subtle">沒有卡片資料。</li>
          {/each}
        </ul>
        {#if statementMissingCurrencies.length > 0}
          <p class="mt-2 text-caption text-coral">
            本期帳單缺少 {statementMissingCurrencies.join("、")} 匯率，各卡本期金額未計入這些外幣消費。
          </p>
        {/if}
        {#if issuer.combinedStatement && issuer.statementPeriod}
          <p class="mt-2 text-caption text-subtle">
            本期帳單為 {formatDate(issuer.statementPeriod.from)}～{formatDate(
              issuer.statementPeriod.to,
            )} 各卡刷卡加總；合併帳單的應繳金額另含前期餘額、利息與費用，可能與加總不同。
          </p>
        {/if}
      </div>

      <footer class="text-caption text-subtle" data-testid="issuer-source">
        <p>
          來源：{issuer.source.name}（{sourceModeLabel(
            issuer.source,
          )}）{issuer.lastUpdatedAt
            ? ` · 更新於 ${formatDateTime(issuer.lastUpdatedAt)}`
            : " · 尚無更新時間"}
        </p>
        {#if issuer.estimated}
          <p class="mt-1 text-amber-900">
            推估：{issuer.estimatedReasons
              .map((reason) => ESTIMATED_REASON_LABELS[reason])
              .join("；")}
          </p>
        {/if}
      </footer>
    </div>
  {/if}
</article>
