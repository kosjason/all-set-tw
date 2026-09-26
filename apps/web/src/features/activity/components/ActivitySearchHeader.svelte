<!--
  搜尋模式的標題、排序說明與載入狀態（篩選條件已移到固定工具列）。
  - query：已送出的搜尋字串；sortMode：目前排序（決定說明文字）。
  - filling：正在載入搜尋批次。
-->
<script module lang="ts">
  import type { ActivitySortMode } from "../model/sort";

  export interface ActivitySearchHeaderProps {
    query: string;
    sortMode: ActivitySortMode;
    filling: boolean;
  }
</script>

<script lang="ts">
  import { activitySortLabel, DEFAULT_ACTIVITY_SORT } from "../model/sort";

  let { query, sortMode, filling }: ActivitySearchHeaderProps = $props();
</script>

<section
  class="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-ink/10 pb-3"
  aria-label="全歷史搜尋"
>
  <h2 class="min-w-0 break-words text-base font-semibold">
    搜尋「{query}」
  </h2>
  <p class="text-caption text-subtle">
    {sortMode === DEFAULT_ACTIVITY_SORT
      ? "所有已同步紀錄 · 日期由新到舊"
      : `所有已同步紀錄 · 已載入的活動依${activitySortLabel(sortMode)}排序`}
    {#if filling}<span role="status" class="ml-2">搜尋活動中…</span>{/if}
  </p>
</section>
