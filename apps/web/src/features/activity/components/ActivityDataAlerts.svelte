<!--
  活動資料載入失敗提示。缺匯率等 summary 不完整的原因改由摘要列顯示。
  - failedLabels：載入失敗的資料名稱，空陣列時不顯示。
  - retryPending：重試進行中；onRetry：重試失敗的活動資料。
-->
<script module lang="ts">
  export interface ActivityDataAlertsProps {
    failedLabels: string[];
    retryPending: boolean;
    onRetry: () => void;
  }
</script>

<script lang="ts">
  import Button from "@/shared/ui/Button.svelte";

  let { failedLabels, retryPending, onRetry }: ActivityDataAlertsProps =
    $props();
</script>

{#if failedLabels.length > 0}
  <div
    class="flex flex-col gap-3 rounded-xl border border-coral/25 bg-coral/5 px-4 py-3 text-sm text-ink sm:flex-row sm:items-center sm:justify-between"
    role="alert"
  >
    <div class="min-w-0">
      <p class="font-semibold text-coral">部分資料載入失敗</p>
      <p class="mt-1 text-caption text-subtle">
        {failedLabels.join("、")}目前無法取得；以下仍顯示已成功載入的資料。
      </p>
    </div>
    <Button
      class="h-11 shrink-0"
      variant="outline"
      disabled={retryPending}
      onclick={onRetry}>{retryPending ? "重試中…" : "重試活動資料"}</Button
    >
  </div>
{/if}
