<!--
  活動清單本體：手機版依日期分組的列表，桌面版（md 以上）為單一表格，
  表頭固定於工具列下方，「日期」「金額」欄標題可切換排序（與工具列共用排序值）。
  - sections／grouped：頁面依排序建立的清單檢視（grouped 時手機列只顯示時刻）。
  - emptyMessage：沒有活動時顯示的文字（由頁面依搜尋與載入狀態決定）。
  - searching／query：搜尋模式與關鍵字（日期加年份、關鍵字標示）。
  - rates／exchangeRates：台幣換算匯率。
  - sortMode／onSortChange：目前排序與表頭切換排序。
  - categoryOptions／onCategoryChange／categoryDisabled：桌面表格上直接改分類。
  - duplicateLabel：重複活動的併入說明（由頁面依已載入活動找出併入對象）。
  - onRoleChange／roleDisabled：待確認活動列上直接選角色。
  - onOpen：開啟活動明細。
-->
<script module lang="ts">
  import type { EconomicRole } from "@taiwan-fin-hub/core";
  import type { ExchangeRateRow } from "@/data/assets/types";
  import type { ActivityCategoryOption } from "@/data/activity/categories";
  import type { ActivityListSection, ActivitySortMode } from "../model/sort";
  import type { ActivityItem } from "../model/types";

  export interface ActivityListProps {
    sections: ActivityListSection[];
    grouped: boolean;
    emptyMessage: string;
    searching: boolean;
    query: string;
    rates: Record<string, number>;
    exchangeRates?: ExchangeRateRow[];
    sortMode: ActivitySortMode;
    onSortChange: (mode: ActivitySortMode) => void;
    categoryOptions: ActivityCategoryOption[];
    onCategoryChange: (item: ActivityItem, categoryId: string) => void;
    categoryDisabled?: boolean;
    duplicateLabel?: (item: ActivityItem) => string | undefined;
    /** 國外交易服務費的說明（「屬於 ○○ 的國外交易服務費」）。 */
    feeLabel?: (item: ActivityItem) => string | undefined;
    onRoleChange?: (item: ActivityItem, role: EconomicRole) => void;
    roleDisabled?: boolean;
    onOpen: (item: ActivityItem) => void;
  }
</script>

<script lang="ts">
  import { ArrowDown, ArrowUp, ArrowUpDown } from "@lucide/svelte";
  import ActivityListRow from "./ActivityListRow.svelte";
  import ActivityTableRow from "./ActivityTableRow.svelte";
  import {
    activityDateKey,
    formatActivityDate,
    formatActivityDateGroup,
    formatActivityTime,
  } from "../model/list";
  import {
    activitySortDirection,
    toggleActivitySort,
    type ActivitySortColumn,
  } from "../model/sort";

  let {
    sections,
    grouped,
    emptyMessage,
    searching,
    query,
    rates,
    exchangeRates,
    sortMode,
    onSortChange,
    categoryOptions,
    onCategoryChange,
    categoryDisabled = false,
    duplicateLabel,
    feeLabel,
    onRoleChange,
    roleDisabled = false,
    onOpen,
  }: ActivityListProps = $props();

  const rows = $derived(sections.flatMap((section) => section.items));

  function mobileTime(item: ActivityItem) {
    if (grouped) return formatActivityTime(item);
    const dateKey = activityDateKey(item);
    const date = formatActivityDate(item);
    return searching && dateKey ? `${dateKey.slice(0, 4)} 年 ${date}` : date;
  }

  function tableDate(item: ActivityItem) {
    const match = activityDateKey(item).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return "—";
    const [, year, month, day] = match;
    const short = `${Number(month)}/${Number(day)}`;
    return searching ? `${year}/${short}` : short;
  }

  const columnLabel: Record<ActivitySortColumn, string> = {
    date: "日期",
    amount: "金額",
  };
</script>

{#snippet sortHeader(column: ActivitySortColumn, className: string)}
  {@const direction = activitySortDirection(sortMode, column)}
  <th scope="col" aria-sort={direction} class={className}>
    <button
      type="button"
      title={`依${columnLabel[column]}排序`}
      class={`inline-flex min-h-10 items-center gap-1 rounded-sm font-semibold hover:text-ink focus-visible:outline-2 focus-visible:outline-steel ${direction ? "text-ink" : ""}`}
      onclick={() => onSortChange(toggleActivitySort(sortMode, column))}
      >{columnLabel[column]}{#if direction === "ascending"}<ArrowUp
          class="size-3.5"
          aria-hidden="true"
        />{:else if direction === "descending"}<ArrowDown
          class="size-3.5"
          aria-hidden="true"
        />{:else}<ArrowUpDown
          class="size-3.5 opacity-50"
          aria-hidden="true"
        />{/if}</button
    >
  </th>
{/snippet}

<div class="min-w-0">
  <div class="min-w-0 md:hidden">
    {#if sections.length === 0}<p class="p-8 text-center text-sm text-subtle">
        {emptyMessage}
      </p>{:else}
      {#each sections as group (group.key)}{#if group.dateKey != null}<div
            class="flex items-center justify-between border-t border-ink/8 pb-1 pt-2.5 text-caption"
          >
            <span class="font-semibold text-subtle"
              >{searching
                ? `${group.dateKey.slice(0, 4)} 年 `
                : ""}{formatActivityDateGroup(group.dateKey)}</span
            ><span class="text-subtle">{group.items.length} 筆</span>
          </div>{/if}
        <div
          class={`divide-y divide-ink/8 ${group.dateKey == null ? "border-t border-ink/8" : ""}`}
        >
          {#each group.items as item (item.source + "-" + item.id)}
            <ActivityListRow
              {item}
              time={mobileTime(item)}
              duplicateLabel={duplicateLabel?.(item)}
              foreignFee={feeLabel?.(item)}
              {onRoleChange}
              {roleDisabled}
              {query}
              {searching}
              {rates}
              {exchangeRates}
              {onOpen}
            />{/each}
        </div>{/each}{/if}
  </div>
  <div class="hidden md:block">
    <table class="w-full table-fixed text-left text-sm">
      <colgroup
        ><col class={searching ? "w-24" : "w-14"} /><col /><col
          class="w-28 2xl:w-40"
        /><col class="w-28 2xl:w-36" /><col class="w-28 2xl:w-36" /><col
          class="w-16 2xl:w-20"
        /></colgroup
      >
      <thead
        class="sticky top-[calc(var(--app-sticky-top,0px)_+_var(--activity-toolbar-height,0px))] z-10 border-b border-ink/10 bg-paper text-caption text-subtle xl:top-[var(--activity-toolbar-height,0px)]"
      >
        <tr>
          {@render sortHeader("date", "pr-3")}
          <th scope="col" class="pr-3 font-semibold">商家／說明</th>
          <th scope="col" class="pr-3 font-semibold">帳戶</th>
          <th scope="col" class="pr-3 font-semibold">分類</th>
          {@render sortHeader("amount", "pr-3 text-right")}
          <th scope="col" class="font-semibold">狀態</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-ink/8">
        {#if rows.length === 0}
          <tr
            ><td colspan="6" class="p-8 text-center text-sm text-subtle"
              >{emptyMessage}</td
            ></tr
          >
        {:else}
          {#each rows as item (item.source + "-" + item.id)}<ActivityTableRow
              {item}
              date={tableDate(item)}
              time={formatActivityTime(item)}
              duplicateLabel={duplicateLabel?.(item)}
              foreignFee={feeLabel?.(item)}
              {onRoleChange}
              {roleDisabled}
              {query}
              {searching}
              {rates}
              {exchangeRates}
              {categoryOptions}
              {onCategoryChange}
              {categoryDisabled}
              {onOpen}
            />{/each}
        {/if}
      </tbody>
    </table>
  </div>
</div>
