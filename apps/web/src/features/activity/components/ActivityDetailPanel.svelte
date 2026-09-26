<!--
  活動明細抽屜（手機全螢幕、桌面右側面板）：來源名稱、發票細項、分類、排除計算與發票配對入口。
  - item：目前檢視的活動；transaction／invoice：對應的銀行交易與發票（可能不存在）。
  - accountLabel：transaction 的機構／帳戶名稱（由頁面依帳戶資料決定）。
  - rates／exchangeRates：台幣換算匯率。
  - invoiceDetail／invoiceDetailPending／invoiceDetailFailed：發票細項查詢狀態。
  - categoryOptions：分類選項；calculationDisabled：排除計算切換進行中。
  - onClose：關閉明細；onCategoryChange：選擇新分類（頁面呼叫 categorize API）。
  - onCalculationChange：切換排除計算（頁面會還原 checkbox 狀態後再處理）。
  - onOpenMapping：開啟發票配對對話框。
  - duplicateTarget：重複活動併入的那筆（說明與名稱）；不是重複時省略。
  - onRoleChange：在「這筆是…」選擇角色（頁面呼叫角色 override API）。
  - onRoleReset：「恢復自動判斷」（刪除 override）。
  - roleUpdating／roleFailed：角色更新進行中／失敗。
  - onNoteSave：儲存備註（空字串刪除）；頁面依 noteTarget 決定寫到交易或發票。
  - foreignFee：國外交易服務費的說明（「屬於 ○○ 的國外交易服務費」）；不是服務費時省略。
  外幣發票的總額與品項以原幣顯示，總額另附台幣換算（`invoiceAmountText`）。
-->
<script module lang="ts">
  import type { EconomicRole } from "@taiwan-fin-hub/core";
  import type { ExchangeRateRow } from "@/data/assets/types";
  import type { BankTransactionRow } from "@/data/bank/types";
  import type { InvoiceRow, InvoiceSummaryRow } from "@/data/invoices/types";
  import type { ActivityItem } from "../model/types";
  import type { ActivityCategoryOption } from "@/data/activity/categories";

  export interface ActivityDetailPanelProps {
    item: ActivityItem;
    transaction?: BankTransactionRow;
    invoice?: InvoiceSummaryRow;
    accountLabel?: string;
    rates: Record<string, number>;
    exchangeRates?: ExchangeRateRow[];
    invoiceDetail?: InvoiceRow;
    invoiceDetailPending: boolean;
    invoiceDetailFailed: boolean;
    categoryOptions: ActivityCategoryOption[];
    calculationDisabled: boolean;
    onClose: () => void;
    onCategoryChange: (item: ActivityItem, categoryId: string) => void;
    onCalculationChange: (item: ActivityItem, event: Event) => void;
    onOpenMapping: (item: ActivityItem) => void;
    duplicateTarget?: { label: string; title?: string };
    onRoleChange: (item: ActivityItem, role: EconomicRole) => void;
    onRoleReset: (item: ActivityItem) => void;
    roleUpdating?: boolean;
    roleFailed?: boolean;
    onNoteSave: (item: ActivityItem, note: string) => Promise<unknown>;
    foreignFee?: string;
  }
</script>

<script lang="ts">
  import { ArrowLeft, X } from "@lucide/svelte";
  import Badge from "@/shared/ui/Badge.svelte";
  import Button from "@/shared/ui/Button.svelte";
  import Checkbox from "@/shared/ui/Checkbox.svelte";
  import Select from "@/shared/ui/Select.svelte";
  import ActivityAmount from "./ActivityAmount.svelte";
  import ActivityNoteField from "./ActivityNoteField.svelte";
  import {
    activityCategoryDisplay,
    categoryOptionText,
  } from "@/data/activity/categories";
  import {
    activityDisplayName,
    activityItemsSummary,
  } from "@/data/activity/names";
  import { activityDisplayAmount } from "../model/chart";
  import {
    activityInvoiceDifference,
    activityInvoiceTwd,
    invoiceAmountText,
    activitySourceLabel,
    bankTransactionMerchant,
  } from "../model/labels";
  import { formatActivityDate } from "../model/list";
  import { canCategorize } from "../model/categorize";
  import {
    ECONOMIC_ROLE_CHOICES,
    ECONOMIC_ROLE_CHOICE_LABELS,
    ECONOMIC_ROLE_LABELS,
    activityNoteTarget,
    activityRoleReasonLabel,
    activityRoleTarget,
    excludedStatusLabel,
    hasRoleOverride,
    isExcludedActivity,
    needsReview,
    showsRoleInsteadOfCategory,
    suggestsOwnAccount,
  } from "../model/roles";
  import {
    formatCurrency,
    formatCurrencyPrecise,
    formatNumber,
  } from "@/shared/format/financial";
  import { swipeBack } from "@/shared/actions/swipe-back";

  let {
    item,
    transaction,
    invoice,
    accountLabel,
    rates,
    exchangeRates,
    invoiceDetail,
    invoiceDetailPending,
    invoiceDetailFailed,
    categoryOptions,
    calculationDisabled,
    onClose,
    onCategoryChange,
    onCalculationChange,
    onOpenMapping,
    duplicateTarget,
    onRoleChange,
    onRoleReset,
    roleUpdating = false,
    roleFailed = false,
    onNoteSave,
    foreignFee,
  }: ActivityDetailPanelProps = $props();
  const invoiceCurrency = $derived(invoice?.currency ?? "TWD");
  const amount = $derived(activityDisplayAmount(item));
  const roleEditable = $derived(
    activityRoleTarget(item) != null && !item.duplicateOf,
  );
  const reviewing = $derived(needsReview(item));
  const roleReason = $derived(activityRoleReasonLabel(item));
  const excluded = $derived(isExcludedActivity(item));
  const noteTarget = $derived(activityNoteTarget(item));
  const ownNoteTarget = $derived(activityRoleTarget(item));
  // 備註存在配對的另一筆（交易↔發票）時標示共用。
  const noteShared = $derived(
    Boolean(
      item.noteTarget &&
      ownNoteTarget &&
      (item.noteTarget.kind !== ownNoteTarget.targetKind ||
        item.noteTarget.id !== ownNoteTarget.targetId),
    ),
  );
  const noteKey = $derived(`${item.source}-${item.id}`);
  const name = $derived(activityDisplayName(item));
  const itemsSummary = $derived(activityItemsSummary(item));
  const category = $derived(
    activityCategoryDisplay(item.categoryId, item.category, categoryOptions),
  );
  const categoryListed = $derived(
    categoryOptions.some((option) => option.id === category.id),
  );
</script>

<div class="fixed inset-0 z-[60] bg-ink/40 md:flex md:justify-end">
  <button
    aria-label="關閉活動明細"
    class="absolute inset-0 hidden md:block"
    onclick={onClose}
  ></button>
  <div
    aria-labelledby="activity-detail-title"
    aria-modal="true"
    class="relative flex h-full w-full flex-col overflow-hidden bg-white shadow-2xl md:max-w-[32rem]"
    role="dialog"
    use:swipeBack={{
      enabled: document.documentElement.classList.contains("is-standalone"),
      onBack: onClose,
    }}
  >
    <header
      class="flex shrink-0 items-center justify-between border-b border-ink/10 px-4 py-3 md:px-6"
    >
      <div class="flex min-w-0 items-center gap-2">
        <button
          aria-label="返回活動列表"
          class="flex size-11 shrink-0 items-center justify-center rounded-full text-subtle hover:bg-paper"
          onclick={onClose}
          ><ArrowLeft class="size-5 md:hidden" /><X
            class="hidden size-5 md:block"
          /></button
        >
        <h2 class="truncate text-lg font-semibold" id="activity-detail-title">
          活動明細
        </h2>
      </div>
      <span class="text-caption font-medium text-subtle"
        >{activitySourceLabel(item)}</span
      >
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto px-5 py-5 md:px-7 md:py-6">
      <section class="border-b border-ink/10 pb-5">
        <div
          class="flex flex-col items-start justify-between gap-4 sm:flex-row"
        >
          <div class="min-w-0">
            <h3 class="break-words text-xl font-semibold leading-snug">
              {name}
            </h3>
            {#if itemsSummary}<p
                class="mt-1 break-words text-sm text-subtle"
                data-activity-items
              >
                {itemsSummary}
              </p>{/if}
            <p class="mt-1 text-sm text-subtle">
              {formatActivityDate(item)}{#if transaction}
                · {accountLabel}
              {/if}
            </p>
          </div>
          <p
            class={`shrink-0 pt-1 text-lg font-bold tabular-nums ${excluded ? "text-subtle line-through" : (amount ?? 0) < 0 ? "text-coral" : item.source !== "invoice" ? "text-moss" : ""}`}
          >
            <ActivityAmount {item} {rates} {exchangeRates} detail />
          </p>
        </div>
        <Badge variant="secondary" class="mt-3"
          >{showsRoleInsteadOfCategory(item) && item.economicRole
            ? ECONOMIC_ROLE_LABELS[item.economicRole]
            : categoryOptionText(category)}</Badge
        >
        {#if item.economicRole === "excluded"}<Badge
            variant="secondary"
            class="ml-2 mt-3">{excludedStatusLabel(item)}</Badge
          >{:else if item.excludedFromCalculation}<Badge
            variant="secondary"
            class="ml-2 mt-3">已排除計算</Badge
          >{/if}
        {#if item.ownAccountTransfer}<Badge
            variant="secondary"
            class={`ml-2 mt-3 ${item.ownAccountTransfer.kind === "unsynced_card" ? "bg-amber-50 text-amber-800" : "bg-steel/10 text-steel"}`}
            >{item.ownAccountTransfer.marker}</Badge
          >{/if}
        {#if transaction && invoice && activityInvoiceDifference(item) > 0}<Badge
            variant="secondary"
            class="ml-2 mt-3 bg-amber-50 text-amber-800"
            >點數折抵 {formatCurrency(activityInvoiceDifference(item))}</Badge
          >{/if}
        {#if foreignFee}<p
            class="mt-3 text-caption font-medium text-steel"
            data-foreign-fee
          >
            {foreignFee}，分類沿用該筆消費
          </p>{/if}
      </section>

      {#if noteTarget}<section class="border-b border-ink/10 py-5">
          {#key noteKey}<ActivityNoteField
              note={item.note}
              shared={noteShared}
              label={name}
              onSave={(note) => onNoteSave(item, note)}
            />{/key}
        </section>{/if}

      {#if item.economicRole || item.duplicateOf}<section
          class="border-b border-ink/10 py-5"
          aria-labelledby="activity-role-title"
        >
          <div class="flex items-center justify-between gap-3">
            <h3 id="activity-role-title" class="text-base font-semibold">
              這筆是…
            </h3>
            {#if reviewing}<span
                class="rounded bg-amber-100 px-1.5 py-px text-caption font-semibold text-amber-900 ring-1 ring-amber-300"
                >待確認</span
              >{/if}
          </div>
          {#if item.duplicateOf}
            <p class="mt-2 text-sm">
              {duplicateTarget?.label ??
                "已併入另一筆活動"}{#if duplicateTarget?.title}「{duplicateTarget.title}」{/if}，金額以該筆為準，不重複計算。
            </p>
            {#if item.source === "invoice"}<p
                class="mt-1 text-caption text-subtle"
              >
                若這張發票不是那筆交易，請在下方「發票配對」選擇分開記錄。
              </p>{/if}
          {:else if roleEditable && item.economicRole}
            <div
              class="mt-3 flex flex-wrap gap-2"
              role="group"
              aria-label="選擇這筆活動的角色"
            >
              {#each ECONOMIC_ROLE_CHOICES as role (role)}
                {@const current = item.economicRole === role}
                <button
                  type="button"
                  aria-pressed={current}
                  disabled={roleUpdating || (current && !reviewing)}
                  class={`min-h-10 rounded-full border px-3 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-steel disabled:cursor-not-allowed ${current ? "border-ink bg-ink text-white disabled:opacity-100" : "border-input bg-background text-ink hover:bg-ink/5 disabled:opacity-50"}`}
                  onclick={() => onRoleChange(item, role)}
                  >{ECONOMIC_ROLE_CHOICE_LABELS[role]}</button
                >
              {/each}
            </div>
            {#if reviewing}<p class="mt-2 text-caption text-amber-900">
                系統無法確定這筆的角色，選擇後就會確認並重新計算本月收支。
              </p>{/if}
          {:else if item.economicRole}
            <p class="mt-2">
              <Badge variant="secondary"
                >{ECONOMIC_ROLE_LABELS[item.economicRole]}</Badge
              >
            </p>
          {/if}
          {#if roleReason}<p class="mt-3 text-caption text-subtle">
              判斷依據：{roleReason}
            </p>{/if}
          {#if roleEditable && hasRoleOverride(item)}<Button
              variant="outline"
              class="mt-3 h-10"
              disabled={roleUpdating}
              onclick={() => onRoleReset(item)}>恢復自動判斷</Button
            >{/if}
          {#if suggestsOwnAccount(item)}<p
              class="mt-3 rounded-xl bg-steel/10 p-3 text-caption text-ink"
            >
              如果對方{item.counterpartyAccount
                ? `（${item.counterpartyAccount.replace(/^[→←]\s*/, "")}）`
                : ""}是你自己的帳戶，可以加到<a
                class="font-semibold text-steel underline underline-offset-2"
                href="#/own-accounts">「我的其他帳戶」</a
              >，之後的轉帳會自動判斷為轉到自己帳戶。
            </p>{/if}
          {#if item.roleReason === "possible_unsynced_card"}<p
              class="mt-3 rounded-xl bg-steel/10 p-3 text-caption text-ink"
            >
              如果這是沒有同步的信用卡，可以在<a
                class="font-semibold text-steel underline underline-offset-2"
                href="#/own-accounts">「我的其他帳戶」</a
              >登記為未同步的卡片，繳款就會計為消費。
            </p>{/if}
          {#if roleFailed}<p role="alert" class="mt-3 text-sm text-coral">
              無法更新角色，請稍後再試。
            </p>{/if}
        </section>{/if}

      <section class="border-b border-ink/10 py-5">
        <h3 class="text-base font-semibold">來源名稱</h3>
        <div class="mt-3 grid gap-3">
          {#if name !== item.title}<p
              class="break-words text-caption text-subtle"
              data-activity-original-title
            >
              原始名稱：{item.title}
            </p>{/if}
          {#if transaction}<div class="rounded-xl bg-steel/10 p-4">
              <p class="text-caption font-semibold text-steel">
                銀行／信用卡原始名稱
              </p>
              <p class="mt-1 break-words font-semibold">
                {bankTransactionMerchant(transaction)}
              </p>
              {#if transaction.description && transaction.description !== bankTransactionMerchant(transaction)}<p
                  class="mt-1 break-words text-caption text-subtle"
                >
                  {transaction.description}
                </p>{/if}
              {#if item.counterpartyAccount}<p
                  class="mt-1 break-words text-caption text-subtle"
                >
                  對方帳戶 {item.counterpartyAccount}{#if item.ownAccountTransfer}
                    · 我的其他帳戶「{item.ownAccountTransfer.label}」{/if}
                </p>{/if}
              <p class="mt-1 text-caption text-subtle">
                {accountLabel} · 實付 {formatCurrency(
                  Math.abs(transaction.amount),
                  transaction.currency,
                )}
              </p>
            </div>{/if}
          {#if invoice}<div class="rounded-xl bg-coral/10 p-4">
              <p class="text-caption font-semibold text-coral">發票商家名稱</p>
              <p class="mt-1 break-words font-semibold">
                {invoice.sellerName ?? "電子發票"}
              </p>
              <p class="mt-1 text-caption text-subtle">
                發票 {invoice.invoiceNumber ?? "無發票號碼"} · 總額
                {invoiceAmountText(
                  invoice.amount,
                  invoice.currency,
                  activityInvoiceTwd(item),
                )}
              </p>
            </div>{/if}
          {#if !transaction && invoice}<div
              class="rounded-xl bg-amber-50 p-4 text-amber-900"
            >
              <p class="font-semibold">尚未找到銀行／信用卡交易</p>
              <p class="mt-1 text-caption text-subtle">
                仍會列入當月支出；你可以在下方手動配對。
              </p>
            </div>{/if}
          {#if !transaction && !invoice}<div class="rounded-xl bg-paper p-4">
              <p class="text-caption font-semibold text-subtle">來源說明</p>
              <p class="mt-1 break-words font-semibold">
                {item.subtitle || item.title}
              </p>
            </div>{/if}
        </div>
      </section>

      {#if invoice}<section class="border-b border-ink/10 py-5">
          <h3 class="text-base font-semibold">發票細項</h3>
          {#if invoiceDetailPending}<p
              class="mt-3 rounded-xl bg-paper p-4 text-sm text-subtle"
            >
              載入發票細項中。
            </p>{:else if invoiceDetailFailed}<p
              class="mt-3 rounded-xl bg-coral/10 p-4 text-sm text-coral"
            >
              無法載入發票細項，請稍後再試。
            </p>{:else if !invoiceDetail || invoiceDetail.items.length === 0}<p
              class="mt-3 rounded-xl bg-paper p-4 text-sm text-subtle"
            >
              此發票沒有品項明細。
            </p>{:else}<div class="mt-2 divide-y divide-ink/10">
              {#each invoiceDetail.items as line (line.id)}<div
                  class="flex items-start justify-between gap-4 py-3"
                >
                  <div class="min-w-0">
                    <p class="break-words font-medium">
                      {line.description}
                    </p>
                    <p class="mt-1 text-caption text-subtle">
                      {line.quantity != null
                        ? `${formatNumber(line.quantity)} 件`
                        : "數量未提供"}{line.unitPrice != null
                        ? ` × ${formatCurrencyPrecise(line.unitPrice, invoiceCurrency)}`
                        : ""}
                    </p>
                  </div>
                  <p class="shrink-0 font-semibold tabular-nums">
                    {formatCurrencyPrecise(line.amount, invoiceCurrency)}
                  </p>
                </div>{/each}
            </div>{/if}
        </section>{/if}

      <section class="py-5">
        <h3 class="text-base font-semibold">活動設定</h3>
        <div class="mt-2 divide-y divide-ink/10">
          <div class="flex items-center justify-between gap-4 py-4">
            <div>
              <p class="font-semibold">分類</p>
              {#if item.duplicateOf && canCategorize(item)}<p
                  class="mt-1 text-caption text-subtle"
                >
                  與配對的交易一起更新
                </p>{:else if !canCategorize(item)}<p
                  class="mt-1 text-caption text-subtle"
                >
                  此來源目前不支援調整
                </p>{/if}
            </div>
            {#if canCategorize(item)}<Select
                aria-label={`更新 ${name} 分類`}
                class="h-11 w-44 shrink-0 font-medium text-steel"
                value={category.id}
                onchange={(event: Event) =>
                  onCategoryChange(
                    item,
                    (event.currentTarget as HTMLSelectElement).value,
                  )}
                >{#if !categoryListed}<option value={category.id} disabled
                    >{categoryOptionText(category)}</option
                  >{/if}{#each categoryOptions as option (option.id)}<option
                    value={option.id}>{categoryOptionText(option)}</option
                  >{/each}</Select
              >{:else}<Badge variant="secondary"
                >{categoryOptionText(category)}</Badge
              >{/if}
          </div>

          {#if item.transactionId}<label
              class="flex cursor-pointer items-center justify-between gap-4 py-4"
            >
              <span>
                <span class="block font-semibold">排除統計計算</span>
                <span class="mt-1 block text-caption text-subtle"
                  >{item.ownAccountTransfer?.kind === "own_account"
                    ? "對方是「我的其他帳戶」，預設不計入收支；取消勾選即可改為計入"
                    : "保留活動，但不計入收支"}</span
                >
              </span>
              <Checkbox
                aria-label={`${item.excludedFromCalculation ? "恢復" : "排除"} ${name} 的統計計算`}
                checked={item.excludedFromCalculation}
                disabled={calculationDisabled}
                onchange={(event: Event) => onCalculationChange(item, event)}
              />
            </label>{/if}

          {#if invoice}<div
              class="flex items-center justify-between gap-4 py-4"
            >
              <div class="min-w-0">
                <p class="font-semibold">發票配對</p>
                <p
                  class={`mt-1 text-caption ${transaction ? "text-moss" : "text-coral"}`}
                >
                  {transaction ? "已配對，可變更或解除" : "尚未配對"}
                </p>
              </div>
              <Button
                class="h-11 shrink-0 whitespace-nowrap"
                variant={transaction ? "outline" : "default"}
                onclick={() => onOpenMapping(item)}
                >{transaction ? "管理配對" : "配對交易"}</Button
              >
            </div>{/if}
        </div>
      </section>
    </div>
  </div>
</div>
