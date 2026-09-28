<!--
  本月可花：預期收入 − 儲蓄目標 − 年繳準備金 ÷ 12 − 本月已花 − 固定支出待扣。
  顯示還可花與「每天約可花」，下方列出各項扣除；預期收入不明時提示到可花設定頁填寫。
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

  const income = $derived(budget?.expectedIncome.amount ?? null);
  const committed = $derived(
    budget
      ? budget.savingsTarget +
          budget.monthlyReserve +
          budget.spent +
          budget.fixedRemaining
      : 0,
  );
  const usedPercent = $derived(
    income && income > 0 ? Math.min((committed / income) * 100, 100) : 0,
  );
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
  {:else if budget.available == null}
    <p class="mt-2 text-sm">還不知道每月收入。</p>
    <button
      type="button"
      class="mt-1 text-sm font-semibold text-steel"
      onclick={onOpenSettings}>填寫預期月收入 →</button
    >
  {:else}
    <p
      class={`mt-1 break-all text-[clamp(1.5rem,4vw,2rem)] leading-tight font-semibold tracking-tight tabular-nums ${overspent ? "text-coral" : ""}`}
      data-testid="budget-available"
    >
      {formatCurrency(budget.available)}
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
        ? "收入已用掉或預留的比例"
        : `已用掉或預留收入的 ${Math.round(usedPercent)}%`}
    >
      <div
        class={`h-full rounded-full ${overspent ? "bg-coral" : "bg-steel"}`}
        style={`width:${usedPercent}%`}
      ></div>
    </div>

    <dl class="mt-3 grid gap-1 text-caption">
      <div class="flex justify-between gap-3">
        <dt class="text-subtle">
          預期收入{budget.expectedIncome.source === "history"
            ? `（近 ${budget.historyMonths.length} 個月推算）`
            : ""}
        </dt>
        <dd class="tabular-nums">{formatCurrency(income ?? 0)}</dd>
      </div>
      {#if budget.savingsTarget > 0}
        <div class="flex justify-between gap-3">
          <dt class="text-subtle">先存起來</dt>
          <dd class="tabular-nums">−{formatCurrency(budget.savingsTarget)}</dd>
        </div>
      {/if}
      {#if budget.monthlyReserve > 0}
        <div class="flex justify-between gap-3">
          <dt class="text-subtle">年繳準備金</dt>
          <dd class="tabular-nums">−{formatCurrency(budget.monthlyReserve)}</dd>
        </div>
      {/if}
      {#if budget.fixedRemaining > 0}
        <div class="flex justify-between gap-3">
          <dt class="text-subtle">固定支出待扣</dt>
          <dd class="tabular-nums">−{formatCurrency(budget.fixedRemaining)}</dd>
        </div>
      {/if}
      <div class="flex justify-between gap-3">
        <dt class="text-subtle">本月已花</dt>
        <dd class="tabular-nums">−{formatCurrency(budget.spent)}</dd>
      </div>
      {#if budget.spentFromReserve > 0}
        <div class="flex justify-between gap-3">
          <dt class="text-subtle">年繳（由準備金支付，不扣可花）</dt>
          <dd class="tabular-nums text-subtle">
            {formatCurrency(budget.spentFromReserve)}
          </dd>
        </div>
      {/if}
    </dl>

    {#if (budget.incompleteReasons ?? []).length > 0}
      <p class="mt-2 text-caption text-amber-900">
        部分資料載入有問題（例如外幣缺匯率），可花金額可能不準。
      </p>
    {/if}
    {#if budget.savingsTarget === 0}
      <button
        type="button"
        class="mt-3 flex w-full items-center justify-between gap-3 rounded-lg bg-steel/8 px-3 py-2 text-left text-caption text-steel hover:bg-steel/12"
        onclick={onOpenSettings}
        data-testid="budget-no-savings"
      >
        <span>還沒設定「先存起來」：上面的可花包含原本會存下來的錢</span>
        <ChevronRight class="size-3.5 shrink-0" />
      </button>
    {/if}
    {#if budget.candidates.length > 0}
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
  {/if}
</section>
