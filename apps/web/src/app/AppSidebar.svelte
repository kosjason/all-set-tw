<!--
  桌面側欄（xl 以上）：頂端「待處理」收件匣（有數字才顯示 badge）、主導覽
  本月／交易／信用卡／資產／資料來源，底部「設定」。
-->
<script lang="ts">
  import InboxBadge from "./InboxBadge.svelte";
  import {
    EMPTY_INBOX_COUNTS,
    inboxAccessibleLabel,
    inboxItem,
    navItems,
    settingsItem,
    type InboxCounts,
    type NavigationItem,
  } from "./navigation-config";
  import type { Navigate, View } from "./types";

  let {
    activeView,
    inboxCounts = EMPTY_INBOX_COUNTS,
    navigate,
  }: {
    /** 導覽上應標示為目前頁的 view（子頁已換成上層）。 */
    activeView: View;
    inboxCounts?: InboxCounts;
    navigate: Navigate;
  } = $props();
</script>

{#snippet navButton(item: NavigationItem, extra = "")}
  {@const NavIcon = item.icon}
  <button
    type="button"
    class={`flex min-h-11 items-center gap-3 rounded-lg px-3 text-left text-sm font-medium transition ${activeView === item.view ? "bg-white/10 text-white" : "text-white/65 hover:bg-white/5 hover:text-white"} ${extra}`}
    aria-current={activeView === item.view ? "page" : undefined}
    aria-label={item.view === "inbox"
      ? inboxAccessibleLabel(inboxCounts)
      : undefined}
    onclick={() => navigate(item.view)}
  >
    <NavIcon class="size-[22px] shrink-0 stroke-[1.8]" />
    <span class="min-w-0 flex-1 truncate">{item.label}</span>
    {#if item.view === "inbox"}<InboxBadge counts={inboxCounts} />{/if}
  </button>
{/snippet}

<aside
  aria-label="側欄"
  class="hidden border-r border-white/10 bg-ink px-6 py-7 text-white xl:sticky xl:top-0 xl:flex xl:h-screen xl:flex-col"
>
  <div class="px-2">
    <h1 class="text-xl font-semibold tracking-normal">不用記帳</h1>
    <p
      class="mt-2 text-xs font-semibold uppercase tracking-[0.16em] text-steel/90"
    >
      ALL SET
    </p>
  </div>
  <div class="mt-6">{@render navButton(inboxItem, "w-full")}</div>
  <nav
    aria-label="主導覽"
    class="mt-3 grid gap-1 border-t border-white/10 pt-3"
  >
    {#each navItems as item (item.view)}
      {@render navButton(item)}
    {/each}
  </nav>
  <div class="mt-auto grid border-t border-white/10 pt-3">
    {@render navButton(settingsItem)}
  </div>
</aside>
