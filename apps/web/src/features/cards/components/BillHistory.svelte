<!-- 選定發卡行的近 12 期帳單。 -->
<script lang="ts">
  import type { CardBillsResponse } from "@/data/cards/queries";
  import { formatCurrency, formatDate } from "@/shared/format/financial";
  import {
    ESTIMATED_REASON_LABELS,
    PAYMENT_STATUS_LABELS,
  } from "../model/cards";

  let {
    issuers,
    selected,
    onSelect,
    history,
    pending = false,
    error = false,
    onRetry,
  }: {
    issuers: Array<{ issuer: string; name: string }>;
    selected: string;
    onSelect: (issuer: string) => void;
    history?: CardBillsResponse;
    pending?: boolean;
    error?: boolean;
    onRetry: () => void;
  } = $props();
</script>

<section
  aria-labelledby="card-bill-history"
  class="rounded-xl border border-ink/10 bg-card p-4 shadow-xs md:p-5"
>
  <h2 id="card-bill-history" class="text-base font-semibold tracking-tight">
    帳單歷史
  </h2>
  <div
    class="no-scrollbar mt-3 flex gap-2 overflow-x-auto"
    role="tablist"
    aria-label="選擇發卡行"
  >
    {#each issuers as option (option.issuer)}
      <button
        type="button"
        role="tab"
        aria-selected={option.issuer === selected}
        class={`h-9 shrink-0 whitespace-nowrap rounded-full border px-3 text-caption font-semibold transition ${option.issuer === selected ? "border-ink bg-ink text-white" : "border-input bg-background text-ink hover:bg-ink/5"}`}
        onclick={() => onSelect(option.issuer)}>{option.name}</button
      >
    {/each}
  </div>

  {#if pending}
    <p class="py-6 text-sm text-subtle">正在載入帳單歷史。</p>
  {:else if error}
    <div class="py-6">
      <p class="text-sm text-coral">帳單歷史暫時無法載入。</p>
      <button
        type="button"
        class="mt-2 text-caption font-semibold text-steel underline"
        onclick={onRetry}>重試</button
      >
    </div>
  {:else if history}
    {#if history.estimated}
      <p class="mt-3 text-caption text-amber-900">
        推估：{history.estimatedReasons
          .map((reason) => ESTIMATED_REASON_LABELS[reason])
          .join("；")}
      </p>
    {/if}
    {#if history.bills.length === 0}
      <p class="py-6 text-sm text-subtle">尚無帳單。</p>
    {:else}
      <table class="mt-3 w-full text-sm">
        <thead>
          <tr class="text-left text-caption text-subtle">
            <th class="py-2 font-medium">帳單月份</th>
            <th class="py-2 text-right font-medium">應繳</th>
            <th class="hidden py-2 text-right font-medium sm:table-cell"
              >截止日</th
            >
            <th class="py-2 text-right font-medium">狀態</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border">
          {#each history.bills as bill (bill.billingPeriod)}
            <tr>
              <td class="py-2">{bill.billingPeriod}</td>
              <td class="py-2 text-right tabular-nums">
                {bill.statementBalance != null
                  ? formatCurrency(bill.statementBalance, bill.currency)
                  : "—"}{#if bill.statementEstimated}<span
                    class="ml-1 text-caption text-amber-900">推估</span
                  >{/if}
              </td>
              <td class="hidden py-2 text-right sm:table-cell">
                {bill.paymentDueDate ? formatDate(bill.paymentDueDate) : "—"}
              </td>
              <td class="py-2 text-right">
                {PAYMENT_STATUS_LABELS[bill.paymentStatus]}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  {/if}
</section>
