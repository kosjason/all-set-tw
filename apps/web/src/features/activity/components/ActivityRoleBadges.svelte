<!--
  活動列上的角色標記：收入、投資、轉到自己帳戶、繳卡費、重複（已併入另一筆）
  以小 badge 顯示，消費不顯示；待確認以醒目的琥珀色標記。沒有任何標記時不渲染。
  - item：活動。
  - duplicateLabel：重複活動的說明（例如「已併入信用卡交易」），取代「重複」字樣。
  - includeRole：是否顯示角色 badge；列表的分類欄已顯示角色時傳 false，只留重複與待確認。
  - class：外層的額外 class。
-->
<script module lang="ts">
  import type { ActivityItem } from "../model/types";

  export interface ActivityRoleBadgesProps {
    item: ActivityItem;
    duplicateLabel?: string;
    includeRole?: boolean;
    class?: string;
  }
</script>

<script lang="ts">
  import {
    activityRoleBadges,
    type ActivityRoleBadgeTone,
  } from "../model/roles";

  let {
    item,
    duplicateLabel,
    includeRole = true,
    class: className = "",
  }: ActivityRoleBadgesProps = $props();

  const badges = $derived(
    activityRoleBadges(item, { includeRole }).map((badge) =>
      badge.key === "duplicate" && duplicateLabel
        ? { ...badge, label: duplicateLabel }
        : badge,
    ),
  );
  const toneClass: Record<ActivityRoleBadgeTone, string> = {
    income: "bg-moss/10 text-moss",
    investment: "bg-violet-50 text-violet-800",
    transfer: "bg-steel/10 text-steel",
    muted: "bg-ink/5 text-subtle",
    review: "bg-amber-100 text-amber-900 ring-1 ring-amber-300",
  };
</script>

{#if badges.length}
  <span class={`inline-flex min-w-0 max-w-full flex-wrap gap-1 ${className}`}>
    {#each badges as badge (badge.key)}
      <span
        data-role-badge={badge.key}
        class={`inline-flex max-w-full items-center truncate rounded px-1.5 py-px text-caption font-semibold leading-5 ${toneClass[badge.tone]}`}
        >{badge.label}</span
      >
    {/each}
  </span>
{/if}
