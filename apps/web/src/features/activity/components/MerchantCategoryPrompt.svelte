<!--
  改完一筆的分類後，畫面下方出現一行詢問：「將『商家』的其他 N 筆也設為「X」，並記住這個商家？」
  選「套用並記住」寫入商家規則（之後同商家的活動自動套用）；「只改這筆」關閉詢問。
  - message：詢問文字（`merchantPromptText`）。
  - submitting／failed：套用中／失敗。
  - onApply：套用到商家；onDismiss：只改這筆。
-->
<script module lang="ts">
  export interface MerchantCategoryPromptProps {
    message: string;
    submitting?: boolean;
    failed?: boolean;
    onApply: () => void;
    onDismiss: () => void;
  }
</script>

<script lang="ts">
  import Button from "@/shared/ui/Button.svelte";

  let {
    message,
    submitting = false,
    failed = false,
    onApply,
    onDismiss,
  }: MerchantCategoryPromptProps = $props();
</script>

<div
  role="region"
  aria-label="套用到同商家"
  class="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+5rem)] z-[85] mx-auto flex max-w-xl flex-col gap-2 rounded-2xl bg-ink px-4 py-3 text-sm text-white shadow-xl sm:flex-row sm:items-center md:bottom-6"
>
  <p class="min-w-0 flex-1 font-medium" data-testid="merchant-category-prompt">
    {message}
    {#if failed}<span role="alert" class="block text-caption text-coral"
        >無法套用，請稍後再試。</span
      >{/if}
  </p>
  <div class="flex shrink-0 justify-end gap-2">
    <Button
      variant="ghost"
      class="h-10 text-white hover:bg-white/10 hover:text-white"
      disabled={submitting}
      onclick={onDismiss}>只改這筆</Button
    >
    <Button
      class="h-10 bg-white text-ink hover:bg-white/90"
      disabled={submitting}
      onclick={onApply}>{submitting ? "套用中…" : "套用並記住"}</Button
    >
  </div>
</div>
