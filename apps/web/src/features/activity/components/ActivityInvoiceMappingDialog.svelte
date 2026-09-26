<!--
  發票配對對話框：管理既有配對、選擇同日候選交易、確認合併。
  - invoice：要配對的發票；step：目前步驟（actions／candidates／confirm）。
  - selectedTransactionId／selectedTransaction：目前選取的交易（id 與完整資料）。
  - candidates：頁面算好的前後數日候選交易；accountLabel：交易的機構／帳戶名稱。
  - linking／separating：配對或解除進行中；failed：配對或解除失敗。
  - onClose：關閉；onStepChange：切換步驟；onChooseTransaction：選取候選交易。
  - onConfirm：確認配對指定交易；onSeparate：解除並保持分開。
  - invoiceAmountTwd：外幣發票的台幣換算值（顯示「US$10.98（≈NT$356）」）；台幣發票省略。
-->
<script module lang="ts">
  import type { BankTransactionRow } from "@/data/bank/types";
  import type { InvoiceSummaryRow } from "@/data/invoices/types";

  export type ActivityInvoiceMappingStep = "candidates" | "confirm" | "actions";

  export interface ActivityInvoiceMappingDialogProps {
    invoice: InvoiceSummaryRow;
    step: ActivityInvoiceMappingStep;
    selectedTransactionId?: string;
    selectedTransaction?: BankTransactionRow;
    candidates: BankTransactionRow[];
    accountLabel: (transaction: BankTransactionRow) => string;
    linking: boolean;
    separating: boolean;
    failed: boolean;
    onClose: () => void;
    onStepChange: (step: ActivityInvoiceMappingStep) => void;
    onChooseTransaction: (transactionId: string) => void;
    onConfirm: (transactionId: string) => void;
    onSeparate: () => void;
    invoiceAmountTwd?: number | null;
  }
</script>

<script lang="ts">
  import { ArrowDown, Link2, Unlink2, X } from "@lucide/svelte";
  import Badge from "@/shared/ui/Badge.svelte";
  import Button from "@/shared/ui/Button.svelte";
  import {
    bankTransactionMerchant,
    invoiceAmountText,
    invoiceTransactionDifference,
  } from "../model/labels";
  import {
    invoiceTransactionDayGap,
    INVOICE_MATCH_DAY_WINDOW,
  } from "@/data/activity/matching";
  import { formatCurrency, formatDate } from "@/shared/format/financial";

  let {
    invoice,
    invoiceAmountTwd,
    step,
    selectedTransactionId,
    selectedTransaction,
    candidates,
    accountLabel,
    linking,
    separating,
    failed,
    onClose,
    onStepChange,
    onChooseTransaction,
    onConfirm,
    onSeparate,
  }: ActivityInvoiceMappingDialogProps = $props();
</script>

<div
  aria-modal="true"
  class="fixed inset-0 z-[75] flex items-end bg-ink/45 md:items-center md:justify-center md:p-6"
  role="dialog"
>
  <div
    class="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl md:max-w-xl md:rounded-2xl md:p-6"
  >
    <div class="mx-auto mb-4 h-1.5 w-14 rounded-full bg-ink/20 md:hidden"></div>
    <div class="flex items-start justify-between gap-4">
      <div class="min-w-0">
        <h2 class="text-xl font-semibold">
          {step === "actions"
            ? "管理配對"
            : step === "confirm"
              ? "確認合併這兩筆？"
              : "選擇候選交易"}
        </h2>
        {#if step === "candidates"}<p class="mt-1 truncate text-sm text-subtle">
            發票：{invoice.sellerName ?? "電子發票"} ·
            {invoiceAmountText(
              invoice.amount,
              invoice.currency,
              invoiceAmountTwd,
            )}
          </p>{:else if step === "confirm"}<p class="mt-1 text-sm text-subtle">
            合併後活動只顯示一筆，支出採銀行／信用卡實付金額。
          </p>{/if}
      </div>
      <button
        aria-label="關閉配對視窗"
        class="flex size-11 shrink-0 items-center justify-center rounded-full text-subtle hover:bg-paper"
        onclick={onClose}><X class="size-5" /></button
      >
    </div>

    {#if step === "actions"}
      {@const transaction = selectedTransaction}
      {#if transaction}<div
          class="mt-5 rounded-xl border border-steel/30 bg-steel/5 p-4"
        >
          <div class="flex items-start justify-between gap-4">
            <div class="min-w-0">
              <p class="truncate font-semibold">
                {invoice.sellerName ?? "電子發票"}
              </p>
              <p class="mt-1 truncate text-caption text-subtle">
                信用卡＋發票 · {invoice.invoiceNumber ?? "無發票號碼"}
              </p>
            </div>
            <p class="shrink-0 font-semibold text-coral">
              {formatCurrency(-Math.abs(transaction.amount))}
            </p>
          </div>
          {#if invoiceTransactionDifference(invoice, transaction) > 0}<Badge
              variant="secondary"
              class="mt-3 bg-amber-50 text-amber-800"
              >點數折抵 {formatCurrency(
                invoiceTransactionDifference(invoice, transaction),
              )}</Badge
            >{/if}
        </div>{/if}
      <div class="mt-5 grid gap-3">
        <Button
          class="h-12 justify-start gap-3"
          variant="outline"
          onclick={() => onStepChange("candidates")}
          ><Link2 class="size-4 text-steel" />變更配對</Button
        >
        <Button
          class="h-12 justify-start gap-3 text-coral"
          disabled={separating}
          variant="outline"
          onclick={onSeparate}
          ><Unlink2 class="size-4" />{separating
            ? "解除中…"
            : "解除並保持分開"}</Button
        >
      </div>
    {:else if step === "candidates"}
      <div class="mt-5 grid max-h-[52vh] gap-3 overflow-y-auto pr-1">
        {#if candidates.length === 0}<div
            class="rounded-xl border border-dashed border-ink/15 bg-paper p-6 text-center"
          >
            <p class="font-semibold">
              前後 {INVOICE_MATCH_DAY_WINDOW} 天沒有可配對的支出
            </p>
            <p class="mt-1 text-caption text-subtle">
              只有發票日期前後 {INVOICE_MATCH_DAY_WINDOW} 天內的 TWD 銀行或信用卡支出會列在這裡。
            </p>
          </div>{:else}{#each candidates as transaction (transaction.id)}{@const difference =
              invoiceTransactionDifference(
                invoice,
                transaction,
              )}{@const dayGap = invoiceTransactionDayGap(
              invoice,
              transaction,
            )}<button
              aria-pressed={selectedTransactionId === transaction.id}
              class={`min-h-24 rounded-xl border p-4 text-left transition ${selectedTransactionId === transaction.id ? "border-steel bg-steel/10 ring-2 ring-steel/15" : "border-ink/10 hover:border-steel/40 hover:bg-paper"}`}
              onclick={() => onChooseTransaction(transaction.id)}
            >
              <span class="flex items-start justify-between gap-3">
                <span class="min-w-0">
                  <span class="block truncate font-semibold"
                    >{bankTransactionMerchant(transaction)}</span
                  >
                  <span class="mt-1 block truncate text-caption text-subtle"
                    >{accountLabel(transaction)} · {formatDate(
                      transaction.authorizedAt ?? transaction.postedDate ?? "",
                    )}</span
                  >
                </span>
                <span class="shrink-0 font-semibold text-coral"
                  >{formatCurrency(-Math.abs(transaction.amount))}</span
                >
              </span>
              <span class="mt-3 flex flex-wrap items-center gap-2">
                {#if dayGap === 0}<Badge
                    variant="secondary"
                    class="bg-moss/10 text-moss">同一天</Badge
                  >{:else if dayGap != null}<Badge
                    variant="secondary"
                    class="bg-steel/10 text-steel">相差 {dayGap} 天</Badge
                  >{/if}
                {#if difference > 0}<Badge
                    variant="secondary"
                    class="bg-amber-50 text-amber-800"
                    >差額 {formatCurrency(difference)}</Badge
                  >{/if}
              </span>
            </button>{/each}{/if}
      </div>
      <p class="mt-4 text-caption text-subtle">
        依金額接近與日期相近排序；商家名稱可能因支付工具而不同，最後由你決定。
      </p>
      <div class="mt-5 grid grid-cols-[7rem_1fr] gap-3">
        <Button class="h-12" variant="secondary" onclick={onClose}>取消</Button
        ><Button
          class="h-12"
          disabled={!selectedTransactionId}
          onclick={() => onStepChange("confirm")}>下一步</Button
        >
      </div>
    {:else}
      {@const transaction = selectedTransaction}
      {#if transaction}{@const difference = invoiceTransactionDifference(
          invoice,
          transaction,
        )}
        <div class="mt-5 grid gap-3">
          <div class="rounded-xl bg-coral/10 p-4">
            <p class="text-caption font-semibold text-coral">發票</p>
            <div class="mt-2 flex items-center justify-between gap-4">
              <p class="truncate font-semibold">
                {invoice.sellerName ?? "電子發票"}
              </p>
              <p class="shrink-0 font-semibold">
                {invoiceAmountText(
                  invoice.amount,
                  invoice.currency,
                  invoiceAmountTwd,
                )}
              </p>
            </div>
          </div>
          <ArrowDown class="mx-auto size-5 text-steel" />
          <div class="rounded-xl bg-steel/10 p-4">
            <p class="text-caption font-semibold text-steel">銀行／信用卡</p>
            <div class="mt-2 flex items-center justify-between gap-4">
              <p class="truncate font-semibold">
                {bankTransactionMerchant(transaction)}
              </p>
              <p class="shrink-0 font-semibold">
                {formatCurrency(Math.abs(transaction.amount))}
              </p>
            </div>
          </div>
          {#if difference > 0}<div
              class="rounded-xl bg-amber-50 p-4 text-amber-900"
            >
              <p class="font-semibold">
                差額 {formatCurrency(difference)}
              </p>
              <p class="mt-1 text-caption text-subtle">
                可能來自 LINE Pay 點數或其他折抵
              </p>
            </div>{/if}
          <p class="text-caption text-subtle">
            當月支出將計入 {formatCurrency(
              Math.abs(transaction.amount),
            )}，發票資料保留在合併紀錄中。
          </p>
        </div>
        <div class="mt-5 grid grid-cols-[7rem_1fr] gap-3">
          <Button
            class="h-12"
            variant="secondary"
            onclick={() => onStepChange("candidates")}>返回</Button
          ><Button
            class="h-12"
            disabled={linking}
            onclick={() => onConfirm(transaction.id)}
            >{linking ? "配對中…" : "確認配對"}</Button
          >
        </div>
      {:else}<p class="mt-5 text-sm text-coral">
          找不到選取的交易，請返回重新選擇。
        </p>{/if}
    {/if}

    {#if failed}<p class="mt-4 text-sm font-medium text-coral">
        無法更新配對，資料可能已變更，請重新整理後再試。
      </p>{/if}
  </div>
</div>
