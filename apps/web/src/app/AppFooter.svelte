<!-- 頁尾：免責聲明（可展開全文）與資料更新時間。手機因底部分頁列不顯示。 -->
<script lang="ts">
  import { formatDateTime } from "@/shared/format/financial";

  let { lastSyncAt }: { lastSyncAt?: string | null } = $props();
</script>

<footer
  class="hidden border-t border-ink/8 px-4 py-4 text-xs text-ink/45 sm:px-6 md:block xl:px-8"
>
  <div class="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
    <details class="group min-w-0 flex-1">
      <summary
        class="cursor-pointer list-none [&::-webkit-details-marker]:hidden"
      >
        <strong class="font-medium text-ink/55">免責聲明</strong
        >：本程式僅供個人研究與自用，資料以您自行提供之憑證取得。
        <span class="font-medium text-steel group-open:hidden">展開全文</span>
      </summary>
      <p class="mt-2 leading-relaxed">
        本程式未與臺灣集中保管結算所、財政部、金融監督管理委員會、各銀行或任何金融機構合作，亦未獲前述機構授權或背書。作者不保證資料的即時性、正確性與完整性，亦不對因使用本程式所產生的任何直接或間接損失負責。請勿將本程式用於任何商業用途。
      </p>
    </details>
    {#if lastSyncAt}
      <p class="shrink-0 tabular-nums">
        資料更新於 {formatDateTime(lastSyncAt)}
      </p>
    {/if}
  </div>
</footer>
