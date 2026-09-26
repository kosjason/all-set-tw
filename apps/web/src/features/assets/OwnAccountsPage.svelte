<!--
  資產 › 我的其他帳戶：無法同步的自有帳戶與卡片（原設定頁子頁，先原樣搬來）。
-->
<script lang="ts">
  import type { ApiClient } from "@/shared/api/client";
  import OwnAccountsPanel from "./components/OwnAccountsPanel.svelte";

  let { api, demoMode }: { api: ApiClient; demoMode: boolean } = $props();
</script>

<div
  class="grid min-w-0 gap-4 pt-3 md:pt-0 lg:grid-cols-[minmax(0,690px)_minmax(0,1fr)]"
>
  <OwnAccountsPanel {api} {demoMode} />
  <aside
    class="min-w-0 rounded-xl border border-border bg-card p-5 shadow-xs"
    aria-label="我的其他帳戶如何運作"
  >
    <h2 class="text-base font-bold">如何運作</h2>
    <p class="mt-2 text-sm leading-relaxed text-muted-foreground">
      交易明細帶有對方銀行與帳號時（例如國泰世華的「電子轉出」），系統會比對銀行代碼與帳號末碼。
    </p>
    <ul class="mt-3 grid gap-2 text-sm leading-relaxed text-muted-foreground">
      <li>
        <span class="font-semibold text-foreground">自己的存款／電子錢包</span
        >：轉入轉出標示為「轉到自己的帳戶」，分類為轉帳並不計入收支。
      </li>
      <li>
        <span class="font-semibold text-foreground">未同步的信用卡</span
        >：轉入卡片的款項仍計入支出，並標示為「繳卡費（卡片名稱）」。
      </li>
    </ul>
    <div class="mt-5 rounded-lg bg-muted p-3">
      <p class="text-sm font-bold">只寫銀行名稱的轉帳</p>
      <p class="mt-1 text-sm leading-relaxed text-muted-foreground">
        像「轉帳 台新銀行
        轉存款」這類沒有帳號的交易無法安全比對。請在交易明細勾選「排除統計計算」，或在交易
        › 自動整理新增「符合時不計入收支」的分類規則。
      </p>
    </div>
    <p class="mt-5 text-sm leading-relaxed text-muted-foreground">
      個別交易在交易明細中手動調整的分類與計算方式，仍以你的設定為準。
    </p>
  </aside>
</div>
