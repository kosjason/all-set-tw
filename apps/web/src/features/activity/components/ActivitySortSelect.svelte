<!--
  活動排序選單：可見標籤「排序」，無障礙名稱固定為「活動排序」
  （不以 label 包住 select，避免名稱被算成目前選項文字）。
  - value：排序值，$bindable；onchange：選擇後回報新值。
  - class：外層額外 class。
-->
<script lang="ts">
  import Select from "@/shared/ui/Select.svelte";
  import {
    ACTIVITY_SORT_OPTIONS,
    DEFAULT_ACTIVITY_SORT,
    type ActivitySortMode,
  } from "../model/sort";
  let {
    value = $bindable<ActivitySortMode>(DEFAULT_ACTIVITY_SORT),
    onchange,
    class: className = "",
  }: {
    value?: ActivitySortMode;
    onchange?: (mode: ActivitySortMode) => void;
    class?: string;
  } = $props();
  const id = $props.id();
</script>

<div class={`flex shrink-0 items-center gap-1.5 ${className}`}>
  <label for={`${id}-sort`} class="text-caption font-semibold text-subtle"
    >排序</label
  ><Select
    id={`${id}-sort`}
    aria-label="活動排序"
    class="h-10 w-auto min-w-0 rounded-full pr-8 text-caption font-semibold text-ink md:text-sm"
    bind:value
    onchange={() => onchange?.(value)}
    >{#each ACTIVITY_SORT_OPTIONS as option (option.id)}<option
        value={option.id}>{option.label}</option
      >{/each}</Select
  >
</div>
