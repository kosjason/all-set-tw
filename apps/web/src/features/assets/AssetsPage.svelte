<script lang="ts">
  import { createQuery } from "@tanstack/svelte-query";
  import { ChevronRight } from "@lucide/svelte";
  import type { Navigate } from "@/app/types";
  import {
    exchangeRatesQuery,
    manualAssetsQuery,
    netWorthHistoryQuery,
  } from "@/data/assets/queries";
  import { bankQuery, creditCardBillsQuery } from "@/data/bank/queries";
  import {
    investmentsQuery,
    investmentTransactionsQuery,
  } from "@/data/investments/queries";
  import type { ApiClient } from "@/shared/api/client";
  import {
    formatCompactTwd,
    formatCurrency,
    formatDate,
    parseValidDate,
  } from "@/shared/format/financial";
  import Card from "@/shared/ui/Card.svelte";
  import EmptyState from "@/shared/ui/EmptyState.svelte";
  import InstitutionDetails from "./components/InstitutionDetails.svelte";
  import InvestmentWorkspace from "./components/InvestmentWorkspace.svelte";
  import NetWorthHistoryChart from "./components/NetWorthHistoryChart.svelte";
  import ManualAssets from "./ManualAssets.svelte";
  import { calculateAssetSummary } from "@/data/assets/summary";
  import type { InstitutionAssetGroup } from "@/data/assets/summary";

  type LedgerItem =
    | {
        key: string;
        kind: "institution";
        label: string;
        group: InstitutionAssetGroup;
      }
    | { key: "investments"; kind: "investments"; label: "投資" }
    | { key: "manual-assets"; kind: "manual-assets"; label: "其他資產" };

  let { api, navigate }: { api: ApiClient; navigate?: Navigate } = $props();

  const bank = createQuery(bankQuery(() => api));
  const bills = createQuery(creditCardBillsQuery(() => api));
  const investments = createQuery(investmentsQuery(() => api));
  const trades = createQuery(investmentTransactionsQuery(() => api));
  const manual = createQuery(manualAssetsQuery(() => api));
  const rates = createQuery(exchangeRatesQuery(() => api));
  const history = createQuery(netWorthHistoryQuery(() => api));

  const summary = $derived(
    calculateAssetSummary({
      bank: $bank.data ?? { accounts: [], transactions: [] },
      investments: $investments.data ?? [],
      manualAssets: $manual.data ?? [],
      rates: $rates.data,
    }),
  );
  /** 所有信用卡合計為溢繳（正餘額）時，負債欄改標溢繳；溢繳在淨資產中加回。 */
  const cardOverpaid = $derived(
    !summary.hasUnknownCardBalance && summary.cardDebt < 0,
  );
  const loading = $derived(
    $bank.isPending ||
      $investments.isPending ||
      $manual.isPending ||
      $rates.isPending,
  );
  const failed = $derived(
    $bank.isError || $investments.isError || $manual.isError || $rates.isError,
  );
  const ledgerItems = $derived<LedgerItem[]>([
    ...summary.institutionGroups.map((group): LedgerItem => ({
      key: group.key,
      kind: "institution",
      label: group.institution,
      group,
    })),
    ...(($investments.data?.length ?? 0) > 0
      ? ([{ key: "investments", kind: "investments", label: "投資" }] as const)
      : []),
    ...(($manual.data?.length ?? 0) > 0
      ? ([
          {
            key: "manual-assets",
            kind: "manual-assets",
            label: "其他資產",
          },
        ] as const)
      : []),
  ]);

  let selectedKey = $state<string>();
  let expandedKey = $state<string | null>(null);
  let otherAssets = $state<{ openAdd: () => void }>();
  const activeKey = $derived(
    selectedKey && ledgerItems.some((item) => item.key === selectedKey)
      ? selectedKey
      : ledgerItems[0]?.key,
  );
  const activeItem = $derived(
    ledgerItems.find((item) => item.key === activeKey),
  );
  const mobileExpandedKey = $derived(expandedKey);

  const ASSET_COLORS = {
    bank: "#3e6f7c",
    investment: "#6574cd",
    manual: "#b5853f",
  } as const;

  const allocation = $derived(
    [
      {
        key: "bank",
        label: "銀行與現金",
        value: summary.bankTotal,
        color: ASSET_COLORS.bank,
      },
      {
        key: "investment",
        label: "投資",
        value: summary.investmentTotal,
        color: ASSET_COLORS.investment,
      },
      {
        key: "manual",
        label: "其他資產",
        value: summary.manualTotal,
        color: ASSET_COLORS.manual,
      },
    ].filter((item) => item.value > 0),
  );
  const largestCurrency = $derived(summary.currencyBreakdown[0]?.totalTwd ?? 0);

  // 佔比分母見 AssetSummary.positiveAssetTotal。
  const positiveAssets = $derived(summary.positiveAssetTotal);
  const currencyTotal = $derived(
    summary.currencyBreakdown.reduce((sum, item) => sum + item.totalTwd, 0),
  );

  const STALE_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

  function latestTime(values: Array<string | undefined>) {
    const times = values
      .map((value) => parseValidDate(value)?.getTime())
      .filter((value): value is number => value !== undefined);
    return times.length ? Math.max(...times) : undefined;
  }

  const freshness = $derived(
    [
      ...summary.institutionGroups.map((group) => ({
        key: group.key,
        label: group.institution,
        latest: latestTime(
          [...group.accounts, ...group.cards].map((account) => account.asOfAt),
        ),
      })),
      ...(($investments.data?.length ?? 0) > 0
        ? [
            {
              key: "investments",
              label: "投資",
              latest: latestTime(
                ($investments.data ?? []).map((item) => item.asOfDate),
              ),
            },
          ]
        : []),
    ].map((item) => ({
      ...item,
      stale:
        item.latest === undefined || Date.now() - item.latest > STALE_AFTER_MS,
    })),
  );

  function share(value: number, total = positiveAssets) {
    if (value <= 0 || total <= 0) return 0;
    return Math.min((value / total) * 100, 100);
  }

  function formatShare(value: number, total = positiveAssets) {
    if (value < 0) return "—";
    const percent = share(value, total);
    return percent > 0 && percent < 1 ? "<1%" : `${Math.round(percent)}%`;
  }

  function toggleMobile(key: string) {
    expandedKey = mobileExpandedKey === key ? null : key;
  }
</script>

{#snippet kpi(
  label: string,
  value: number,
  caption: string,
  color: string,
  tone: string = "text-ink",
)}
  <Card class="min-w-0 p-4">
    <p class="flex items-center gap-1.5 text-caption text-subtle">
      <span class="size-2 shrink-0 rounded-full" style={`background:${color}`}
      ></span>
      {label}
    </p>
    <p
      class={`mt-2 text-lg font-semibold tracking-tight tabular-nums md:hidden ${tone}`}
    >
      {formatCompactTwd(value)}
    </p>
    <p
      class={`mt-2 hidden break-all text-xl font-semibold tracking-tight tabular-nums md:block ${tone}`}
    >
      {formatCurrency(value)}
    </p>
    <p class="mt-1 truncate text-caption text-subtle">{caption}</p>
  </Card>
{/snippet}

{#snippet shareBar(value: number, color: string)}
  <span
    class="block h-1.5 w-full overflow-hidden rounded-full bg-ink/6"
    aria-hidden="true"
  >
    <span
      class="block h-full rounded-full"
      style={`width:${Math.max(share(value), value > 0 ? 2 : 0)}%;background:${color}`}
    ></span>
  </span>
{/snippet}

{#snippet ledgerRow(
  key: string,
  title: string,
  subtitle: string,
  value: number | null,
  debt: string | null,
  color: string,
)}
  <button
    class={`grid min-h-[64px] w-full grid-cols-[minmax(0,1fr)_7rem_minmax(7.5rem,auto)] items-center gap-4 border-b border-ink/6 px-4 py-2 text-left transition last:border-b-0 hover:bg-ink/3 ${activeKey === key ? "bg-steel/6 shadow-[inset_3px_0_0_var(--color-steel)]" : ""}`}
    type="button"
    aria-pressed={activeKey === key}
    onclick={() => (selectedKey = key)}
  >
    <span class="min-w-0">
      <strong class="block truncate text-sm">{title}</strong>
      <small class="mt-0.5 block truncate text-caption text-subtle">
        {subtitle}
      </small>
    </span>
    <span class="grid gap-1">
      {@render shareBar(value ?? 0, color)}
      <small class="text-right text-caption tabular-nums text-subtle">
        {value ? formatShare(value) : "—"}
      </small>
    </span>
    <span class="text-right">
      <strong class="block text-sm tabular-nums">
        {value != null ? formatCurrency(value) : "—"}
      </strong>
      {#if debt}
        <small class="mt-0.5 block text-caption tabular-nums text-coral">
          {debt}
        </small>
      {/if}
    </span>
  </button>
{/snippet}

{#if loading}
  <EmptyState
    title="載入資產清冊中"
    body="正在彙整銀行、信用卡、投資與其他資產。"
  />
{:else if failed}
  <EmptyState
    alert
    title="無法載入資產清冊"
    body="部分必要資料目前無法取得，請稍後再試。"
  />
{:else}
  <div class="grid min-w-0 max-w-full gap-4 xl:gap-5">
    {#if summary.missingCurrencies.length > 0}
      <div
        class="rounded-xl border border-coral/25 bg-coral/5 px-4 py-3 text-sm text-ink"
        role="status"
      >
        <p class="font-semibold">部分外幣資產尚未納入新台幣總額</p>
        <p class="mt-1 text-caption text-subtle">
          缺少 {summary.missingCurrencies.join("、")} 匯率；原始幣別金額仍會顯示在清冊中。
        </p>
      </div>
    {/if}

    <!-- 上：KPI -->
    <section
      class="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-6 xl:gap-4"
      aria-label="資產摘要"
    >
      <Card
        class="col-span-2 min-w-0 border-steel/20 bg-steel/5 p-4 lg:col-span-2"
      >
        <p class="text-caption font-medium text-subtle">淨資產</p>
        <p
          class="mt-2 break-all text-[clamp(1.75rem,5vw,2.25rem)] leading-tight font-semibold tracking-tight tabular-nums"
        >
          {formatCurrency(summary.netWorth)}
        </p>
        <p class="mt-1 text-caption text-subtle">
          {summary.hasUnknownCardBalance
            ? `總資產 ${formatCurrency(summary.grossAssets)} · 信用卡負債資料不完整`
            : summary.cardDebt < 0
              ? `總資產 ${formatCurrency(summary.grossAssets)} ＋ 信用卡溢繳 ${formatCurrency(-summary.cardDebt)}`
              : `總資產 ${formatCurrency(summary.grossAssets)} − 卡債 ${formatCurrency(summary.cardDebt)}`}
        </p>
      </Card>
      {@render kpi(
        "銀行與現金",
        summary.bankTotal,
        `${summary.deposits.length} 個帳戶 · ${formatShare(summary.bankTotal)}`,
        ASSET_COLORS.bank,
      )}
      {@render kpi(
        "投資",
        summary.investmentTotal,
        `${$investments.data?.length ?? 0} 個持倉 · ${formatShare(summary.investmentTotal)}`,
        ASSET_COLORS.investment,
      )}
      {@render kpi(
        "其他資產",
        summary.manualTotal,
        `${$manual.data?.length ?? 0} 筆 · ${formatShare(summary.manualTotal)}`,
        ASSET_COLORS.manual,
      )}
      {@render kpi(
        cardOverpaid ? "信用卡溢繳" : "信用卡負債",
        -summary.cardDebt,
        summary.hasUnknownCardBalance
          ? "部分卡片資料不完整"
          : `${summary.institutionGroups.filter((group) => group.cards.length > 0).length} 家發卡行`,
        cardOverpaid ? "var(--color-steel)" : "var(--color-coral)",
        cardOverpaid ? "text-steel" : "text-coral",
      )}
    </section>

    <!-- 中：資產總表（左）＋明細（右） -->
    {#if ledgerItems.length === 0}
      <EmptyState
        title="尚無資產資料"
        body="完成資料來源同步，或新增一筆其他資產後即可在此查看。"
      />
    {:else}
      <section
        class="hidden min-w-0 grid-cols-12 gap-4 xl:grid xl:gap-5"
        aria-label="資產清冊"
      >
        <Card
          class="col-span-7 flex h-[540px] min-h-0 flex-col overflow-hidden"
        >
          <header
            class="flex items-center justify-between gap-3 border-b border-ink/10 px-4 py-3"
          >
            <div>
              <h2 class="font-semibold">資產總表</h2>
              <p class="mt-0.5 text-caption text-subtle">
                同一金融機構的帳戶與信用卡合併顯示；點選查看明細
              </p>
            </div>
            <span class="text-caption text-subtle">
              {ledgerItems.length} 項
            </span>
          </header>
          <div
            class="grid grid-cols-[minmax(0,1fr)_7rem_minmax(7.5rem,auto)] gap-4 border-b border-ink/6 bg-ink/2 px-4 py-1.5 text-caption font-medium text-subtle"
          >
            <span>名稱</span>
            <span class="text-right">佔比</span>
            <span class="text-right">金額／卡債</span>
          </div>
          <div class="min-h-0 flex-1 overflow-y-auto">
            {#each summary.institutionGroups as group (group.key)}
              {@render ledgerRow(
                group.key,
                group.institution,
                `${group.accounts.length} 帳戶 · ${group.cards.length} 卡片${group.foreignCurrencies.length ? ` · 含 ${group.foreignCurrencies.join("、")}` : ""}`,
                group.accounts.length ? group.assetTotalTwd : null,
                group.cards.length
                  ? group.hasUnknownCardBalance
                    ? "負債資料不完整"
                    : `${group.debtTotalTwd < 0 ? "溢繳" : "負債"} ${formatCurrency(-group.debtTotalTwd)}`
                  : null,
                ASSET_COLORS.bank,
              )}
            {/each}
            {#if ($investments.data?.length ?? 0) > 0}
              {@render ledgerRow(
                "investments",
                "投資",
                `${$investments.data?.length ?? 0} 個持倉 · 持倉與交易紀錄`,
                summary.investmentTotal,
                null,
                ASSET_COLORS.investment,
              )}
            {/if}
            {#if ($manual.data?.length ?? 0) > 0}
              {@render ledgerRow(
                "manual-assets",
                "其他資產",
                `${$manual.data?.length ?? 0} 筆 · 手動維護估值`,
                summary.manualTotal,
                null,
                ASSET_COLORS.manual,
              )}
            {/if}
          </div>
          <footer
            class="flex items-center justify-between gap-3 border-t border-ink/10 bg-ink/2 px-4 py-2.5 text-sm"
          >
            <span class="font-medium text-subtle">總資產</span>
            <strong class="tabular-nums">
              {formatCurrency(summary.grossAssets)}
            </strong>
          </footer>
        </Card>

        <Card class="col-span-5 h-[540px] min-h-0 overflow-y-auto">
          {#if activeItem?.kind === "institution"}
            <InstitutionDetails
              group={activeItem.group}
              bills={$bills.data ?? []}
              billsPending={$bills.isPending}
              billsError={$bills.isError}
            />
          {:else if activeItem?.kind === "investments"}
            <InvestmentWorkspace
              positions={$investments.data ?? []}
              trades={$trades.data ?? []}
              total={summary.investmentTotal}
              tradesPending={$trades.isPending}
              tradesError={$trades.isError}
            />
          {:else if activeItem?.kind === "manual-assets"}
            <ManualAssets {api} variant="embedded" />
          {/if}
        </Card>
      </section>

      <section
        class="grid rounded-xl border border-border bg-card px-4 pt-4 pb-2 shadow-xs xl:hidden"
        aria-label="資產清冊"
      >
        {#if summary.institutionGroups.length > 0}
          <div class="flex items-start justify-between gap-3 pb-1">
            <div class="min-w-0">
              <h2 class="text-base font-semibold">金融機構</h2>
              <p class="mt-1 text-caption text-subtle">
                {summary.institutionGroups.length} 個機構
              </p>
            </div>
            <strong
              class="text-lg font-medium tracking-tight tabular-nums text-steel"
            >
              {formatCurrency(summary.bankTotal)}
            </strong>
          </div>
          {#each summary.institutionGroups as group (group.key)}
            <div
              class={mobileExpandedKey === group.key
                ? "border-b border-ink/15 last:border-b-0"
                : "border-b border-ink/8 last:border-b-0"}
            >
              <button
                class="grid min-h-[72px] w-full grid-cols-[minmax(0,1fr)_auto_16px] items-center gap-3 py-2 text-left"
                type="button"
                aria-expanded={mobileExpandedKey === group.key}
                onclick={() => toggleMobile(group.key)}
              >
                <span class="min-w-0">
                  <strong class="block truncate text-sm">
                    {group.institution}
                  </strong>
                  <small class="mt-1 block truncate text-caption text-subtle">
                    {group.accounts.length} 帳戶 · {group.cards.length} 卡片{group
                      .foreignCurrencies.length
                      ? ` · 含 ${group.foreignCurrencies.join("、")}`
                      : ""}
                  </small>
                </span>
                <span class="text-right">
                  <strong class="block text-sm tabular-nums text-steel">
                    {group.accounts.length
                      ? formatCurrency(group.assetTotalTwd)
                      : "—"}
                  </strong>
                  <small
                    class={`mt-1 block text-caption tabular-nums ${group.cards.length ? "text-coral" : "text-subtle"}`}
                  >
                    {group.cards.length
                      ? group.hasUnknownCardBalance
                        ? "負債資料不完整"
                        : `${group.debtTotalTwd < 0 ? "溢繳" : "負債"} ${formatCurrency(-group.debtTotalTwd)}`
                      : "無信用卡"}
                  </small>
                </span>
                <ChevronRight
                  class={`size-4 text-subtle transition ${mobileExpandedKey === group.key ? "rotate-90" : ""}`}
                />
              </button>
              {#if mobileExpandedKey === group.key}
                <div class="border-t border-ink/8 pb-5 pl-4 pt-3">
                  <InstitutionDetails
                    {group}
                    bills={$bills.data ?? []}
                    billsPending={$bills.isPending}
                    billsError={$bills.isError}
                    compact
                  />
                </div>
              {/if}
            </div>
          {/each}
        {/if}

        {#if ($investments.data?.length ?? 0) > 0}
          <div class="border-t border-ink/10 pt-5">
            <div class="flex items-start justify-between gap-3 pb-1">
              <div class="min-w-0">
                <h2 class="text-base font-semibold">投資</h2>
                <p class="mt-1 text-caption text-subtle">
                  {$investments.data?.length ?? 0} 個持倉 · 交易紀錄
                </p>
              </div>
              <strong
                class="text-lg font-medium tracking-tight tabular-nums text-steel"
              >
                {formatCurrency(summary.investmentTotal)}
              </strong>
            </div>
            <InvestmentWorkspace
              positions={$investments.data ?? []}
              trades={$trades.data ?? []}
              total={summary.investmentTotal}
              tradesPending={$trades.isPending}
              tradesError={$trades.isError}
              compact
            />
          </div>
        {/if}

        <div class="border-t border-ink/10 pt-5">
          <div class="flex items-start justify-between gap-3 pb-1">
            <div class="min-w-0">
              <h2 class="text-base font-semibold">其他資產</h2>
              <p class="mt-1 text-caption text-subtle">
                {$manual.data?.length ?? 0} 筆 · 估值歷史
              </p>
            </div>
            <div class="shrink-0 text-right">
              <strong
                class="text-lg font-medium tracking-tight tabular-nums text-moss"
              >
                {formatCurrency(summary.manualTotal)}
              </strong>
              <button
                type="button"
                class="mt-1 block w-full text-sm font-medium text-steel hover:text-steel/80"
                onclick={() => otherAssets?.openAdd()}
              >
                新增資產
              </button>
            </div>
          </div>
          <ManualAssets
            bind:this={otherAssets}
            {api}
            variant="embedded"
            hideSummary={true}
          />
        </div>
      </section>
    {/if}

    <!-- 下：走勢（左）＋配置、幣別（右） -->
    <section
      class="grid min-w-0 gap-4 xl:grid-cols-12 xl:gap-5"
      aria-label="資產走勢與配置"
    >
      <Card class="min-w-0 p-4 md:p-5 xl:col-span-8">
        <NetWorthHistoryChart
          data={$history.data ?? []}
          loading={$history.isPending}
        />
      </Card>

      <div
        class="grid min-w-0 content-start gap-4 md:grid-cols-2 xl:col-span-4 xl:grid-cols-1 xl:gap-5"
      >
        <Card class="min-w-0 p-4 md:p-5">
          <div class="flex items-baseline justify-between gap-3">
            <h2 class="font-semibold">資產配置</h2>
            <span class="text-caption tabular-nums text-subtle">
              合計 {formatCompactTwd(positiveAssets)}
            </span>
          </div>
          {#if allocation.length > 0}
            <div
              class="mt-4 flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-ink/6"
              role="img"
              aria-label={allocation
                .map((item) => `${item.label} ${formatShare(item.value)}`)
                .join("、")}
            >
              {#each allocation as item (item.key)}
                <span
                  class="h-full first:rounded-l-full last:rounded-r-full"
                  style={`width:${share(item.value)}%;background:${item.color}`}
                  title={`${item.label} ${formatShare(item.value)}`}
                ></span>
              {/each}
            </div>
          {:else}
            <p class="mt-4 text-caption text-subtle">尚無正值資產</p>
          {/if}
          <ul class="mt-4 grid gap-2.5 text-sm">
            {#each allocation as item (item.key)}
              <li
                class="grid grid-cols-[minmax(0,1fr)_auto_3rem] items-center gap-3"
              >
                <span class="flex min-w-0 items-center gap-2">
                  <span
                    class="size-2.5 shrink-0 rounded-full"
                    style={`background:${item.color}`}
                  ></span>
                  <span class="truncate">{item.label}</span>
                </span>
                <span class="tabular-nums">{formatCurrency(item.value)}</span>
                <span class="text-right tabular-nums text-subtle">
                  {formatShare(item.value)}
                </span>
              </li>
            {/each}
            <li
              class="grid grid-cols-[minmax(0,1fr)_auto_3rem] items-center gap-3 border-t border-ink/8 pt-2.5"
            >
              <span class="text-subtle"
                >{cardOverpaid ? "信用卡溢繳" : "信用卡負債"}</span
              >
              <span
                class={`tabular-nums ${cardOverpaid ? "text-steel" : "text-coral"}`}
              >
                {summary.hasUnknownCardBalance
                  ? "資料不完整"
                  : formatCurrency(-summary.cardDebt)}
              </span>
              <span></span>
            </li>
            <li
              class="grid grid-cols-[minmax(0,1fr)_auto_3rem] items-center gap-3"
            >
              <span class="font-semibold">淨資產</span>
              <strong class="tabular-nums">
                {formatCurrency(summary.netWorth)}
              </strong>
              <span></span>
            </li>
          </ul>
        </Card>

        <Card class="min-w-0 p-4 md:p-5">
          <div class="flex items-baseline justify-between gap-3">
            <h2 class="font-semibold">資料更新</h2>
            <span class="text-caption text-subtle">超過 3 天標示</span>
          </div>
          <ul class="mt-3 grid gap-2 text-sm">
            {#each freshness as item (item.key)}
              <li class="flex items-center justify-between gap-3">
                <span class="flex min-w-0 items-center gap-2">
                  <span
                    class={`size-2 shrink-0 rounded-full ${item.stale ? "bg-coral" : "bg-moss"}`}
                  ></span>
                  <span class="truncate">{item.label}</span>
                </span>
                <span
                  class={`shrink-0 text-caption tabular-nums ${item.stale ? "font-medium text-coral" : "text-subtle"}`}
                >
                  {item.latest !== undefined
                    ? formatDate(new Date(item.latest).toISOString())
                    : "尚未同步"}
                  {#if item.latest !== undefined && item.stale}
                    <span class="ml-1">· 已過期</span>
                  {/if}
                </span>
              </li>
            {/each}
          </ul>
        </Card>

        {#if summary.currencyBreakdown.length > 1}
          <Card class="min-w-0 p-4 md:p-5">
            <div class="flex items-baseline justify-between gap-3">
              <h2 class="font-semibold">幣別分布</h2>
              <span class="text-caption text-subtle">折合新台幣</span>
            </div>
            <ul class="mt-4 grid gap-3 text-sm">
              {#each summary.currencyBreakdown as item (item.currency)}
                <li
                  class="grid grid-cols-[3rem_minmax(0,1fr)_auto_3rem] items-center gap-3"
                >
                  <span class="font-medium">{item.currency}</span>
                  <span
                    class="block h-2 overflow-hidden rounded-full bg-ink/6"
                    aria-hidden="true"
                  >
                    <span
                      class="block h-full rounded-full bg-steel"
                      style={`width:${largestCurrency > 0 ? Math.max((item.totalTwd / largestCurrency) * 100, 2) : 0}%`}
                    ></span>
                  </span>
                  <span class="tabular-nums">
                    {formatCompactTwd(item.totalTwd)}
                  </span>
                  <span class="text-right tabular-nums text-subtle">
                    {formatShare(item.totalTwd, currencyTotal)}
                  </span>
                </li>
              {/each}
            </ul>
          </Card>
        {/if}
      </div>
    </section>

    <button
      type="button"
      class="flex min-h-14 min-w-0 items-center justify-between gap-3 rounded-xl border border-ink/10 bg-card px-4 text-left transition hover:bg-ink/3"
      onclick={() =>
        navigate
          ? navigate("own-accounts")
          : (window.location.hash = "#/own-accounts")}
    >
      <span class="min-w-0">
        <span class="block text-sm font-semibold">我的其他帳戶</span>
        <span class="block text-caption text-subtle"
          >無法同步的自有帳戶與卡片；轉入轉出不計入收支</span
        >
      </span>
      <ChevronRight class="size-4 shrink-0 text-subtle" />
    </button>
  </div>
{/if}
