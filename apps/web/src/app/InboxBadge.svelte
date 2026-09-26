<!--
  待處理的 badge：有「需要處理」（blocking）時顯示紅點，「待整理」（tidy）顯示數字。
  兩者皆 0 時不顯示。variant="overlay" 疊在圖示右上角（手機頁首）。
-->
<script lang="ts">
  import { inboxBadgeLabel, type InboxCounts } from "./navigation-config";

  let {
    counts,
    variant = "inline",
  }: { counts: InboxCounts; variant?: "inline" | "overlay" } = $props();

  const tidy = $derived(inboxBadgeLabel(counts.tidy));
  const blocking = $derived(counts.blocking > 0);
</script>

{#if blocking || tidy}
  <span
    data-testid="inbox-badge"
    class={`inline-flex items-center gap-1 ${variant === "overlay" ? "absolute -right-1 -top-1" : ""}`}
  >
    {#if blocking}<span
        data-testid="inbox-badge-blocking"
        class="size-2.5 rounded-full bg-coral ring-2 ring-white/80"
        role="img"
        aria-label={`${counts.blocking} 件需要處理`}
      ></span>{/if}
    {#if tidy}<span
        data-testid="inbox-badge-tidy"
        class="min-w-5 rounded-full bg-amber-400 px-1.5 text-center text-[11px] font-semibold leading-5 text-ink tabular-nums"
        aria-label={`${counts.tidy} 件待整理`}>{tidy}</span
      >{/if}
  </span>
{/if}
