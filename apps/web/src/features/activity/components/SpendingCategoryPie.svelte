<!--
  交易頁最上方的「消費分類」圓餅與圖例。資料為 summary `spendingByCategory` 轉成的
  8 類切片（顏色依分類固定、不依排名）。點選扇形或圖例篩選列表中該分類的消費，再點一次取消。
  - slices：`buildSpendingCategoryRanking` 的結果（已依金額排序）。
  - total：本月消費（summary 的 spending）。
  - selectedCategoryId：目前篩選的分類。
  - unavailable：summary 尚未取得或載入失敗。
  - onSelect：點選分類（傳回分類 id）。
-->
<script lang="ts">
  import { PieChart } from "layerchart";
  import {
    ChartContainer,
    ChartTooltip,
    type ChartConfig,
  } from "@/shared/ui/chart";
  import { formatCompactTwd, formatCurrency } from "@/shared/format/financial";
  import type { ActivityCategorySlice } from "@/data/activity/categories";

  let {
    slices,
    total,
    selectedCategoryId = "",
    unavailable = false,
    onSelect,
  }: {
    slices: ActivityCategorySlice[];
    total: number;
    selectedCategoryId?: string;
    unavailable?: boolean;
    onSelect: (categoryId: string) => void;
  } = $props();

  const chartConfig: ChartConfig = {
    default: { label: "金額", color: "#8f8e89" },
  };
  // 退款沖減後為負的分類無法畫成扇形，只列在圖例。
  const drawable = $derived(slices.filter((slice) => slice.amount > 0));
  const label = (slice: ActivityCategorySlice) =>
    `${slice.emoji ? `${slice.emoji} ` : ""}${slice.category}`;
</script>

{#snippet tooltip()}
  <ChartTooltip
    titleFormatter={(data) => {
      const slice = data as ActivityCategorySlice | undefined;
      return slice
        ? `${label(slice)} · ${slice.percentage.toFixed(1)}%`
        : "消費分類";
    }}
    valueFormatter={(value) => formatCurrency(Number(value))}
    hideItemLabel={true}
  />
{/snippet}

<section class="min-w-0 @container" aria-labelledby="transactions-category-pie">
  <div class="flex items-baseline justify-between gap-3">
    <h2 id="transactions-category-pie" class="text-base font-semibold">
      消費分類
    </h2>
    {#if !unavailable && slices.length}<span class="text-caption text-subtle"
        >點選分類篩選列表</span
      >{/if}
  </div>
  {#if unavailable}
    <p class="mt-3 text-caption text-subtle">月收支摘要尚未載入。</p>
  {:else if slices.length === 0}
    <p class="mt-3 text-caption text-subtle">這個月還沒有消費。</p>
  {:else}
    <div
      class="mt-3 grid min-w-0 gap-4 @md:grid-cols-[160px_minmax(0,1fr)] @md:items-center"
    >
      <div class="relative mx-auto size-40">
        <ChartContainer config={chartConfig} class="size-40 min-h-40">
          <PieChart
            data={drawable}
            key="categoryId"
            label="category"
            value="amount"
            c="color"
            innerRadius={0.62}
            cornerRadius={3}
            padAngle={0.025}
            {tooltip}
            onArcClick={(_, detail) =>
              onSelect((detail.data as ActivityCategorySlice).categoryId)}
            props={{ arc: { stroke: "var(--color-paper)", strokeWidth: 2 } }}
          />
        </ChartContainer>
        <div
          class="pointer-events-none absolute left-1/2 top-1/2 z-10 flex size-24 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full"
        >
          <span class="text-xs font-semibold text-subtle">消費</span>
          <span class="mt-0.5 text-sm font-semibold tabular-nums"
            >{formatCompactTwd(total, 1)}</span
          >
        </div>
      </div>
      <ul class="grid min-w-0 gap-1 @lg:grid-cols-2" aria-label="消費分類圖例">
        {#each slices as slice (slice.categoryId)}
          <li class="min-w-0">
            <button
              type="button"
              aria-pressed={selectedCategoryId === slice.categoryId}
              class={`grid min-h-10 w-full min-w-0 grid-cols-[12px_minmax(0,1fr)_auto] items-center gap-2 rounded-sm px-1.5 text-left transition ${selectedCategoryId === slice.categoryId ? "bg-ink/5 shadow-[inset_3px_0_0_var(--color-steel)]" : "hover:bg-ink/3"}`}
              onclick={() => onSelect(slice.categoryId)}
            >
              <span
                class="size-2.5 rounded-full"
                style={`background-color:${slice.color}`}
                aria-hidden="true"
              ></span>
              <span class="truncate text-sm font-semibold">{label(slice)}</span>
              <span class="text-right text-caption tabular-nums">
                <span class="font-medium">{formatCurrency(slice.amount)}</span>
                <span class="ml-1 text-subtle"
                  >{slice.percentage.toFixed(0)}%</span
                >
              </span>
            </button>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</section>
