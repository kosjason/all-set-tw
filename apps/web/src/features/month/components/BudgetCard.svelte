<!--
  本月可花：每月消費預算 − 本月已花 − 每月固定支出待扣（年繳由準備金支付，不扣）。
  顯示還可花與「每天約可花」、照預算可存下多少；還沒設定預算時只給過去每月約花多少，引導到可花設定。
-->
<script lang="ts">
  import { ChevronRight } from "@lucide/svelte";
  import type { BudgetSummary } from "@/data/budget/queries";
  import { formatCurrency } from "@/shared/format/financial";
  import { moneyState } from "@/shared/state/money-visibility.svelte";

  let {
    budget,
    loading = false,
    failed = false,
    onOpenSettings,
  }: {
    budget?: BudgetSummary;
    loading?: boolean;
    failed?: boolean;
    onOpenSettings: () => void;
  } = $props();

  const used = $derived(budget ? budget.spent + budget.fixedRemaining : 0);
  // 0–100%；預算為 0 時只要有花就算 100%。
  const usedPercent = $derived.by(() => {
    if (budget?.monthlyBudget == null) return 0;
    if (budget.monthlyBudget === 0) return used > 0 ? 100 : 0;
    return Math.min(Math.max((used / budget.monthlyBudget) * 100, 0), 100);
  });
  const overspent = $derived(budget?.available != null && budget.available < 0);
</script>

<section
  class="rounded-xl border border-border bg-card p-4 shadow-xs md:p-5"
  aria-label="本月可花"
  data-testid="month-budget"
>
  <div class="flex items-center justify-between gap-3">
    <h2 class="text-caption font-medium text-subtle">本月還可花</h2>
    <button
      type="button"
      class="flex items-center text-caption font-semibold text-steel hover:text-steel/80"
      onclick={onOpenSettings}>設定<ChevronRight class="size-3.5" /></button
    >
  </div>

  {#if loading}
    <p class="mt-2 text-sm text-subtle">計算中…</p>
  {:else if failed || !budget}
    <p class="mt-2 text-sm text-coral">本月可花無法載入。</p>
  {:else if budget.monthlyBudget == null}
    <p class="mt-2 text-sm" data-testid="budget-unset">還沒設定每月預算。</p>
    {#if budget.typicalSpending != null}
      <p class="mt-1 text-caption text-subtle">
        過去每月約花 {formatCurrency(budget.typicalSpending)}（不含年繳）
      </p>
    {/if}
    <button
      type="button"
      class="mt-2 text-sm font-semibold text-steel"
      onclick={onOpenSettings}>設定每月預算 →</button
    >
  {:else}
    <p
      class={`mt-1 break-all text-[clamp(1.5rem,4vw,2rem)] leading-tight font-semibold tracking-tight tabular-nums ${overspent ? "text-coral" : ""}`}
      data-testid="budget-available"
    >
      {formatCurrency(budget.available ?? 0)}
    </p>
    <p class="mt-1 text-caption text-subtle">
      {#if overspent}
        已超出預算
      {:else if budget.dailyAllowance != null}
        剩 {budget.daysLeft} 天，每天約可花
        <strong class="font-semibold text-ink tabular-nums"
          >{formatCurrency(budget.dailyAllowance)}</strong
        >
      {/if}
    </p>

    <div
      class="mt-3 h-2 w-full overflow-hidden rounded-full bg-ink/6"
      role="img"
      aria-label={moneyState.hidden
        ? "預算已用掉或預留的比例"
        : `預算已用掉或預留 ${Math.round(usedPercent)}%`}
    >
      <div
        class={`h-full rounded-full ${overspent ? "bg-coral" : "bg-steel"}`}
        style={`width:${usedPercent}%`}
      ></div>
    </div>

    <dl class="mt-3 grid gap-1 text-caption">
      <div class="flex justify-between gap-3">
        <dt class="text-subtle">每月預算</dt>
        <dd class="tabular-nums">{formatCurrency(budget.monthlyBudget)}</dd>
      </div>
      <div class="flex justify-between gap-3">
        <dt class="text-subtle">本月已花</dt>
        <dd class="tabular-nums">−{formatCurrency(budget.spent)}</dd>
      </div>
      {#if budget.fixedRemaining > 0}
        <div class="flex justify-between gap-3">
          <dt class="text-subtle">固定支出待扣</dt>
          <dd class="tabular-nums">−{formatCurrency(budget.fixedRemaining)}</dd>
        </div>
      {/if}
      {#if budget.spentFromReserve > 0}
        <div class="flex justify-between gap-3">
          <dt class="text-subtle">年繳（由準備金支付，不扣可花）</dt>
          <dd class="tabular-nums text-subtle">
            {formatCurrency(budget.spentFromReserve)}
          </dd>
        </div>
      {/if}
    </dl>

    {#if budget.expectedSavings != null}
      <p
        class={`mt-3 text-caption ${budget.expectedSavings < 0 ? "text-coral" : "text-moss"}`}
        data-testid="budget-expected-savings"
      >
        {#if budget.expectedSavings < 0}
          照這個預算和年繳準備，每月還差 {formatCurrency(
            -budget.expectedSavings,
          )}
        {:else}
          照這個預算，本月約可存下 {formatCurrency(
            budget.expectedSavings,
          )}{budget.expectedIncome.source === "history"
            ? "（收入以近幾個月推算）"
            : ""}
        {/if}
      </p>
    {/if}
    {#if (budget.incompleteReasons ?? []).length > 0}
      <p class="mt-2 text-caption text-amber-900">
        部分資料載入有問題（例如外幣缺匯率），可花金額可能不準。
      </p>
    {/if}
    {#if budget.annualWithoutReserve}
      <p class="mt-2 text-caption text-amber-900">
        有年繳商家但年繳總額是 0，年繳付款照常扣可花。
      </p>
    {/if}
  {/if}

  {#if budget && !loading && !failed && budget.candidates.length > 0}
    <button
      type="button"
      class="mt-3 flex w-full items-center justify-between gap-3 rounded-lg bg-amber-50 px-3 py-2 text-left text-caption text-amber-900 hover:bg-amber-100"
      onclick={onOpenSettings}
    >
      <span
        >發現 {budget.candidates.length} 個可能的固定支出，確認後會先預留</span
      >
      <ChevronRight class="size-3.5 shrink-0" />
    </button>
  {/if}
</section>
