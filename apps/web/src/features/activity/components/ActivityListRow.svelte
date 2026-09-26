<!--
  手機版活動列（按鈕，點擊開啟明細）。三行：商家＋金額、對方帳戶與角色標記、
  時間・銀行・帳戶・分類（角色不是消費時改為角色）與狀態。被排除計算的活動以淡色與
  刪除線標示；重複（已併入另一筆）的活動淡化並標示併入對象。待確認的活動在按鈕
  下方另有角色選單（select 不能放在按鈕內）。
  - item：活動；time：列上顯示的時間或日期（分組時為時刻，平鋪時含日期；無時刻時省略）。
  - duplicateLabel：重複活動的併入說明。
  - query：搜尋字串，用於標示關鍵字；searching：是否為搜尋模式（決定是否顯示命中的其他文字）。
  - rates／exchangeRates：台幣換算匯率。
  - onRoleChange／roleDisabled：待確認活動選角色（未提供時不顯示選單）。
  - onOpen：開啟活動明細。
  有備註時在名稱下方顯示一行「📝 備註」（截斷）。
-->
<script module lang="ts">
  import type { EconomicRole } from "@taiwan-fin-hub/core";
  import type { ExchangeRateRow } from "@/data/assets/types";
  import type { ActivityItem } from "../model/types";

  export interface ActivityListRowProps {
    item: ActivityItem;
    time?: string;
    duplicateLabel?: string;
    /** 國外交易服務費的說明（「屬於 ○○ 的國外交易服務費」）。 */
    foreignFee?: string;
    query: string;
    searching: boolean;
    rates: Record<string, number>;
    exchangeRates?: ExchangeRateRow[];
    onRoleChange?: (item: ActivityItem, role: EconomicRole) => void;
    roleDisabled?: boolean;
    onOpen: (item: ActivityItem) => void;
  }
</script>

<script lang="ts">
  import ActivityAmount from "./ActivityAmount.svelte";
  import SearchHighlight from "./SearchHighlight.svelte";
  import ActivityCounterparty from "./ActivityCounterparty.svelte";
  import ActivityRoleBadges from "./ActivityRoleBadges.svelte";
  import ActivityRoleSelect from "./ActivityRoleSelect.svelte";
  import { activityDisplayAmount } from "../model/chart";
  import { activityStatusLabel } from "../model/list";
  import {
    ECONOMIC_ROLE_LABELS,
    activityAccountLines,
    activityRoleTarget,
    excludedStatusLabel,
    isExcludedActivity,
    needsReview,
    showsRoleInsteadOfCategory,
  } from "../model/roles";
  import { isUncategorizedActivity } from "../model/view-filters";
  import {
    activityCategoryDisplay,
    categoryOptionText,
  } from "@/data/activity/categories";
  import {
    activityDisplayName,
    activityItemsSummary,
  } from "@/data/activity/names";

  let {
    item,
    time,
    duplicateLabel,
    foreignFee,
    query,
    searching,
    rates,
    exchangeRates,
    onRoleChange,
    roleDisabled = false,
    onOpen,
  }: ActivityListRowProps = $props();
  const amount = $derived(activityDisplayAmount(item));
  const excluded = $derived(isExcludedActivity(item));
  const duplicate = $derived(Boolean(item.duplicateOf));
  const account = $derived(activityAccountLines(item));
  const meta = $derived(
    [time, account.primary, account.secondary].filter(Boolean),
  );
  const roleInCategory = $derived(
    showsRoleInsteadOfCategory(item) && Boolean(item.economicRole),
  );
  // 分類顯示「🍜 餐飲」；角色不是消費時改顯示角色。
  const categoryLabel = $derived(
    roleInCategory && item.economicRole
      ? ECONOMIC_ROLE_LABELS[item.economicRole]
      : categoryOptionText(
          activityCategoryDisplay(item.categoryId, item.category, []),
        ),
  );
  const name = $derived(activityDisplayName(item));
  const itemsSummary = $derived(activityItemsSummary(item));
  const canChooseRole = $derived(
    Boolean(onRoleChange) &&
      needsReview(item) &&
      activityRoleTarget(item) != null,
  );
</script>

<div
  class={`min-w-0 ${excluded || duplicate ? "bg-ink/[0.025] text-subtle" : ""} ${duplicate ? "opacity-70" : ""}`}
  data-duplicate={duplicate ? "true" : undefined}
  data-review={needsReview(item) ? "true" : undefined}
>
  <button
    aria-label={`查看 ${name} 活動詳情`}
    class="flex min-h-[52px] w-full min-w-0 items-center gap-3 py-2 text-left transition hover:bg-ink/3"
    onclick={() => onOpen(item)}
  >
    <div class="min-w-0 flex-1">
      <p
        class={`truncate text-sm font-semibold ${excluded ? "line-through decoration-ink/40" : ""}`}
      >
        <SearchHighlight text={name} {query} />
      </p>
      {#if itemsSummary}<p
          class="truncate text-caption text-subtle"
          data-activity-items
        >
          <SearchHighlight text={itemsSummary} {query} />
        </p>{/if}
      {#if item.note}<p
          class="truncate text-caption text-subtle"
          data-activity-note
          title={item.note}
        >
          <span aria-hidden="true">📝</span>
          <span class="sr-only">備註：</span><SearchHighlight
            text={item.note}
            {query}
          />
        </p>{/if}
      {#if foreignFee}<p
          class="truncate text-caption text-subtle"
          data-foreign-fee
        >
          {foreignFee}
        </p>{/if}
      <ActivityCounterparty {item} />
      <ActivityRoleBadges
        {item}
        {duplicateLabel}
        includeRole={false}
        class="mt-0.5"
      />
      {#if searching && item.searchText
          ?.toLowerCase()
          .includes(query.toLowerCase()) && !name
          .toLowerCase()
          .includes(query.toLowerCase())}
        <p class="truncate text-caption text-subtle">
          <SearchHighlight text={item.searchText} {query} />
        </p>
      {/if}
      <p class="truncate text-caption text-subtle">
        {#each meta as part, index (index)}{#if index > 0}<span
              aria-hidden="true">{" · "}</span
            >{/if}<span class={index === 0 && time ? "tabular-nums" : ""}
            >{part}</span
          >{/each}
      </p>
    </div>
    <div class="max-w-[42vw] shrink-0 text-right">
      <p
        class={`truncate text-sm font-semibold tabular-nums ${excluded ? "text-subtle line-through" : duplicate ? "text-subtle" : (amount ?? 0) < 0 ? "text-coral" : item.source !== "invoice" ? "text-moss" : ""}`}
      >
        <ActivityAmount {item} {rates} {exchangeRates} />
      </p>
      <p class="truncate text-caption text-subtle">
        <span
          class={`rounded px-1 ${isUncategorizedActivity(item) ? "bg-amber-50 text-amber-900" : ""}`}
          data-category-label>{categoryLabel}</span
        >{#if !roleInCategory && item.categorySource === "auto_suggestion"}<span
            class="ml-1 text-subtle/80"
            data-category-auto>自動</span
          >{/if}
        · {duplicate
          ? "不重複計算"
          : excluded
            ? excludedStatusLabel(item) === "不計入收支"
              ? "不計入"
              : excludedStatusLabel(item)
            : activityStatusLabel(item)}
      </p>
    </div>
  </button>
  {#if canChooseRole && onRoleChange}
    <div class="flex min-w-0 items-center gap-2 pb-2">
      <span class="text-caption text-subtle">這筆是</span>
      <ActivityRoleSelect {item} {onRoleChange} disabled={roleDisabled} />
    </div>
  {/if}
</div>
