<!--
  活動列的對方帳戶與「我的其他帳戶」標記（例如「→ 台北富邦 …66666」）。
  有經濟角色時「轉到自己帳戶」改由角色標記顯示，這裡只保留「未同步的卡片」標記。
  - item：活動；無對方帳戶也沒有需要顯示的標記時不渲染。
  - class：外層 p 的額外 class（手機與桌面列間距不同）。
-->
<script lang="ts">
  import type { ActivityItem } from "../model/types";

  let { item, class: className = "" }: { item: ActivityItem; class?: string } =
    $props();

  const marker = $derived(
    item.ownAccountTransfer &&
      (!item.economicRole || item.ownAccountTransfer.kind === "unsynced_card")
      ? item.ownAccountTransfer
      : undefined,
  );
</script>

{#if item.counterpartyAccount || marker}<p
    class={`truncate text-caption text-subtle ${className}`}
  >
    {item.counterpartyAccount ?? ""}{#if marker}<span
        class={`ml-1.5 rounded px-1.5 py-0.5 font-semibold ${marker.kind === "unsynced_card" ? "bg-amber-50 text-amber-800" : "bg-steel/10 text-steel"}`}
        title={marker.label}>{marker.marker}</span
      >{/if}
  </p>{/if}
