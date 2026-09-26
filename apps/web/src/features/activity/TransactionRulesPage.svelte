<!--
  交易 › 自動整理：目前沿用原設定頁的分類規則（ClassificationRulesPanel）。
  商家別名與商家規則由 feat/merchants-categories 完成後加入本頁。
-->
<script lang="ts">
  import { createQuery } from "@tanstack/svelte-query";
  import { classificationRulesQuery } from "@/data/classification/queries";
  import type { ApiClient } from "@/shared/api/client";
  import ClassificationRulesPanel from "./components/ClassificationRulesPanel.svelte";

  let { api }: { api: ApiClient } = $props();

  const rules = createQuery(classificationRulesQuery(() => api));
  const customRuleCount = $derived(
    ($rules.data ?? []).filter((rule) => !rule.isSystem).length,
  );
  const enabledRuleCount = $derived(
    ($rules.data ?? []).filter((rule) => !rule.isSystem && rule.enabled).length,
  );
</script>

<div class="grid min-w-0 gap-4 pt-3 md:pt-0">
  <section
    aria-label="分類規則摘要"
    class="hidden min-w-0 gap-3 md:grid md:grid-cols-2"
  >
    <div class="rounded-xl border border-border bg-card p-3.5 shadow-xs">
      <p class="text-sm font-semibold text-muted-foreground">自訂規則</p>
      <p class="mt-1 text-lg font-bold">{customRuleCount}</p>
    </div>
    <div class="rounded-xl border border-border bg-card p-3.5 shadow-xs">
      <p class="text-sm font-semibold text-muted-foreground">已啟用自訂</p>
      <p class="mt-1 text-lg font-bold text-moss">{enabledRuleCount}</p>
    </div>
  </section>

  <div class="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,690px)_minmax(0,1fr)]">
    <ClassificationRulesPanel {api} />
    <aside
      class="hidden min-w-0 rounded-xl border border-border bg-card p-5 shadow-xs md:block"
      aria-label="規則如何運作"
    >
      <h2 class="text-base font-bold">規則如何運作</h2>
      <p class="mt-2 text-sm leading-relaxed text-muted-foreground">
        同步完成後，系統由上到下檢查規則。第一個符合條件的規則會套用到交易。
      </p>
      <div class="mt-5 rounded-lg bg-muted p-3">
        <p class="text-sm font-bold">優先順序很重要</p>
        <p class="mt-1 text-sm leading-relaxed text-muted-foreground">
          將條件較精確的規則放在前面；可在下方調整規則順序。
        </p>
      </div>
      <p class="mt-5 text-sm leading-relaxed text-muted-foreground">
        儲存規則後，交易資料重新載入時會依目前順序重新判定；已手動分類的交易仍以手動覆寫為準。
      </p>
    </aside>
  </div>
</div>
