<!--
  月收支摘要，以算式呈現，避免把投資誤認為與收入、消費並列的另一筆錢：
    收入 X − 消費 Y ＝ 存下來 Z（負數時改稱「超支」並以 coral 色標示）
      其中 投資 A ／ 留在帳戶 B（B ＝ Z − A；負數時顯示「動用存款」）
  手機直式排列（每列前面保留 − ＝ 符號），sm 以上排成一列。下方一行小字列出
  未計入的移轉、待確認筆數與資料不完整原因。數字全部來自 summary API。
  - title：區塊標題，也是 region 的名稱。
  - note：標題旁的補充（選填，例如載入狀態）。
  - equation：`activitySummaryEquation` 的結果。
  - size：`lg` 用於本月頁（主數字較大），`md` 用於交易頁精簡摘要。
  - unavailable：summary 尚未取得或載入失敗，金額一律顯示「—」。
  - excluded：「另有 … 未計入」的項目；空陣列時不顯示。
  - review／reviewActive／onShowReview：待確認筆數（0 不顯示）與套用篩選。
  - incompleteReasons：summary 不完整的中文原因；有值時顯示「資料不完整」。
-->
<script module lang="ts">
  import type { CashFlowEquation, CashFlowExcludedPart } from "./types";

  export interface CashFlowSummaryProps {
    title: string;
    note?: string;
    equation: CashFlowEquation;
    size?: "md" | "lg";
    unavailable?: boolean;
    excluded?: CashFlowExcludedPart[];
    review?: { count: number; amount: number };
    reviewActive?: boolean;
    onShowReview?: () => void;
    incompleteReasons?: string[];
  }
</script>

<script lang="ts">
  import { TriangleAlert } from "@lucide/svelte";
  import { formatCurrency } from "@/shared/format/financial";

  let {
    title,
    note,
    equation,
    size = "md",
    unavailable = false,
    excluded = [],
    review,
    reviewActive = false,
    onShowReview,
    incompleteReasons = [],
  }: CashFlowSummaryProps = $props();

  const missing = $derived(unavailable || equation.saved == null);
  const overspent = $derived(!missing && (equation.saved ?? 0) < 0);
  const drawsSavings = $derived(!missing && (equation.keptInAccounts ?? 0) < 0);
  const showReview = $derived(!unavailable && (review?.count ?? 0) > 0);
  const money = (value: number | null) =>
    unavailable || value == null ? "—" : formatCurrency(value);
  const abs = (value: number | null) =>
    value == null ? null : Math.abs(value);
  const termSize = $derived(
    size === "lg" ? "text-lg md:text-xl xl:text-2xl" : "text-base md:text-lg",
  );
  const savedSize = $derived(
    size === "lg" ? "text-2xl md:text-3xl" : "text-lg md:text-xl",
  );
</script>

<section class="grid min-w-0 gap-2" aria-label={title}>
  <div class="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3">
    <h2
      class={size === "lg"
        ? "text-base font-semibold"
        : "text-sm font-semibold"}
    >
      {title}
    </h2>
    {#if note}<p class="text-caption text-subtle">{note}</p>{/if}
  </div>

  <dl
    class="flex min-w-0 flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-4 sm:gap-y-1"
    aria-label="收入減消費等於存下來"
  >
    <div class="flex min-w-0 items-baseline gap-2">
      <span class="w-4 shrink-0 sm:hidden" aria-hidden="true"></span>
      <dt class="shrink-0 text-caption font-medium text-subtle">收入</dt>
      <dd
        data-testid="cash-flow-income"
        class={`truncate font-semibold tabular-nums tracking-tight text-moss ${termSize}`}
      >
        {money(equation.income)}
      </dd>
    </div>
    <div class="flex min-w-0 items-baseline gap-2">
      <span
        class="w-4 shrink-0 text-center text-lg font-semibold text-subtle sm:w-auto"
        aria-hidden="true">−</span
      >
      <dt class="shrink-0 text-caption font-medium text-subtle">消費</dt>
      <dd
        data-testid="cash-flow-spending"
        class={`truncate font-semibold tabular-nums tracking-tight text-coral ${termSize}`}
      >
        {money(equation.spending)}
      </dd>
    </div>
    <div class="flex min-w-0 items-baseline gap-2">
      <span
        class="w-4 shrink-0 text-center text-lg font-semibold text-subtle sm:w-auto"
        aria-hidden="true">＝</span
      >
      <dt
        class={`shrink-0 text-caption font-semibold ${overspent ? "text-coral" : "text-ink"}`}
      >
        {overspent ? "超支" : "存下來"}
      </dt>
      <dd
        data-testid="cash-flow-saved"
        class={`truncate font-semibold tabular-nums tracking-tight ${savedSize} ${overspent ? "text-coral" : "text-moss"}`}
      >
        {money(overspent ? abs(equation.saved) : equation.saved)}
      </dd>
    </div>
  </dl>

  <p
    data-testid="cash-flow-destination"
    class="ml-1 border-l-2 border-ink/10 pl-3 text-caption text-subtle sm:ml-0"
  >
    {#if !overspent}其中{/if}
    投資
    <span class="font-semibold tabular-nums text-ink"
      >{money(equation.investment)}</span
    >
    ／ {drawsSavings ? "動用存款" : "留在帳戶"}
    <span
      class={`font-semibold tabular-nums ${drawsSavings ? "text-coral" : "text-ink"}`}
      >{money(
        drawsSavings ? abs(equation.keptInAccounts) : equation.keptInAccounts,
      )}</span
    >
  </p>
  <p class="text-caption leading-5 text-subtle">
    投資是存下來的錢的去向，不是消費；轉到自己帳戶（例如轉到交割帳戶）不算投資，實際扣款買進才算。
  </p>

  {#if !unavailable && (excluded.length > 0 || showReview)}
    <p
      class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-caption text-subtle"
    >
      {#if excluded.length > 0}<span class="min-w-0"
          >另有 {#each excluded as part, index (part.key)}{#if index > 0}、{/if}{part.label}
            <span class="tabular-nums">{formatCurrency(part.amount)}</span
            >{/each} 未計入</span
        >{/if}
      {#if showReview && review}<button
          type="button"
          aria-pressed={reviewActive}
          class="inline-flex min-h-8 items-center gap-1 rounded-full bg-amber-100 px-2.5 font-semibold text-amber-900 hover:bg-amber-200 focus-visible:outline-2 focus-visible:outline-amber-600"
          onclick={onShowReview}
          >{review.count} 筆待確認（金額
          <span class="tabular-nums">{formatCurrency(review.amount)}</span
          >）</button
        >{/if}
    </p>
  {/if}
  {#if !unavailable && incompleteReasons.length > 0}
    <div
      role="status"
      class="flex min-w-0 items-start gap-2 rounded-lg border border-amber-200/80 bg-amber-50 px-3 py-2 text-caption text-amber-900"
    >
      <TriangleAlert class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <p class="min-w-0">
        <span class="font-semibold">資料不完整</span>：{incompleteReasons.join(
          "；",
        )}
      </p>
    </div>
  {/if}
</section>
