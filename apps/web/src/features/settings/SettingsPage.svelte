<!--
  設定：只保留通知（Web Push）與介面偏好。資料來源、同步排程與匯率已移到
  「資料來源」，分類規則移到「交易 › 自動整理」，我的其他帳戶移到「資產」。
-->
<script lang="ts">
  import type { ApiClient } from "@/shared/api/client";
  import { moneyState } from "@/shared/state/money-visibility.svelte";
  import NotificationPanel from "./components/NotificationPanel.svelte";

  let { api, demoMode }: { api: ApiClient; demoMode: boolean } = $props();

  function setMoneyHidden(hidden: boolean) {
    moneyState.hidden = hidden;
    try {
      localStorage.setItem("taiwan-fin-hub-money-hidden", String(hidden));
    } catch {
      // 無法寫入時只影響這次瀏覽。
    }
  }
</script>

<div class="grid min-w-0 gap-6 pt-3 md:pt-0">
  <section aria-labelledby="settings-notifications" class="grid min-w-0 gap-3">
    <h2 id="settings-notifications" class="text-lg font-semibold">通知</h2>
    <div class="hidden md:block">
      <NotificationPanel {api} {demoMode} variant="desktop" />
    </div>
    <div class="md:hidden">
      <NotificationPanel {api} {demoMode} />
    </div>
  </section>

  <section
    aria-labelledby="settings-preferences"
    class="grid min-w-0 gap-3 rounded-xl border border-border bg-card p-5 shadow-xs"
  >
    <h2 id="settings-preferences" class="text-lg font-semibold">介面偏好</h2>
    <label class="flex min-h-11 items-center justify-between gap-4">
      <span class="min-w-0">
        <span class="block text-sm font-semibold">隱藏金額</span>
        <span class="block text-caption text-subtle"
          >在公共場所開啟時以 •••• 遮住所有金額；也可用頁首的眼睛按鈕切換。</span
        >
      </span>
      <input
        type="checkbox"
        role="switch"
        class="size-5 shrink-0 accent-[var(--color-steel)]"
        checked={moneyState.hidden}
        onchange={(event) =>
          setMoneyHidden((event.currentTarget as HTMLInputElement).checked)}
      />
    </label>
    <div class="flex min-h-11 items-center justify-between gap-4">
      <span class="min-w-0">
        <span class="block text-sm font-semibold">顯示幣別</span>
        <span class="block text-caption text-subtle"
          >總額一律換算為新台幣；外幣交易另列原幣。</span
        >
      </span>
      <span class="shrink-0 text-sm font-semibold">新台幣（TWD）</span>
    </div>
  </section>
</div>
