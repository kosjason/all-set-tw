<!--
  消費分類排行（水平長條）：資料為 summary `spendingByCategory`（8 個消費分類，沒有子類、
  不需展開），每列為「emoji 名稱」，顏色沿用 `ACTIVITY_CATEGORY_COLOR_BY_ID`（「其他」「未分類」
  為中性灰，靠文字辨識）。點選一列導向交易頁的該分類消費。
-->
<script lang="ts">
  import { ChevronRight } from "@lucide/svelte";
  import type { ActivityCategorySlice } from "@/data/activity/categories";
  import { formatCurrency } from "@/shared/format/financial";

  let {
    ranking,
    total,
    unavailable = false,
    onSelect,
  }: {
    ranking: (ActivityCategorySlice & { barPercent: number })[];
    total: number;
    unavailable?: boolean;
    onSelect: (categoryId: string) => void;
  } = $props();
</script>

<section class="min-w-0" aria-labelledby="month-category-ranking">
  <div class="flex items-baseline justify-between gap-3">
    <h2 id="month-category-ranking" class="text-base font-semibold">
      消費分類
    </h2>
    {#if !unavailable && ranking.length}<span
        class="text-caption text-subtle tabular-nums"
        >共 {formatCurrency(total)}</span
      >{/if}
  </div>
  {#if unavailable}
    <p class="mt-3 text-caption text-subtle">月收支摘要尚未載入。</p>
  {:else if ranking.length === 0}
    <p class="mt-3 text-caption text-subtle">這個月還沒有消費。</p>
  {:else}
    <ol class="mt-3 grid gap-1" aria-label="消費分類排行">
      {#each ranking as slice (slice.categoryId)}
        <li>
          <button
            type="button"
            class="group grid w-full min-w-0 grid-cols-[minmax(4.5rem,7rem)_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-ink/4"
            aria-label={`${slice.category} ${formatCurrency(slice.amount)}，查看交易`}
            onclick={() => onSelect(slice.categoryId)}
          >
            <span class="truncate text-sm font-medium" data-category-name
              >{#if slice.emoji}<span aria-hidden="true">{slice.emoji}</span>
              {/if}{slice.category}</span
            >
            <span class="h-2.5 min-w-0 overflow-hidden rounded-full bg-ink/6">
              <span
                data-testid="category-bar"
                class="block h-full rounded-full"
                style={`width:${slice.barPercent}%;background-color:${slice.color}`}
              ></span>
            </span>
            <span class="flex items-center gap-1 text-sm tabular-nums">
              <span class="font-semibold">{formatCurrency(slice.amount)}</span>
              <span
                class="hidden w-10 text-right text-caption text-subtle sm:inline"
                >{Math.round(slice.percentage)}%</span
              >
              <ChevronRight
                class="size-3.5 text-subtle transition group-hover:translate-x-0.5"
              />
            </span>
          </button>
        </li>
      {/each}
    </ol>
  {/if}
</section>
