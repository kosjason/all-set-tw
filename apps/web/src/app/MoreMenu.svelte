<!--
  手機「更多」：資料來源、待處理（含數字）、設定。
-->
<script lang="ts">
  import { ChevronRight } from "@lucide/svelte";
  import InboxBadge from "./InboxBadge.svelte";
  import {
    EMPTY_INBOX_COUNTS,
    inboxAccessibleLabel,
    mobileMoreItems,
    type InboxCounts,
  } from "./navigation-config";
  import type { Navigate } from "./types";

  let {
    inboxCounts = EMPTY_INBOX_COUNTS,
    demoMode = false,
    navigate,
  }: {
    inboxCounts?: InboxCounts;
    demoMode?: boolean;
    navigate: Navigate;
  } = $props();
</script>

<div class="grid min-w-0 gap-4 pt-3">
  {#if demoMode}<span
      class="w-fit rounded-full bg-steel/10 px-3 py-1 text-sm font-semibold text-steel"
      >Demo 資料</span
    >{/if}
  <nav
    aria-label="更多功能"
    class="grid divide-y divide-ink/10 overflow-hidden rounded-xl border border-ink/10 bg-card"
  >
    {#each mobileMoreItems as item (item.view)}
      {@const ItemIcon = item.icon}
      <button
        type="button"
        class="flex min-h-16 min-w-0 items-center gap-3 px-4 text-left transition hover:bg-ink/3"
        aria-label={item.view === "inbox"
          ? inboxAccessibleLabel(inboxCounts)
          : undefined}
        onclick={() => navigate(item.view)}
      >
        <ItemIcon class="size-5 shrink-0 text-steel" />
        <span class="min-w-0 flex-1">
          <span class="block text-sm font-semibold">{item.label}</span>
          <span class="mt-0.5 block truncate text-caption text-subtle"
            >{item.description}</span
          >
        </span>
        {#if item.view === "inbox"}<InboxBadge counts={inboxCounts} />{/if}
        <ChevronRight class="size-4 shrink-0 text-subtle" />
      </button>
    {/each}
  </nav>
</div>
