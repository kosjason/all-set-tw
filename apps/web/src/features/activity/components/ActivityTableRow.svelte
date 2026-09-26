<!--
  桌面版活動表格列：日期｜商家／說明｜帳戶｜分類｜金額｜狀態。
  商家欄的按鈕是開啟明細的鍵盤入口；滑鼠點列上其他地方也會開啟明細，
  分類 chip 則直接改分類、不開明細。被排除計算的活動以淡色與刪除線標示，重複
  （已併入另一筆）的活動淡化並標示併入對象。角色不是消費的活動（收入、投資、
  轉到自己帳戶、繳卡費）分類欄改為角色 chip，可直接改角色；待確認的消費在商家欄
  下方可直接選角色。
  - item：活動；date／time：日期欄的日期與時刻（無時刻時省略）。商家欄主標為
    `displayName`（沒有才用原始標題），發票與已配對發票的交易在下方列前 3 個品項。
  - duplicateLabel：重複活動的併入說明（例如「已併入信用卡交易」）。
  - query／searching：搜尋關鍵字標示與命中文字顯示。
  - rates／exchangeRates：台幣換算匯率。
  - categoryOptions／onCategoryChange／categoryDisabled：列上改分類。
  - onRoleChange／roleDisabled：待確認活動列上選角色（未提供時不顯示選單）。
  - onOpen：開啟活動明細。
  有備註時在名稱下方顯示一行「📝 備註」（截斷，完整內容在 title 與明細）。
-->
<script module lang="ts">
  import type { EconomicRole } from "@taiwan-fin-hub/core";
  import type { ExchangeRateRow } from "@/data/assets/types";
  import type { ActivityCategoryOption } from "@/data/activity/categories";
  import type { ActivityItem } from "../model/types";

  export interface ActivityTableRowProps {
    item: ActivityItem;
    date: string;
    time?: string;
    duplicateLabel?: string;
    /** 國外交易服務費的說明（「屬於 ○○ 的國外交易服務費」）。 */
    foreignFee?: string;
    query: string;
    searching: boolean;
    rates: Record<string, number>;
    exchangeRates?: ExchangeRateRow[];
    categoryOptions: ActivityCategoryOption[];
    onCategoryChange: (item: ActivityItem, categoryId: string) => void;
    categoryDisabled?: boolean;
    onRoleChange?: (item: ActivityItem, role: EconomicRole) => void;
    roleDisabled?: boolean;
    onOpen: (item: ActivityItem) => void;
  }
</script>

<script lang="ts">
  import Badge from "@/shared/ui/Badge.svelte";
  import ActivityAmount from "./ActivityAmount.svelte";
  import ActivityCategoryCell from "./ActivityCategoryCell.svelte";
  import ActivityCounterparty from "./ActivityCounterparty.svelte";
  import ActivityRoleCell from "./ActivityRoleCell.svelte";
  import ActivityRoleBadges from "./ActivityRoleBadges.svelte";
  import ActivityRoleSelect from "./ActivityRoleSelect.svelte";
  import SearchHighlight from "./SearchHighlight.svelte";
  import { activityDisplayAmount } from "../model/chart";
  import { activityInvoiceDifference } from "../model/labels";
  import {
    activityAccountLines,
    activityRoleTarget,
    excludedStatusLabel,
    isExcludedActivity,
    needsReview,
    showsRoleInsteadOfCategory,
  } from "../model/roles";
  import { activityStatusLabel } from "../model/list";
  import { formatCurrency } from "@/shared/format/financial";
  import {
    activityDisplayName,
    activityItemsSummary,
  } from "@/data/activity/names";

  let {
    item,
    date,
    time,
    duplicateLabel,
    foreignFee,
    query,
    searching,
    rates,
    exchangeRates,
    categoryOptions,
    onCategoryChange,
    categoryDisabled = false,
    onRoleChange,
    roleDisabled = false,
    onOpen,
  }: ActivityTableRowProps = $props();
  const amount = $derived(activityDisplayAmount(item));
  const excluded = $derived(isExcludedActivity(item));
  const duplicate = $derived(Boolean(item.duplicateOf));
  const account = $derived(activityAccountLines(item));
  const roleInCategory = $derived(showsRoleInsteadOfCategory(item));
  // 分類欄已是角色 chip 時，待確認直接在那裡選；否則在商家欄下方另給選單。
  const canChooseRole = $derived(
    Boolean(onRoleChange) &&
      needsReview(item) &&
      !roleInCategory &&
      activityRoleTarget(item) != null,
  );
  const name = $derived(activityDisplayName(item));
  const itemsSummary = $derived(activityItemsSummary(item));
  const searchHit = $derived(
    searching &&
      Boolean(query) &&
      Boolean(item.searchText?.toLowerCase().includes(query.toLowerCase())) &&
      !name.toLowerCase().includes(query.toLowerCase()),
  );

  function openFromRow(event: MouseEvent) {
    // 分類選單與明細按鈕各自處理點擊。
    if ((event.target as Element).closest("button, select, a, input")) return;
    onOpen(item);
  }
</script>

<!-- 列點擊只是滑鼠捷徑；鍵盤由商家欄的明細按鈕開啟。 -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<tr
  class={`group cursor-pointer align-middle transition hover:bg-ink/3 ${excluded || duplicate ? "bg-ink/[0.025] text-subtle" : ""} ${duplicate ? "opacity-70" : ""}`}
  data-excluded={excluded ? "true" : undefined}
  data-duplicate={duplicate ? "true" : undefined}
  data-review={needsReview(item) ? "true" : undefined}
  onclick={openFromRow}
>
  <td class="py-1.5 pr-3 text-caption tabular-nums text-subtle">
    <span class="block whitespace-nowrap font-medium text-ink/80">{date}</span>
    {#if time}<span class="block">{time}</span>{/if}
  </td>
  <td class="min-w-0 py-1.5 pr-3">
    <button
      type="button"
      aria-label={`查看 ${name} 活動詳情`}
      class={`block max-w-full truncate rounded-sm text-left text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-steel ${excluded ? "line-through decoration-ink/40" : duplicate ? "" : "text-ink"}`}
      onclick={() => onOpen(item)}
    >
      <SearchHighlight text={name} {query} />
    </button>
    {#if itemsSummary}<p
        class="mt-0.5 truncate text-caption text-subtle"
        data-activity-items
      >
        <SearchHighlight text={itemsSummary} {query} />
      </p>{/if}
    {#if item.note}<p
        class="mt-0.5 truncate text-caption text-subtle"
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
        class="mt-0.5 truncate text-caption text-subtle"
        data-foreign-fee
      >
        {foreignFee}
      </p>{/if}
    <ActivityCounterparty {item} class="mt-0.5" />
    {#if canChooseRole && onRoleChange}
      <div class="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
        <ActivityRoleBadges {item} {duplicateLabel} includeRole={false} />
        <ActivityRoleSelect
          {item}
          {onRoleChange}
          disabled={roleDisabled}
          class="[&_select]:h-8"
        />
      </div>
    {:else}
      <ActivityRoleBadges
        {item}
        {duplicateLabel}
        includeRole={false}
        class="mt-0.5"
      />
    {/if}
    {#if searchHit}
      <p class="mt-0.5 truncate text-caption text-subtle">
        <SearchHighlight text={item.searchText ?? ""} {query} />
      </p>
    {/if}
    {#if item.transactionId && item.invoiceId && activityInvoiceDifference(item) > 0}<Badge
        variant="secondary"
        class="mt-0.5 bg-amber-50 text-amber-800"
        >點數折抵 {formatCurrency(activityInvoiceDifference(item))}</Badge
      >{/if}
  </td>
  <td class="min-w-0 py-1.5 pr-3">
    <p class="truncate text-caption font-medium text-ink/80">
      {account.primary}
    </p>
    {#if account.secondary}<p class="truncate text-caption text-subtle">
        {account.secondary}
      </p>{/if}
  </td>
  <td class="min-w-0 py-1.5 pr-3">
    {#if roleInCategory}
      <ActivityRoleCell {item} {onRoleChange} disabled={roleDisabled} />
    {:else}
      <ActivityCategoryCell
        {item}
        {categoryOptions}
        {onCategoryChange}
        disabled={categoryDisabled}
      />
    {/if}
  </td>
  <td class="py-1.5 pr-3 text-right">
    <div
      class={`whitespace-nowrap text-sm font-semibold tabular-nums ${excluded ? "text-subtle line-through" : duplicate ? "text-subtle" : (amount ?? 0) < 0 ? "text-coral" : item.source !== "invoice" ? "text-moss" : ""}`}
    >
      <ActivityAmount {item} {rates} {exchangeRates} />
    </div>
  </td>
  <td class="py-1.5 text-caption text-subtle">
    <span class="block truncate">{activityStatusLabel(item)}</span>
    {#if duplicate}<span class="block truncate font-medium">不重複計算</span
      >{:else if excluded}<span class="block truncate font-medium"
        >{excludedStatusLabel(item)}</span
      >{/if}
  </td>
</tr>
