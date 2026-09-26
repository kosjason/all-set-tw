<!--
  交易頁分頁：總帳（預設，去重後）｜銀行｜信用卡｜發票（原始紀錄）。
  目前分頁寫入網址 `tab=`（由頁面同步）。
-->
<script lang="ts">
  import { TRANSACTION_TABS, type TransactionTab } from "../model/url-state";
  import { TRANSACTION_TAB_LABELS } from "../model/view-filters";

  let {
    value,
    onChange,
  }: { value: TransactionTab; onChange: (tab: TransactionTab) => void } =
    $props();

  function keydown(event: KeyboardEvent) {
    const index = TRANSACTION_TABS.indexOf(value);
    const delta =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    const next =
      TRANSACTION_TABS[
        (index + delta + TRANSACTION_TABS.length) % TRANSACTION_TABS.length
      ]!;
    onChange(next);
    (
      (event.currentTarget as HTMLElement).querySelector(
        `[data-tab="${next}"]`,
      ) as HTMLElement | null
    )?.focus();
  }
</script>

<div
  role="tablist"
  aria-label="交易分頁"
  tabindex="-1"
  class="inline-flex min-w-0 max-w-full gap-1 overflow-x-auto rounded-full bg-ink/5 p-1"
  onkeydown={keydown}
>
  {#each TRANSACTION_TABS as tab (tab)}
    <button
      type="button"
      role="tab"
      data-tab={tab}
      aria-selected={value === tab}
      tabindex={value === tab ? 0 : -1}
      class={`h-9 shrink-0 rounded-full px-4 text-sm font-semibold transition ${value === tab ? "bg-white text-ink shadow-xs" : "text-subtle hover:text-ink"}`}
      onclick={() => onChange(tab)}>{TRANSACTION_TAB_LABELS[tab]}</button
    >
  {/each}
</div>
