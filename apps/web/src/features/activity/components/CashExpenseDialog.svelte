<!--
  記一筆／編輯現金支出：金額、分類（單層消費分類）、日期與選填說明。
  現金支出先從同月（不夠再扣上個月）尚未細分的提款扣，把提款拆成實際分類；扣不到的部分才
  另外計入消費。
  - expense：編輯時的原始值；沒有時為新增。
  - categoryOptions：消費分類選單（與列表的分類選單相同）。
  - defaultDate：新增時預設日期；maxDate：最晚可選的日期（台北今天）。
  - submitting／deleting：送出／刪除中；errorMessage：失敗訊息。
  - onCancel：關閉；onSubmit：送出正規化後的輸入；onDelete：編輯時刪除這筆。
  - frequent／onQuickAdd：新增時在金額上方列出「常用」（最近記過的說明＋金額＋分類），
    點一下即以目前選的日期直接記一筆，不必再填表。
-->
<script module lang="ts">
  import type { FrequentCashExpense } from "@taiwan-fin-hub/shared";
  import type { ActivityCategoryOption } from "@/data/activity/categories";

  export interface CashExpenseDraft {
    date: string;
    amount: number;
    categoryId: string;
    description: string | null;
  }

  export interface CashExpenseDialogProps {
    expense?: CashExpenseDraft & { id: string };
    categoryOptions: readonly ActivityCategoryOption[];
    defaultDate: string;
    maxDate: string;
    submitting?: boolean;
    deleting?: boolean;
    errorMessage?: string;
    onCancel: () => void;
    onSubmit: (input: CashExpenseDraft) => void;
    onDelete?: () => void;
    frequent?: readonly FrequentCashExpense[];
    onQuickAdd?: (input: CashExpenseDraft) => void;
  }
</script>

<script lang="ts">
  import { untrack } from "svelte";
  import {
    CASH_EXPENSE_AMOUNT_MAX,
    CASH_EXPENSE_DESCRIPTION_MAX,
  } from "@taiwan-fin-hub/shared";
  import Button from "@/shared/ui/Button.svelte";
  import { formatCurrency } from "@/shared/format/financial";

  let {
    expense,
    categoryOptions,
    defaultDate,
    maxDate,
    submitting = false,
    deleting = false,
    errorMessage = "",
    onCancel,
    onSubmit,
    onDelete,
    frequent = [],
    onQuickAdd,
  }: CashExpenseDialogProps = $props();

  const initial = untrack(() => expense);
  let amountText = $state(initial ? String(initial.amount) : "");
  let categoryId = $state(initial?.categoryId ?? "");
  let date = $state(initial?.date ?? untrack(() => defaultDate));
  let description = $state(initial?.description ?? "");
  let confirmingDelete = $state(false);
  let amountField = $state<HTMLInputElement>();
  let titleField = $state<HTMLHeadingElement>();
  // 開啟時已有「常用」就不自動聚焦金額（手機不會一打開就跳出鍵盤擋住常用），改聚焦標題，
  // 讓焦點進到對話框裡。
  const focusAmount = untrack(
    () => Boolean(expense) || !onQuickAdd || frequent.length === 0,
  );
  $effect(() => {
    if (focusAmount) amountField?.focus();
    else titleField?.focus();
  });

  // 只接受整數元；允許輸入千分位逗號與全形數字。
  const amount = $derived.by(() => {
    const digits = amountText.normalize("NFKC").replace(/[,\s]/gu, "");
    if (!/^\d+$/u.test(digits)) return undefined;
    const value = Number(digits);
    return value >= 1 && value <= CASH_EXPENSE_AMOUNT_MAX ? value : undefined;
  });
  const amountInvalid = $derived(amountText.trim() !== "" && amount == null);
  const dateInvalid = $derived(!date || date > maxDate);
  const busy = $derived(submitting || deleting);
  const canSubmit = $derived(
    amount != null && Boolean(categoryId) && !dateInvalid && !busy,
  );

  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!canSubmit || amount == null) return;
    onSubmit({
      date,
      amount,
      categoryId,
      description: description.trim() || null,
    });
  }

  const showFrequent = $derived(
    !expense && Boolean(onQuickAdd) && frequent.length > 0,
  );
  /** 選的日期不是今天時，「常用」標題提示會記在哪一天（例如 9/30）。 */
  const quickDateHint = $derived(
    date && date !== maxDate
      ? `記在 ${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`
      : "",
  );
  function categoryEmoji(id: string) {
    return categoryOptions.find((option) => option.id === id)?.emoji ?? "";
  }
  function quickAdd(preset: FrequentCashExpense) {
    if (busy || dateInvalid) return;
    onQuickAdd?.({
      date,
      amount: preset.amount,
      categoryId: preset.categoryId,
      description: preset.description,
    });
  }

  function keydown(event: KeyboardEvent) {
    if (event.key === "Escape" && !busy) onCancel();
  }
</script>

<svelte:window onkeydown={keydown} />

<div
  aria-modal="true"
  aria-labelledby="cash-expense-title"
  class="fixed inset-0 z-[70] flex items-end bg-ink/45 md:items-center md:justify-center md:p-6"
  role="dialog"
>
  <form
    class="max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl md:max-w-md md:rounded-2xl md:p-6"
    onsubmit={submit}
    data-testid="cash-expense-dialog"
  >
    <h2
      id="cash-expense-title"
      bind:this={titleField}
      tabindex="-1"
      class="text-lg font-semibold focus:outline-none"
    >
      {expense ? "編輯現金支出" : "記一筆現金支出"}
    </h2>
    <p class="mt-1 text-sm text-subtle">
      先從這個月（不夠再扣上個月）還沒細分的提款扣，把提款拆成實際分類；沒有提款可扣時才另外計入消費。
    </p>

    {#if showFrequent}
      <section class="mt-4" aria-labelledby="cash-expense-frequent-title">
        <h3 id="cash-expense-frequent-title" class="text-sm font-semibold">
          常用<span class="ml-2 font-normal text-subtle"
            >點一下直接記{quickDateHint ? `（${quickDateHint}）` : ""}</span
          >
        </h3>
        <div
          class="mt-2 flex flex-wrap gap-2"
          data-testid="cash-expense-frequent"
        >
          {#each frequent as preset (`${preset.description}\u0000${preset.amount}\u0000${preset.categoryId}`)}
            <button
              type="button"
              class="flex min-h-11 items-center gap-1.5 rounded-full border border-ink/15 bg-paper px-3 text-sm font-medium transition hover:border-ink/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-steel disabled:opacity-50"
              aria-label={`記一筆 ${preset.description} ${formatCurrency(preset.amount)}`}
              disabled={busy || dateInvalid}
              onclick={() => quickAdd(preset)}
              >{#if categoryEmoji(preset.categoryId)}<span aria-hidden="true"
                  >{categoryEmoji(preset.categoryId)}</span
                >{/if}<span class="max-w-40 truncate">{preset.description}</span
              ><span class="tabular-nums text-subtle"
                >{formatCurrency(preset.amount)}</span
              ></button
            >
          {/each}
        </div>
      </section>
    {/if}

    <label class="mt-4 block text-sm font-semibold" for="cash-expense-amount"
      >{showFrequent ? "或輸入金額" : "金額"}</label
    >
    <div class="relative mt-2">
      <span
        class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-subtle"
        >NT$</span
      >
      <input
        id="cash-expense-amount"
        bind:this={amountField}
        bind:value={amountText}
        inputmode="numeric"
        autocomplete="off"
        placeholder="0"
        aria-invalid={amountInvalid}
        aria-describedby={amountInvalid
          ? "cash-expense-amount-error"
          : undefined}
        class="h-11 w-full rounded-xl border border-input bg-background pl-12 pr-3 text-base tabular-nums placeholder:text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-steel"
      />
    </div>
    {#if amountInvalid}<p
        id="cash-expense-amount-error"
        class="mt-1 text-caption text-coral"
      >
        請輸入 1 到 1,000 萬之間的整數金額。
      </p>{/if}

    <fieldset class="mt-4">
      <legend class="text-sm font-semibold">分類</legend>
      <div class="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
        {#each categoryOptions as option (option.id)}
          <label
            class={`flex min-h-11 cursor-pointer items-center justify-center gap-1 rounded-xl border px-2 text-center text-sm font-medium transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-steel ${categoryId === option.id ? "border-ink bg-ink text-white" : "border-ink/15 hover:border-ink/40"}`}
          >
            <input
              type="radio"
              name="cash-expense-category"
              value={option.id}
              bind:group={categoryId}
              class="sr-only"
            />
            {#if option.emoji}<span aria-hidden="true">{option.emoji}</span
              >{/if}<span class="truncate">{option.label}</span>
          </label>
        {/each}
      </div>
    </fieldset>

    <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div>
        <label class="block text-sm font-semibold" for="cash-expense-date"
          >日期</label
        >
        <input
          id="cash-expense-date"
          type="date"
          bind:value={date}
          max={maxDate}
          required
          class="mt-2 h-11 w-full rounded-xl border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-steel"
        />
      </div>
      <div>
        <label
          class="block text-sm font-semibold"
          for="cash-expense-description">說明（選填）</label
        >
        <input
          id="cash-expense-description"
          bind:value={description}
          maxlength={CASH_EXPENSE_DESCRIPTION_MAX}
          autocomplete="off"
          placeholder="例如：夜市、菜市場"
          class="mt-2 h-11 w-full rounded-xl border border-input bg-background px-3 text-sm placeholder:text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-steel"
        />
      </div>
    </div>

    {#if errorMessage}<p role="alert" class="mt-3 text-sm text-coral">
        {errorMessage}
      </p>{/if}

    {#if confirmingDelete}
      <div
        class="mt-4 rounded-xl bg-coral/10 p-3 text-sm"
        role="group"
        aria-label="確認刪除"
      >
        <p class="font-semibold">刪除這筆現金支出？</p>
        <p class="mt-1 text-subtle">刪除後，這筆金額會回到提款的未細分金額。</p>
        <div class="mt-3 flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            class="h-11"
            disabled={busy}
            onclick={() => (confirmingDelete = false)}>不要刪除</Button
          >
          <Button
            type="button"
            variant="destructive"
            class="h-11"
            disabled={busy}
            onclick={() => onDelete?.()}>{deleting ? "刪除中…" : "刪除"}</Button
          >
        </div>
      </div>
    {:else}
      <div class="mt-5 flex items-center gap-2">
        {#if expense && onDelete}<Button
            type="button"
            variant="ghost"
            class="h-11 text-coral hover:text-coral"
            disabled={busy}
            onclick={() => (confirmingDelete = true)}>刪除</Button
          >{/if}
        <div class="ml-auto flex gap-2">
          <Button
            type="button"
            variant="outline"
            class="h-11"
            disabled={busy}
            onclick={onCancel}>取消</Button
          >
          <Button type="submit" class="h-11" disabled={!canSubmit}
            >{submitting ? "儲存中…" : "儲存"}</Button
          >
        </div>
      </div>
    {/if}
  </form>
</div>
