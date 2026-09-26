<!--
  發票分頁每列的前 3 個品項。DTO 帶 `itemsPreview` 時直接顯示；否則捲到畫面內時
  才載入發票明細（`GET /api/invoices/:id`，與明細抽屜共用快取），避免一次發出
  整個月份的請求。沒有 IntersectionObserver 的環境改為點「顯示品項」載入。
-->
<script lang="ts">
  import { createQuery } from "@tanstack/svelte-query";
  import { toStore } from "svelte/store";
  import { invoiceDetailQuery } from "@/data/invoices/queries";
  import type { ApiClient } from "@/shared/api/client";

  let {
    api,
    invoiceId,
    preview,
  }: { api: ApiClient; invoiceId?: string; preview?: string[] } = $props();

  let visible = $state(false);
  const canObserve = typeof IntersectionObserver !== "undefined";
  const detail = createQuery(
    toStore(() => ({
      ...invoiceDetailQuery(() => api, invoiceId ?? null),
      enabled: Boolean(invoiceId) && !preview && visible,
    })),
  );
  const names = $derived(
    preview ??
      ($detail.data?.items ?? [])
        .slice()
        .sort((a, b) => a.lineNumber - b.lineNumber)
        .map((line) => line.description)
        .filter(Boolean)
        .slice(0, 3),
  );
  const more = $derived(
    preview ? 0 : Math.max(0, ($detail.data?.items.length ?? 0) - 3),
  );

  function observe(node: HTMLElement) {
    if (!canObserve) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          visible = true;
          observer.disconnect();
        }
      },
      { rootMargin: "200px 0px" },
    );
    observer.observe(node);
    return { destroy: () => observer.disconnect() };
  }
</script>

<span use:observe class="block min-w-0 truncate text-caption text-subtle">
  {#if names.length}
    {names.join("、")}{more ? ` 等 ${names.length + more} 項` : ""}
  {:else if $detail.isFetching}
    載入品項中…
  {:else if $detail.isError}
    品項無法載入
  {:else if !preview && !visible && !canObserve && invoiceId}
    <button
      type="button"
      class="font-semibold text-steel"
      onclick={(event) => {
        event.stopPropagation();
        visible = true;
      }}>顯示品項</button
    >
  {/if}
</span>
