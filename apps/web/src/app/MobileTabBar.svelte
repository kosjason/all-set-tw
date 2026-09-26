<!--
  手機底部列（md 以下）：本月｜交易｜信用卡｜資產｜更多。
  資料來源、待處理、設定收在「更多」；待處理另在頁首右上有 Inbox 按鈕。
-->
<script lang="ts">
  import { Ellipsis } from "@lucide/svelte";
  import {
    EMPTY_INBOX_COUNTS,
    mobilePrimaryViews,
    navItems,
    type InboxCounts,
  } from "./navigation-config";
  import type { Navigate, View } from "./types";

  let {
    activeView,
    inboxCounts = EMPTY_INBOX_COUNTS,
    navigate,
  }: {
    activeView: View;
    inboxCounts?: InboxCounts;
    navigate: Navigate;
  } = $props();

  const items = mobilePrimaryViews.map((view) =>
    navItems.find((item) => item.view === view)!,
  );
  const moreActive = $derived(
    !mobilePrimaryViews.includes(
      activeView as (typeof mobilePrimaryViews)[number],
    ),
  );
  // 待處理收在「更多」裡；有需要處理的項目時在「更多」加紅點提示。
  const blocking = $derived(inboxCounts.blocking > 0);
  const tabClass = (active: boolean) =>
    `relative flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[11px] font-medium transition ${active ? "bg-white/10 text-white" : "text-white/65"}`;
</script>

<nav
  aria-label="主要導覽"
  class="fixed inset-x-0 bottom-0 z-50 grid grid-cols-5 gap-1 border-t border-ink/10 bg-ink px-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2 text-white shadow-[0_-8px_28px_rgba(31,41,51,0.12)] md:hidden"
>
  {#each items as item (item.view)}
    {@const NavIcon = item.icon}
    <button
      type="button"
      class={tabClass(activeView === item.view)}
      aria-current={activeView === item.view ? "page" : undefined}
      onclick={() => navigate(item.view)}
      ><NavIcon class="size-5" />{item.shortLabel}</button
    >
  {/each}
  <button
    type="button"
    class={tabClass(moreActive)}
    aria-current={moreActive ? "page" : undefined}
    onclick={() => navigate("more")}
    ><Ellipsis class="size-5" />更多{#if blocking}<span
        class="absolute right-[22%] top-1.5 size-2 rounded-full bg-coral"
        aria-hidden="true"
      ></span>{/if}</button
  >
</nav>
