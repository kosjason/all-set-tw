<!--
  交易列表上方的固定（sticky）工具列。
  桌面（lg 以上）單列不換行：搜尋（至少 240px，其餘空間都給它）｜月份｜角色｜
  只看待確認｜「篩選」popover｜排序。分類、只看未分類與搜尋時間範圍屬次要篩選，
  收進「篩選」：md 以上為錨定在按鈕下方的 popover，手機為底部 sheet。
  手機的主要控制項為可水平捲動的一列。
  - searching：是否為全歷史搜尋模式（月份改為時間範圍）。
  - searchValue：搜尋框文字；onSearchInput／onSearchSubmit／onSearchClear：由頁面處理
    （輸入即篩選本月，Enter／「搜尋」查詢所有月份，清除返回月報）。
  - months／selectedMonth／onSelectMonth：月報模式的月份選擇。
  - view：目前的檢視狀態（篩選、排序）；onChange：回報要更新的欄位。
  - categories：分類選項；invalidDates：自訂日期區間錯誤。
  - reviewCount：本月待確認筆數（顯示在「只看待確認」旁；0 時不顯示數字）。
  - chips／onClearChip／onClearAll：已套用的篩選與清除動作。
-->
<script module lang="ts">
  import type { ActivityViewState } from "../model/url-state";
  import type {
    ActivityFilterChip,
    ActivityFilterChipKey,
  } from "../model/view-filters";

  export interface ActivityToolbarProps {
    searching: boolean;
    searchValue: string;
    onSearchInput: (value: string) => void;
    onSearchSubmit: () => void;
    onSearchClear: () => void;
    months: string[];
    selectedMonth: string;
    onSelectMonth: (month: string) => void;
    view: ActivityViewState;
    onChange: (patch: Partial<ActivityViewState>) => void;
    categories: { id: string; label: string }[];
    invalidDates?: boolean;
    reviewCount?: number;
    chips: ActivityFilterChip[];
    onClearChip: (key: ActivityFilterChipKey) => void;
    onClearAll: () => void;
  }
</script>

<script lang="ts">
  import { Search, SlidersHorizontal, X } from "@lucide/svelte";
  import Button from "@/shared/ui/Button.svelte";
  import Input from "@/shared/ui/Input.svelte";
  import Select from "@/shared/ui/Select.svelte";
  import ActivitySortSelect from "./ActivitySortSelect.svelte";
  import {
    ACTIVITY_EXTRA_CATEGORY_OPTIONS,
    ACTIVITY_ROLE_FILTER_LABELS,
    ACTIVITY_ROLE_FILTERS,
    ACTIVITY_SEARCH_TIME_LABELS,
  } from "../model/view-filters";
  import type {
    ActivityRoleFilter,
    ActivitySearchTime,
  } from "../model/url-state";
  import type { ActivitySortMode } from "../model/sort";

  let {
    searching,
    searchValue,
    onSearchInput,
    onSearchSubmit,
    onSearchClear,
    months,
    selectedMonth,
    onSelectMonth,
    view,
    onChange,
    categories,
    invalidDates = false,
    reviewCount = 0,
    chips,
    onClearChip,
    onClearAll,
  }: ActivityToolbarProps = $props();

  let filtersOpen = $state(false);
  const chipSelect =
    "h-10 w-auto shrink-0 rounded-full pr-8 text-caption font-semibold md:text-sm";
  const panelField = "h-11";
  const selectValue = (event: Event) =>
    (event.currentTarget as HTMLSelectElement).value;
  // 收在「篩選」裡的條件數，顯示在按鈕上。
  const secondaryCount = $derived(
    (view.categoryId ? 1 : 0) +
      (view.uncategorized ? 1 : 0) +
      (searching && view.time !== "all" ? 1 : 0),
  );

  function focusPanel(node: HTMLDivElement) {
    const previous = document.activeElement as HTMLElement | null;
    const elements = () => [
      ...node.querySelectorAll<HTMLElement>(
        "button:not(:disabled), select, input",
      ),
    ];
    elements()[0]?.focus();
    function trap(event: KeyboardEvent) {
      if (event.key === "Escape") {
        filtersOpen = false;
        return;
      }
      if (event.key !== "Tab") return;
      const targets = elements();
      const first = targets[0];
      const last = targets.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
    node.addEventListener("keydown", trap);
    return {
      destroy() {
        node.removeEventListener("keydown", trap);
        previous?.focus();
      },
    };
  }
</script>

{#snippet timeFields(className: string)}
  <Select
    aria-label="搜尋時間範圍"
    class={className}
    value={view.time}
    onchange={(event: Event) =>
      onChange({ time: selectValue(event) as ActivitySearchTime })}
    >{#each Object.entries(ACTIVITY_SEARCH_TIME_LABELS) as [id, label] (id)}<option
        value={id}>{label}</option
      >{/each}</Select
  >
  {#if view.time === "custom"}
    <Input
      aria-label="搜尋開始日期"
      type="date"
      class={`${className} min-w-0`}
      value={view.from}
      onchange={(event: Event) =>
        onChange({ from: (event.currentTarget as HTMLInputElement).value })}
      oninput={(event: Event) =>
        onChange({ from: (event.currentTarget as HTMLInputElement).value })}
    />
    <Input
      aria-label="搜尋結束日期"
      type="date"
      class={`${className} min-w-0`}
      value={view.to}
      onchange={(event: Event) =>
        onChange({ to: (event.currentTarget as HTMLInputElement).value })}
      oninput={(event: Event) =>
        onChange({ to: (event.currentTarget as HTMLInputElement).value })}
    />
  {/if}
{/snippet}

<div class="grid min-w-0 gap-2 py-2">
  <div
    data-testid="activity-toolbar-row"
    class="flex min-w-0 flex-col gap-2 lg:flex-row lg:flex-nowrap lg:items-center"
  >
    <form
      data-testid="activity-search-form"
      class="flex min-w-0 gap-2 lg:min-w-60 lg:flex-1"
      role="search"
      onsubmit={(event) => {
        event.preventDefault();
        onSearchSubmit();
      }}
    >
      <div class="relative min-w-0 flex-1">
        <Search
          class="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-subtle"
        />
        <Input
          type="search"
          aria-label="搜尋活動"
          aria-describedby="activity-search-hint"
          placeholder={searching
            ? "搜尋所有交易（含備註）"
            : "搜尋本月（含備註），Enter 搜尋全部"}
          class="h-10 rounded-full pl-9 pr-10 [&::-webkit-search-cancel-button]:appearance-none"
          value={searchValue}
          oninput={(event: Event) =>
            onSearchInput((event.currentTarget as HTMLInputElement).value)}
          oncompositionend={(event: Event) =>
            onSearchInput((event.currentTarget as HTMLInputElement).value)}
          maxlength={200}
        />
        {#if searchValue}<button
            type="button"
            aria-label="清空搜尋，返回月報"
            class="absolute right-0 top-0 flex size-10 items-center justify-center text-subtle"
            onclick={onSearchClear}><X class="size-4" /></button
          >{/if}
      </div>
      <Button type="submit" class="h-10 shrink-0 rounded-full px-4">搜尋</Button
      >
      <span id="activity-search-hint" class="sr-only"
        >可搜尋備註、名稱與品項；輸入時篩選本月交易，按 Enter
        或「搜尋」查詢所有月份</span
      >
    </form>

    <div
      data-testid="activity-toolbar-controls"
      class="no-scrollbar -mx-1 flex min-w-0 flex-nowrap items-center gap-2 overflow-x-auto px-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-0 lg:shrink-0 lg:flex-nowrap"
      role="group"
      aria-label="活動篩選與排序"
    >
      {#if !searching}
        <Select
          aria-label="選擇活動月份"
          class={chipSelect}
          value={selectedMonth}
          onchange={(event: Event) => onSelectMonth(selectValue(event))}
          >{#each months as month (month)}<option value={month}
              >{month.slice(0, 4)} 年 {Number(month.slice(5))} 月</option
            >{/each}</Select
        >
      {/if}
      <Select
        aria-label="活動角色"
        class={chipSelect}
        value={view.slice
          ? view.slice.flow === "expense"
            ? "spending"
            : "income"
          : view.role}
        onchange={(event: Event) =>
          onChange({
            role: selectValue(event) as ActivityRoleFilter,
            slice: null,
          })}
        >{#each ACTIVITY_ROLE_FILTERS as role (role)}<option value={role}
            >{ACTIVITY_ROLE_FILTER_LABELS[role]}</option
          >{/each}</Select
      >
      <button
        type="button"
        aria-pressed={view.review}
        class={`inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-caption font-semibold transition md:text-sm ${view.review ? "border-amber-700 bg-amber-700 text-white" : "border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100"}`}
        onclick={() => onChange({ review: !view.review })}
        >只看待確認{#if reviewCount > 0}<span
            class={`rounded-full px-1.5 text-[11px] leading-5 ${view.review ? "bg-white/20" : "bg-amber-200"}`}
            aria-label={`${reviewCount} 筆`}>{reviewCount}</span
          >{/if}</button
      >
      <div class="relative shrink-0">
        <Button
          variant="outline"
          class={`h-10 shrink-0 gap-1.5 rounded-full px-3 ${filtersOpen ? "border-ink" : ""}`}
          aria-haspopup="dialog"
          aria-expanded={filtersOpen}
          onclick={() => (filtersOpen = !filtersOpen)}
          ><SlidersHorizontal class="size-4" />篩選{#if secondaryCount}<span
              class="ml-0.5 rounded-full bg-ink px-1.5 text-[11px] leading-5 text-white"
              aria-hidden="true">{secondaryCount}</span
            >{/if}</Button
        >
        {#if filtersOpen}
          <button
            class="fixed inset-0 z-[69] bg-ink/40 md:bg-transparent"
            aria-label="關閉篩選"
            tabindex="-1"
            onclick={() => (filtersOpen = false)}
          ></button>
          <div
            use:focusPanel
            role="dialog"
            aria-modal="true"
            aria-label="活動篩選"
            tabindex="-1"
            class="fixed inset-x-0 bottom-0 z-[70] max-h-[85dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 pb-8 shadow-xl md:absolute md:inset-x-auto md:bottom-auto md:right-0 md:top-full md:mt-2 md:w-80 md:rounded-xl md:border md:border-ink/10 md:p-4"
          >
            <div class="mb-3 flex items-center justify-between">
              <h2 class="text-base font-semibold">篩選</h2>
              <Button
                variant="ghost"
                size="icon"
                aria-label="關閉篩選面板"
                onclick={() => (filtersOpen = false)}
                ><X class="size-5" /></Button
              >
            </div>
            <div class="grid grid-cols-1 gap-3">
              {#if searching}
                <div class="grid gap-1 text-caption text-subtle">
                  時間範圍{@render timeFields(panelField)}
                </div>
              {/if}
              <div class="grid gap-1 text-caption text-subtle">
                分類<Select
                  aria-label="活動分類"
                  class={panelField}
                  value={view.categoryId}
                  onchange={(event: Event) =>
                    onChange({ categoryId: selectValue(event) })}
                  ><option value="">全部分類</option
                  >{#each categories as option (option.id)}<option
                      value={option.id}>{option.label}</option
                    >{/each}{#each ACTIVITY_EXTRA_CATEGORY_OPTIONS as option (option.id)}<option
                      value={option.id}>{option.label}</option
                    >{/each}</Select
                >
              </div>
              <button
                type="button"
                aria-pressed={view.uncategorized}
                class={`h-11 rounded-lg border px-3 text-left text-sm font-semibold transition ${view.uncategorized ? "border-ink bg-ink text-white" : "border-input bg-background text-ink hover:bg-ink/5"}`}
                onclick={() => onChange({ uncategorized: !view.uncategorized })}
                >只看未分類</button
              >
            </div>
            <div class="mt-4 flex gap-2">
              {#if chips.length}<Button
                  variant="outline"
                  class="h-11 flex-1"
                  onclick={onClearAll}>清除全部</Button
                >{/if}
              <Button class="h-11 flex-1" onclick={() => (filtersOpen = false)}
                >查看結果</Button
              >
            </div>
          </div>
        {/if}
      </div>
      <ActivitySortSelect
        value={view.sort}
        onchange={(sort: ActivitySortMode) => onChange({ sort })}
      />
    </div>
  </div>

  {#if invalidDates}<p role="alert" class="text-sm text-coral">
      開始日期不得晚於結束日期。
    </p>{/if}

  {#if chips.length}
    <div
      class="no-scrollbar flex min-w-0 items-center gap-1.5 overflow-x-auto"
      aria-label="已套用的篩選"
      role="group"
    >
      {#each chips as chip (chip.key)}
        <button
          type="button"
          aria-label={`清除篩選：${chip.label}`}
          class="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-full bg-steel/10 px-3 text-caption font-semibold text-steel hover:bg-steel/15"
          onclick={() => onClearChip(chip.key)}
          >{chip.label}<X class="size-3.5" aria-hidden="true" /></button
        >
      {/each}
      {#if chips.length > 1}<button
          type="button"
          class="min-h-8 shrink-0 px-2 text-caption font-semibold text-subtle hover:text-ink"
          onclick={onClearAll}>清除全部</button
        >{/if}
    </div>
  {/if}
</div>
