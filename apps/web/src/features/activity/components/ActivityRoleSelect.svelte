<!--
  待確認活動列上的快速角色選擇（`shared/ui/RoleQuickSelect`，收件匣共用同一元件）。
  選擇後交給頁面呼叫角色 override API；選單本身不保留選擇，等 API 成功後列表重新載入。
  - item：待確認的活動。
  - onRoleChange：選擇角色。
  - disabled：角色更新進行中時停用。
  - class：外層的額外 class。
-->
<script module lang="ts">
  import type { EconomicRole } from "@taiwan-fin-hub/core";
  import type { ActivityItem } from "../model/types";

  export interface ActivityRoleSelectProps {
    item: ActivityItem;
    onRoleChange: (item: ActivityItem, role: EconomicRole) => void;
    disabled?: boolean;
    class?: string;
  }
</script>

<script lang="ts">
  import RoleQuickSelect from "@/shared/ui/RoleQuickSelect.svelte";
  import { activityDisplayName } from "@/data/activity/names";
  import {
    ECONOMIC_ROLE_CHOICES,
    ECONOMIC_ROLE_CHOICE_LABELS,
  } from "../model/roles";

  let {
    item,
    onRoleChange,
    disabled = false,
    class: className = "",
  }: ActivityRoleSelectProps = $props();

  const options = ECONOMIC_ROLE_CHOICES.map((role) => ({
    value: role,
    label: ECONOMIC_ROLE_CHOICE_LABELS[role],
  }));
</script>

<RoleQuickSelect
  label={`確認「${activityDisplayName(item)}」是哪一種活動`}
  {options}
  {disabled}
  class={className}
  onSelect={(role: EconomicRole) => onRoleChange(item, role)}
/>
