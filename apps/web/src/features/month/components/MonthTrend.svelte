<!--
  近 6 月「收入／消費」趨勢：每月兩根長條並排，下方列出收入、消費與存下來
  （負數為超支）。數字來自 summary（months=6）。早於銀行同步範圍的月份只有部分
  資料，不畫長條、不顯示金額。點選月份切換本月頁月份。
-->
<script lang="ts">
  import { formatCompactTwd } from "@/shared/format/financial";
  import { trendBarHeight, type MonthTrendPoint } from "../model/month";

  let {
    points,
    selectedMonth,
    unavailable = false,
    onSelectMonth,
  }: {
    points: MonthTrendPoint[];
    selectedMonth: string;
    unavailable?: boolean;
    onSelectMonth: (month: string) => void;
  } = $props();

  const visible = (point: MonthTrendPoint) =>
    !point.noData && !point.outsideSyncWindow;
  const maxAmount = $derived(
    Math.max(
      ...points.flatMap((point) =>
        visible(point) ? [point.income, point.spending] : [],
      ),
      1,
    ),
  );
  const amount = (value: number) => formatCompactTwd(value, 1);
</script>

<section class="min-w-0" aria-labelledby="month-trend">
  <div class="flex items-baseline justify-between gap-3">
    <h2 id="month-trend" class="text-base font-semibold">近 6 個月收支</h2>
    <span class="text-caption text-subtle"
      ><span class="text-moss">■</span> 收入　<span class="text-coral">■</span> 消費</span
    >
  </div>
  {#if unavailable}
    <p class="mt-3 text-caption text-subtle">月收支摘要尚未載入。</p>
  {:else}
    <div class="mt-3 grid grid-cols-6 gap-1">
      {#each points as point (point.month)}
        <button
          type="button"
          aria-pressed={selectedMonth === point.month}
          aria-label={visible(point)
            ? `${Number(point.month.slice(5))} 月：收入 ${amount(point.income)}、消費 ${amount(point.spending)}、${point.saved < 0 ? "超支" : "存下來"} ${amount(Math.abs(point.saved))}`
            : `${Number(point.month.slice(5))} 月：資料不完整`}
          class={`grid min-h-11 min-w-0 justify-items-center px-0.5 pb-2 pt-2 text-center transition ${selectedMonth === point.month ? "bg-ink/4 shadow-[inset_0_-2px_0_var(--color-steel)]" : "hover:bg-ink/3"}`}
          onclick={() => onSelectMonth(point.month)}
        >
          <div class="flex h-24 w-full items-end justify-center gap-1">
            {#if visible(point)}
              <span
                class="w-1/3 rounded-t-sm bg-moss"
                style={`height:${trendBarHeight(point.income, maxAmount)}%`}
              ></span><span
                class="w-1/3 rounded-t-sm bg-coral"
                style={`height:${trendBarHeight(point.spending, maxAmount)}%`}
              ></span>
            {/if}
          </div>
          <span
            class={`mt-2 w-full text-caption font-semibold ${visible(point) ? "" : "text-subtle"}`}
            >{Number(point.month.slice(5))} 月{#if point.incomplete && visible(point)}<span
                class="text-amber-700"
                title="此月份資料不完整">*</span
              >{/if}</span
          >
          {#if point.noData}
            <span class="mt-1 w-full truncate text-caption text-subtle"
              >尚無資料</span
            >
          {:else if point.outsideSyncWindow}
            <span
              class="mt-1 w-full text-caption leading-snug text-subtle"
              title="銀行只同步最近 3 個月，這個月只有部分發票或刷卡資料"
              >資料<br />不完整</span
            >
          {:else}
            <span
              class="mt-1 w-full truncate text-caption tabular-nums text-moss"
              ><span class="hidden sm:inline">收 </span>{amount(
                point.income,
              )}</span
            ><span class="w-full truncate text-caption tabular-nums text-coral"
              ><span class="hidden sm:inline">支 </span>{amount(
                point.spending,
              )}</span
            ><span
              class={`w-full truncate text-caption font-semibold tabular-nums ${point.saved < 0 ? "text-coral" : "text-ink"}`}
              >{point.saved < 0 ? "超支" : "存"}
              {amount(Math.abs(point.saved))}</span
            >
          {/if}
        </button>
      {/each}
    </div>
  {/if}
</section>
