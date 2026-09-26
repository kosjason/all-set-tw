<!--
  分類欄的角色 chip：角色不是消費（收入、投資、轉到自己帳戶、繳卡費）的活動不顯示
  分類（常是「未分類」，易被誤認為待處理），改顯示角色。可覆寫角色的活動為原生
  select，選擇後交給頁面呼叫角色 override API；待確認時選目前的角色也會送出（確認）。
  - item：活動（economicRole 不是 spending）。
  - onRoleChange：選擇角色；未提供時只顯示標籤。
  - disabled：角色更新進行中時停用。
-->
<script module lang="ts">
  import type { EconomicRole } from "@taiwan-fin-hub/core";
  import type { ActivityItem } from "../model/types";

  export interface ActivityRoleCellProps {
    item: ActivityItem;
    onRoleChange?: (item: ActivityItem, role: EconomicRole) => void;
    disabled?: boolean;
  }
</script>

<script lang="ts">
  import { ChevronDown } from "@lucide/svelte";
  import { activityDisplayName } from "@/data/activity/names";
  import {
    ECONOMIC_ROLE_CHOICES,
    ECONOMIC_ROLE_CHOICE_LABELS,
    ECONOMIC_ROLE_LABELS,
    activityRoleTarget,
    activityRoleTone,
    needsReview,
    type ActivityRoleBadgeTone,
  } from "../model/roles";

  let {
    item,
    onRoleChange,
    disabled = false,
  }: ActivityRoleCellProps = $props();

  const role = $derived(item.economicRole ?? "spending");
  const label = $derived(ECONOMIC_ROLE_LABELS[role]);
  const reviewing = $derived(needsReview(item));
  const editable = $derived(
    Boolean(onRoleChange) && activityRoleTarget(item) != null,
  );
  const toneClass: Record<ActivityRoleBadgeTone, string> = {
    income: "bg-moss/10 text-moss hover:bg-moss/15",
    investment: "bg-violet-50 text-violet-800 hover:bg-violet-100",
    transfer: "bg-steel/10 text-steel hover:bg-steel/15",
    muted: "bg-ink/5 text-subtle hover:bg-ink/10",
    review: "bg-amber-100 text-amber-900",
  };
  const chipClass = $derived(
    reviewing
      ? "border-dashed border-amber-400 bg-amber-50 text-amber-900 hover:bg-amber-100"
      : `border-transparent ${toneClass[activityRoleTone(role)]}`,
  );

  function change(event: Event) {
    const select = event.currentTarget as HTMLSelectElement;
    const next = select.value as EconomicRole | "";
    select.value = "";
    // 已確認的角色再選一次不需要建立 override；待確認時選目前角色代表確認。
    if (next && (next !== role || reviewing)) onRoleChange?.(item, next);
  }
</script>

{#if editable}
  <span class="relative inline-flex max-w-full">
    <select
      aria-label={`變更「${activityDisplayName(item)}」的角色`}
      title="這筆是…"
      data-role-cell={role}
      class={`h-10 max-w-full cursor-pointer appearance-none truncate rounded-full border py-0 pl-3 pr-7 text-caption font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-steel disabled:cursor-not-allowed disabled:opacity-50 ${chipClass}`}
      value=""
      {disabled}
      onchange={change}
      ><option value="" disabled>{label}{reviewing ? "（待確認）" : ""}</option
      >{#each ECONOMIC_ROLE_CHOICES as choice (choice)}<option value={choice}
          >{ECONOMIC_ROLE_CHOICE_LABELS[choice]}</option
        >{/each}</select
    >
    <ChevronDown
      class="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 opacity-70"
      aria-hidden="true"
    />
  </span>
{:else}
  <span
    data-role-cell={role}
    class={`inline-flex max-w-full items-center truncate rounded-full px-2.5 py-0.5 text-caption font-semibold ${chipClass}`}
    >{label}</span
  >
{/if}
