<!--
  信用卡頁：由上而下為本期總應繳與最近截止日倒數、依發卡行分組的帳單列
  （可展開各卡未出帳並連到交易頁），以及帳單歷史。
  桌面版帳單列與帳單歷史左右並排；手機版依序堆疊。
-->
<script lang="ts">
  import { createQuery } from "@tanstack/svelte-query";
  import { toStore } from "svelte/store";
  import { cardBillsQuery, cardsSummaryQuery } from "@/data/cards/queries";
  import { messageFromError, type ApiClient } from "@/shared/api/client";
  import Button from "@/shared/ui/Button.svelte";
  import EmptyState from "@/shared/ui/EmptyState.svelte";
  import BillHistory from "./components/BillHistory.svelte";
  import CardsDueHero from "./components/CardsDueHero.svelte";
  import IssuerBillRow from "./components/IssuerBillRow.svelte";
  import { cardsHashIssuer } from "./model/cards";

  let { api }: { api: ApiClient } = $props();

  // `#/cards?issuer=ctbc`（例如收件匣的卡費提醒）預設展開並選取該發卡行。
  const initialIssuer = cardsHashIssuer(window.location.hash);
  const summary = createQuery(cardsSummaryQuery(() => api));
  const issuers = $derived($summary.data?.issuers ?? []);

  let expanded = $state<Record<string, boolean>>(
    initialIssuer ? { [initialIssuer]: true } : {},
  );
  let selectedHistory = $state("");
  const historyIssuer = $derived(
    selectedHistory ||
      (issuers.some((issuer) => issuer.issuer === initialIssuer)
        ? initialIssuer
        : (issuers[0]?.issuer ?? "")),
  );

  const history = createQuery(
    toStore(() => ({
      ...cardBillsQuery(() => api, historyIssuer),
      enabled: Boolean(historyIssuer),
    })),
  );
</script>

{#if $summary.isPending}
  <EmptyState title="載入信用卡中" body="正在整理各發卡行的帳單。" />
{:else if $summary.isError}
  <section class="py-12" role="alert">
    <h2 class="text-base font-semibold">信用卡資料暫時無法載入</h2>
    <p class="mt-2 text-caption text-subtle">
      {messageFromError($summary.error)}
    </p>
    <Button class="mt-4" variant="outline" onclick={() => $summary.refetch()}
      >重試</Button
    >
  </section>
{:else if issuers.length === 0}
  <EmptyState
    title="尚無信用卡"
    body="連接銀行資料來源並同步信用卡後，這裡會列出各發卡行的帳單與繳款狀態。"
  />
{:else if $summary.data}
  <div class="grid gap-5">
    <CardsDueHero summary={$summary.data} />
    <div
      class="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,400px)]"
    >
      <section aria-labelledby="card-issuers" class="grid gap-3">
        <h2 id="card-issuers" class="sr-only">各發卡行本期帳單</h2>
        {#each issuers as issuer (issuer.issuer)}
          <IssuerBillRow
            {issuer}
            expanded={expanded[issuer.issuer] ?? false}
            onToggle={() =>
              (expanded[issuer.issuer] = !(expanded[issuer.issuer] ?? false))}
          />
        {/each}
      </section>
      <div class="lg:sticky lg:top-[calc(var(--app-sticky-top,0px)+1rem)]">
        <BillHistory
          issuers={issuers.map(({ issuer, name }) => ({ issuer, name }))}
          selected={historyIssuer}
          onSelect={(issuer) => (selectedHistory = issuer)}
          history={$history.data}
          pending={$history.isPending}
          error={$history.isError}
          onRetry={() => $history.refetch()}
        />
      </div>
    </div>
  </div>
{/if}
