<!--
  資料來源：健康度 → 來源卡片（桌面為清單＋連接器詳情兩欄，手機為可展開卡片）→
  同步排程 → 最近一次排程同步紀錄 → 參考匯率。元件沿用原設定頁；
  `#/data-sources?connector=<id>`（收件匣連結）或 App 傳入的 connectorTarget
  會預先展開該連接器。
-->
<script lang="ts">
  import { createQuery } from "@tanstack/svelte-query";
  import {
    connectorDefinitions,
    connectorFields,
  } from "@/data/connectors/definitions";
  import { syncJobsQuery } from "@/data/connectors/queries";
  import {
    getActionableSyncJobs,
    getConfiguredSyncJobs,
    getHealthySyncJobs,
    getPendingSyncJobs,
  } from "@/data/connectors/sync-status";
  import type { ConnectorId } from "@/data/connectors/types";
  import { latestSyncReportQuery } from "@/data/sync-reports/queries";
  import type { ApiClient } from "@/shared/api/client";
  import { formatDateTime } from "@/shared/format/financial";
  import DefaultSchedulePanel from "./components/DefaultSchedulePanel.svelte";
  import ExchangeRatesPanel from "./components/ExchangeRatesPanel.svelte";
  import LatestSyncReportCard from "./components/LatestSyncReportCard.svelte";
  import SourceCard from "./components/SourceCard.svelte";
  import ConnectorPanel from "./connectors/ConnectorPanel.svelte";

  let {
    api,
    demoMode,
    connectorTarget = null,
  }: {
    api: ApiClient;
    demoMode: boolean;
    connectorTarget?: ConnectorId | null;
  } = $props();

  const sources = connectorDefinitions;
  const jobs = createQuery(syncJobsQuery(() => api));
  const latestSyncReport = createQuery(latestSyncReportQuery(() => api));

  function connectorFromHash(): ConnectorId | null {
    const query = window.location.hash.split("?")[1] ?? "";
    const id = new URLSearchParams(query).get("connector");
    return sources.some((source) => source.id === id)
      ? (id as ConnectorId)
      : null;
  }
  const initialConnector = connectorFromHash();

  let selectedConnector = $state<ConnectorId | null | undefined>(undefined);
  const activeConnector = $derived(
    selectedConnector === undefined
      ? (connectorTarget ?? initialConnector)
      : selectedConnector,
  );
  const syncJobsState = $derived(
    $jobs.isPending ? "loading" : $jobs.isError ? "error" : "ready",
  );
  const syncJobRows = $derived($jobs.data ?? []);
  const needsAction = $derived(getActionableSyncJobs(syncJobRows).length);
  const pendingSources = $derived(getPendingSyncJobs(syncJobRows).length);
  const configuredSources = $derived(getConfiguredSyncJobs(syncJobRows));
  const healthySources = $derived(getHealthySyncJobs(syncJobRows));
  const latestSuccessAt = $derived(
    syncJobRows.reduce<string | undefined>((latest, job) => {
      if (!job.lastSuccessAt) return latest;
      return !latest || job.lastSuccessAt > latest ? job.lastSuccessAt : latest;
    }, undefined),
  );

  function selectConnector(id: ConnectorId) {
    selectedConnector = activeConnector === id ? null : id;
  }

  function scrollSelectedConnector(node: HTMLElement, selected: boolean) {
    let firstFrame: number | undefined;
    let secondFrame: number | undefined;
    function cancelScheduledScroll() {
      if (firstFrame !== undefined) cancelAnimationFrame(firstFrame);
      if (secondFrame !== undefined) cancelAnimationFrame(secondFrame);
      firstFrame = undefined;
      secondFrame = undefined;
    }
    function scheduleScroll(active: boolean) {
      cancelScheduledScroll();
      if (!active) return;
      firstFrame = requestAnimationFrame(() => {
        secondFrame = requestAnimationFrame(() => {
          node.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      });
    }
    scheduleScroll(selected);
    return { update: scheduleScroll, destroy: cancelScheduledScroll };
  }
</script>

<div class="grid min-w-0 gap-6 pt-3 md:pt-0">
  <section
    aria-label="資料健康度"
    class={`min-w-0 rounded-xl border bg-card p-5 shadow-xs ${needsAction ? "border-l-4 border-coral/70" : pendingSources ? "border-l-4 border-amber-200" : "border-border"}`}
  >
    <div class="flex flex-wrap items-baseline justify-between gap-3">
      <p
        class={`text-sm font-semibold ${needsAction || syncJobsState === "error" ? "text-coral" : pendingSources ? "text-amber-700" : "text-muted-foreground"}`}
      >
        {#if syncJobsState === "loading"}
          同步狀態載入中
        {:else if syncJobsState === "error"}
          同步狀態暫時無法取得
        {:else if needsAction}
          需要處理 · {needsAction}
        {:else if pendingSources}
          等待首次同步 · {pendingSources}
        {:else if configuredSources.length === 0}
          尚未設定資料來源
        {:else}
          資料同步狀態
        {/if}
      </p>
      <span class="text-sm text-muted-foreground"
        >{latestSuccessAt
          ? `最近成功 ${formatDateTime(latestSuccessAt)}`
          : "尚無成功紀錄"}</span
      >
    </div>
    <p class="mt-2 text-2xl font-bold">
      {#if syncJobsState !== "ready"}
        —
      {:else if configuredSources.length === 0}
        尚未設定
      {:else}
        {healthySources.length} / {configuredSources.length} 已設定來源正常
      {/if}
    </p>
    <p class="mt-1 text-sm text-muted-foreground">
      {#if syncJobsState === "error"}
        無法確認資料來源狀態，請稍後再試。
      {:else if needsAction}
        查看來源的錯誤說明，重試同步或完成必要的驗證。
      {:else if pendingSources}
        這些來源尚未完成第一次同步，完成後才會列入正常來源。
      {:else if configuredSources.length}
        所有已設定連接器都能正常同步。
      {:else if syncJobsState === "ready"}
        設定資料來源後即可開始同步。
      {/if}
    </p>
  </section>

  <div
    class="hidden gap-4 md:grid lg:grid-cols-[minmax(0,620px)_minmax(0,1fr)]"
  >
    <section aria-label="資料來源清單" class="grid min-w-0 content-start gap-3">
      {#each sources as source (source.id)}
        <SourceCard
          {api}
          {...source}
          id={source.id}
          jobs={syncJobRows}
          compact
          compactCard
          selected={activeConnector === source.id}
          onConfigure={() => selectConnector(source.id)}
        />
      {/each}
    </section>

    <section
      aria-label="連接器詳情"
      class="min-h-[520px] min-w-0 rounded-xl border border-border bg-card p-5 shadow-xs"
    >
      {#if activeConnector}
        {@const selectedSource = sources.find(
          (source) => source.id === activeConnector,
        )}
        <div class="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 class="text-lg font-bold">{selectedSource?.title}</h2>
            <p class="mt-1 text-sm text-muted-foreground">
              {selectedSource?.description}
            </p>
          </div>
          <button
            class="text-sm font-semibold text-muted-foreground hover:text-foreground"
            onclick={() => (selectedConnector = null)}>關閉</button
          >
        </div>
        {#key activeConnector}<ConnectorPanel
            {api}
            connectorId={activeConnector}
            {demoMode}
            title={selectedSource?.title ?? "連接器"}
            fields={connectorFields[activeConnector]}
            embedded
          />{/key}
      {:else}
        <div class="grid min-h-[480px] place-items-center text-center">
          <div>
            <p class="text-base font-semibold">選擇一個連接器</p>
            <p class="mt-1 text-sm text-muted-foreground">
              查看連線狀態、同步範圍與驗證設定。
            </p>
          </div>
        </div>
      {/if}
    </section>
  </div>

  <section
    aria-label="資料來源與連接器"
    class="grid min-w-0 gap-3 sm:grid-cols-2 md:hidden"
  >
    {#each sources as source (source.id)}
      <div
        class={`min-w-0 scroll-mt-24 ${activeConnector === source.id ? "sm:col-span-2" : ""}`}
        data-connector-settings={source.id}
        use:scrollSelectedConnector={activeConnector === source.id}
      >
        <SourceCard
          {api}
          {...source}
          id={source.id}
          jobs={syncJobRows}
          selected={activeConnector === source.id}
          onConfigure={() => selectConnector(source.id)}
        >
          {#if activeConnector === source.id}
            {#key source.id}<ConnectorPanel
                {api}
                connectorId={source.id}
                {demoMode}
                title={source.title}
                fields={connectorFields[source.id]}
                embedded
              />{/key}
          {/if}
        </SourceCard>
      </div>
    {/each}
  </section>

  <section aria-labelledby="data-sources-schedule" class="grid min-w-0 gap-3">
    <h2 id="data-sources-schedule" class="text-lg font-semibold">同步排程</h2>
    <div class="hidden md:block">
      <DefaultSchedulePanel
        {api}
        {demoMode}
        jobs={syncJobRows}
        variant="desktop"
      />
    </div>
    <div class="md:hidden">
      <DefaultSchedulePanel {api} {demoMode} jobs={syncJobRows} />
    </div>
  </section>

  <LatestSyncReportCard
    {api}
    report={$latestSyncReport.data}
    loading={$latestSyncReport.isPending}
  />

  <section aria-labelledby="data-sources-rates" class="grid min-w-0 gap-3">
    <div>
      <h2 id="data-sources-rates" class="text-lg font-semibold">參考匯率</h2>
      <p class="mt-1 text-sm text-muted-foreground">
        匯率僅用於資產與收支的台幣換算，不會變更原始交易幣別或金額。
      </p>
    </div>
    <div class="hidden md:block">
      <ExchangeRatesPanel {api} {demoMode} variant="desktop" />
    </div>
    <div class="md:hidden">
      <ExchangeRatesPanel {api} {demoMode} />
    </div>
  </section>
</div>
