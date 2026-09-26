<!--
  列表上的分類 chip：「🍜 餐飲」。可改分類的活動（銀行／信用卡交易、發票，見 `canCategorize`）
  是單層的原生 select（8 個消費分類與自訂分類，鍵盤與螢幕閱讀器可直接操作），選擇後交給
  頁面呼叫 categorize API；投資等不可改分類的活動只顯示標籤。分類是自動套用的建議
  （`categorySource = auto_suggestion`）時，chip 右上角加小圓點（不佔寬度，文字供輔助技術）。
  - item：活動；categoryOptions：`spendingCategoryOptions` 的結果。
  - onCategoryChange：選擇新分類。
  - disabled：分類更新進行中時停用。
-->
<script module lang="ts">
  import type { ActivityCategoryOption } from "@/data/activity/categories";
  import type { ActivityItem } from "../model/types";

  export interface ActivityCategoryCellProps {
    item: ActivityItem;
    categoryOptions: ActivityCategoryOption[];
    onCategoryChange: (item: ActivityItem, categoryId: string) => void;
    disabled?: boolean;
  }
</script>

<script lang="ts">
  import { ChevronDown } from "@lucide/svelte";
  import {
    activityCategoryDisplay,
    categoryOptionText,
  } from "@/data/activity/categories";
  import { activityDisplayName } from "@/data/activity/names";
  import { canCategorize } from "../model/categorize";
  import { UNCATEGORIZED_CATEGORY_ID } from "../model/view-filters";

  let {
    item,
    categoryOptions,
    onCategoryChange,
    disabled = false,
  }: ActivityCategoryCellProps = $props();

  const current = $derived(
    activityCategoryDisplay(item.categoryId, item.category, categoryOptions),
  );
  // 目前分類不在選單內（未分類、收入子類、舊資料）時以停用的選項顯示。
  const listed = $derived(
    categoryOptions.some((option) => option.id === current.id),
  );
  const uncategorized = $derived(current.id === UNCATEGORIZED_CATEGORY_ID);
  const automatic = $derived(item.categorySource === "auto_suggestion");

  function change(event: Event) {
    const select = event.currentTarget as HTMLSelectElement;
    const next = select.value;
    // 等 API 成功、列表重新載入後才顯示新分類；先把選單還原成目前分類。
    select.value = current.id;
    if (next && next !== current.id) onCategoryChange(item, next);
  }
</script>

<span class="inline-flex max-w-full items-center gap-1.5">
  {#if canCategorize(item)}
    <span class="relative inline-flex min-w-0 max-w-full">
      <select
        aria-label={`變更「${activityDisplayName(item)}」的分類`}
        title="變更分類"
        data-category-chip={current.id}
        class={`h-10 min-w-[6.5rem] max-w-full cursor-pointer appearance-none truncate rounded-full border py-0 pl-3 pr-7 text-caption font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-steel disabled:cursor-not-allowed disabled:opacity-50 ${uncategorized ? "border-dashed border-amber-400 bg-amber-50 text-amber-900 hover:bg-amber-100" : "border-transparent bg-ink/5 text-ink hover:bg-ink/10"}`}
        value={current.id}
        {disabled}
        onchange={change}
      >
        {#if !listed}<option value={current.id} disabled
            >{categoryOptionText(current)}</option
          >{/if}
        {#each categoryOptions as option (option.id)}<option value={option.id}
            >{categoryOptionText(option)}</option
          >{/each}
      </select>
      <ChevronDown
        class="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-subtle"
        aria-hidden="true"
      />
      {#if automatic}<span
          class="absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-paper bg-steel"
          title="依商家或品項自動分類，改一次就會記住"
          data-category-auto><span class="sr-only">自動分類</span></span
        >{/if}
    </span>
  {:else}
    <span
      data-category-chip={current.id}
      class="inline-flex max-w-full items-center truncate rounded-full bg-ink/5 px-2.5 py-0.5 text-caption font-semibold text-ink"
      >{categoryOptionText(current)}</span
    >
  {/if}
  {#if automatic && !canCategorize(item)}<span
      class="shrink-0 text-caption text-subtle/80"
      title="依商家或品項自動分類"
      data-category-auto>自動</span
    >{/if}
</span>
