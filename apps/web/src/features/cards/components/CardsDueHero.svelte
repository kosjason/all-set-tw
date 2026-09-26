<!--
  信用卡頁頂端：本期總應繳、尚未繳與最近截止日倒數。
  最近未繳清的截止日在 7 天內（或已逾期）時以警示色醒目顯示。
-->
<script lang="ts">
  import type { CardsSummaryResponse } from "@/data/cards/queries";
  import { formatCurrency, formatDate } from "@/shared/format/financial";
  import {
    countdownLabel,
    dueUrgency,
    isDueHighlighted,
    PAYMENT_STATUS_LABELS,
  } from "../model/cards";

  let { summary }: { summary: CardsSummaryResponse } = $props();

  const nextDue = $derived(summary.nextDue);
  const urgency = $derived(
    nextDue
      ? dueUrgency({
          paymentStatus: nextDue.paymentStatus,
          daysUntilDue: nextDue.daysUntilDue,
        })
      : "settled",
  );
  const highlighted = $derived(isDueHighlighted(urgency));
</script>

<section
  aria-label="本期應繳總覽"
  class="grid gap-4 rounded-xl border border-ink/10 bg-card p-5 shadow-xs md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:p-6"
>
  <div class="grid gap-4 sm:grid-cols-3 md:grid-cols-1 lg:grid-cols-3">
    <div>
      <p class="text-caption font-medium text-subtle">本期總應繳</p>
      <p
        class="mt-1 text-3xl font-semibold tracking-tight tabular-nums"
        data-testid="cards-total-due"
      >
        {formatCurrency(summary.totals.statementBalance)}
      </p>
    </div>
    <div>
      <p class="text-caption font-medium text-subtle">尚未繳</p>
      <p class="mt-1 text-xl font-semibold tabular-nums text-coral">
        {formatCurrency(summary.totals.remainingAmount)}
      </p>
    </div>
    <div>
      <p class="text-caption font-medium text-subtle">未出帳累計</p>
      <p class="mt-1 text-xl font-semibold tabular-nums">
        {formatCurrency(summary.totals.unbilledAmount)}
      </p>
    </div>
  </div>

  <div
    data-testid="cards-next-due"
    data-urgency={urgency}
    role={highlighted ? "alert" : undefined}
    class={`flex flex-col justify-center rounded-lg px-4 py-3 ${highlighted ? "bg-coral text-white" : "bg-ink/5 text-ink"}`}
  >
    {#if nextDue}
      <p
        class={`text-caption font-medium ${highlighted ? "text-white/85" : "text-subtle"}`}
      >
        最近截止日 · {nextDue.name}
      </p>
      <p class="mt-1 text-2xl font-semibold tracking-tight">
        {countdownLabel(nextDue.daysUntilDue)}
      </p>
      <p
        class={`mt-1 text-caption ${highlighted ? "text-white/85" : "text-subtle"}`}
      >
        {formatDate(nextDue.paymentDueDate)} · {PAYMENT_STATUS_LABELS[
          nextDue.paymentStatus
        ]}{nextDue.remainingAmount != null
          ? ` · 尚需 ${formatCurrency(nextDue.remainingAmount)}`
          : ""}
      </p>
    {:else}
      <p class="text-caption font-medium text-subtle">最近截止日</p>
      <p class="mt-1 text-lg font-semibold">目前沒有待繳的帳單</p>
    {/if}
  </div>
</section>
