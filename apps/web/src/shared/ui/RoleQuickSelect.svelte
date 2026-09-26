<!--
  待確認項目的快速選擇（原生 select，鍵盤與螢幕閱讀器可直接操作）。
  選擇後交給呼叫端處理（例如呼叫角色 override API）；選單本身不保留選擇，
  等 API 成功後資料重新載入。交易頁與收件匣共用。
  - label：select 的無障礙名稱。
  - options：選項（value 與顯示文字）。
  - onSelect：選擇一個選項。
  - disabled：更新進行中時停用。
-->
<script lang="ts" generics="T extends string">
  import { ChevronDown } from "@lucide/svelte";

  let {
    label,
    options,
    onSelect,
    disabled = false,
    placeholder = "這筆是…",
    class: className = "",
  }: {
    label: string;
    options: readonly { value: T; label: string }[];
    onSelect: (value: T) => void;
    disabled?: boolean;
    placeholder?: string;
    class?: string;
  } = $props();

  function change(event: Event) {
    const select = event.currentTarget as HTMLSelectElement;
    const value = select.value as T | "";
    select.value = "";
    if (value) onSelect(value);
  }
</script>

<span class={`relative inline-flex max-w-full ${className}`}>
  <select
    aria-label={label}
    title={placeholder}
    class="h-10 max-w-full cursor-pointer appearance-none truncate rounded-full border border-amber-400 bg-amber-50 py-0 pl-2.5 pr-7 text-caption font-semibold text-amber-900 transition hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
    value=""
    {disabled}
    onchange={change}
    ><option value="" disabled>{placeholder}</option
    >{#each options as option (option.value)}<option value={option.value}
        >{option.label}</option
      >{/each}</select
  >
  <ChevronDown
    class="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-amber-900"
    aria-hidden="true"
  />
</span>
