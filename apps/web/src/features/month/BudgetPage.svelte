<!--
  可花設定（#/month/budget）：每月消費預算、預期月收入（估計可存下多少）、年繳準備金，以及固定支出。
  固定支出由近幾個完整月份每月都出現、金額穩定的商家自動偵測，使用者只要確認「每月固定／年繳／不是」。
-->
<script lang="ts">
  import {
    createMutation,
    createQuery,
    useQueryClient,
  } from "@tanstack/svelte-query";
  import type { Navigate } from "@/app/types";
  import {
    budgetQuery,
    type BudgetMerchantKind,
    type BudgetSettings,
  } from "@/data/budget/queries";
  import type { ApiClient } from "@/shared/api/client";
  import { queryKeys } from "@/shared/api/query-keys";
  import { formatCurrency } from "@/shared/format/financial";
  import Button from "@/shared/ui/Button.svelte";
  import Card from "@/shared/ui/Card.svelte";
  import EmptyState from "@/shared/ui/EmptyState.svelte";
  import Input from "@/shared/ui/Input.svelte";

  let { api, navigate }: { api: ApiClient; navigate: Navigate } = $props();

  const qc = useQueryClient();
  /** 與 API 的上限相同。 */
  const MAX_AMOUNT = 1_000_000_000;
  const budget = createQuery(budgetQuery(() => api));
  const invalidate = () => qc.invalidateQueries({ queryKey: queryKeys.budget });

  // 表單欄位以字串保存；預算空字串代表還沒設定，收入空字串代表由歷史推算，年繳空字串為 0。
  let budgetText = $state("");
  let incomeText = $state("");
  let annualText = $state("");
  let loadedFrom = $state<string | null>(null);
  $effect(() => {
    const settings = $budget.data?.settings;
    const key = settings ? JSON.stringify(settings) : null;
    if (!settings || key === loadedFrom) return;
    loadedFrom = key;
    budgetText =
      settings.monthlyBudget == null ? "" : String(settings.monthlyBudget);
    incomeText =
      settings.expectedIncome == null ? "" : String(settings.expectedIncome);
    annualText = settings.annualReserve ? String(settings.annualReserve) : "";
  });

  function parseAmount(text: string) {
    const value = Number(text.replace(/[,\s]/g, ""));
    return Number.isFinite(value) && value >= 0 ? value : Number.NaN;
  }
  const form = $derived.by(() => {
    const monthlyBudget = budgetText.trim() ? parseAmount(budgetText) : null;
    const expectedIncome = incomeText.trim() ? parseAmount(incomeText) : null;
    const annualReserve = annualText.trim() ? parseAmount(annualText) : 0;
    const errors: string[] = [];
    if (monthlyBudget != null && Number.isNaN(monthlyBudget))
      errors.push("每月預算要是 0 以上的數字。");
    if (expectedIncome != null && Number.isNaN(expectedIncome))
      errors.push("預期月收入要是 0 以上的數字。");
    if (Number.isNaN(annualReserve)) errors.push("年繳總額要是 0 以上的數字。");
    if (
      [monthlyBudget ?? 0, expectedIncome ?? 0, annualReserve].some(
        (value) => value > MAX_AMOUNT,
      )
    )
      errors.push("金額太大了。");
    return {
      errors,
      settings: {
        monthlyBudget,
        expectedIncome,
        annualReserve,
      } satisfies BudgetSettings,
    };
  });
  const previewSavings = $derived.by(() => {
    // 收入欄留白時，以歷史推算的收入預覽（不是之前儲存的設定值）。
    const income =
      form.settings.expectedIncome ?? $budget.data?.historicalIncome ?? null;
    const monthly = form.settings.monthlyBudget;
    if (
      income == null ||
      monthly == null ||
      Number.isNaN(income) ||
      Number.isNaN(monthly) ||
      Number.isNaN(form.settings.annualReserve)
    )
      return null;
    return income - monthly - form.settings.annualReserve / 12;
  });

  // 「已儲存」只在表單內容仍與儲存時相同時顯示。
  let savedKey = $state<string | null>(null);
  const saveSettings = createMutation({
    mutationFn: (settings: BudgetSettings) =>
      api.put("/api/budget/settings", settings),
    onSuccess: (_result, settings) => {
      savedKey = JSON.stringify(settings);
      return invalidate();
    },
  });
  const savedCurrent = $derived(
    savedKey != null && savedKey === JSON.stringify(form.settings),
  );
  // 每月金額輸入無效時的提示（依商家）。
  let amountErrors = $state<Record<string, boolean>>({});
  const saveMerchant = createMutation({
    mutationFn: (input: {
      merchantKey: string;
      kind: BudgetMerchantKind;
      displayName: string;
      expectedAmount: number | null;
    }) =>
      api.put(
        `/api/budget/merchants/${encodeURIComponent(input.merchantKey)}`,
        {
          kind: input.kind,
          displayName: input.displayName,
          expectedAmount: input.expectedAmount,
        },
      ),
    onSuccess: invalidate,
  });
  const removeMerchant = createMutation({
    mutationFn: (merchantKey: string) =>
      api.delete(`/api/budget/merchants/${encodeURIComponent(merchantKey)}`),
    onSuccess: invalidate,
  });

  const KIND_LABELS: Record<BudgetMerchantKind, string> = {
    monthly: "每月固定",
    annual: "年繳",
    not_fixed: "不是固定",
  };

  function amountInput(event: Event) {
    const text = (event.currentTarget as HTMLInputElement).value.trim();
    if (!text) return null;
    const value = parseAmount(text);
    return Number.isNaN(value) || value > MAX_AMOUNT ? undefined : value;
  }
</script>

{#if $budget.isPending}
  <EmptyState title="載入可花設定中" body="正在整理收入與固定支出。" />
{:else if $budget.isError || !$budget.data}
  <EmptyState alert title="無法載入可花設定" body="請稍後再試。" />
{:else}
  {@const data = $budget.data}
  <div class="grid min-w-0 gap-4 xl:grid-cols-12 xl:gap-5">
    <Card class="min-w-0 p-4 md:p-5 xl:col-span-5">
      <form
        class="grid gap-4"
        onsubmit={(event) => {
          event.preventDefault();
          if (form.errors.length === 0) $saveSettings.mutate(form.settings);
        }}
      >
        <div>
          <h2 class="font-semibold">每月預算</h2>
          <p class="mt-1 text-caption text-subtle">
            本月可花 = 每月預算 − 本月已花 − 固定支出待扣（年繳另由準備金支付）
          </p>
        </div>

        <label class="grid gap-1.5">
          <span class="text-sm font-medium">每月消費預算</span>
          <Input
            inputmode="numeric"
            placeholder={data.typicalSpending != null
              ? `過去每月約花 ${formatCurrency(data.typicalSpending)}`
              : "例如 40000"}
            bind:value={budgetText}
          />
          <span class="text-caption text-subtle">
            含每月固定支出（訂閱、房租等），不含年繳。{#if data.typicalSpending != null}過去
              {data.historyMonths.length} 個完整月份每月約花 {formatCurrency(
                data.typicalSpending,
              )}，可以設低一點逼自己省。{/if}
          </span>
        </label>

        <label class="grid gap-1.5">
          <span class="text-sm font-medium">預期月收入（選填）</span>
          <Input
            inputmode="numeric"
            placeholder={data.historicalIncome != null
              ? `留白：用近 ${data.historyMonths.length} 個月推算的 ${formatCurrency(data.historicalIncome)}`
              : "例如 160000"}
            bind:value={incomeText}
          />
          <span class="text-caption text-subtle">
            {#if previewSavings != null && previewSavings < 0}
              照這個預算和年繳準備，每月還差 {formatCurrency(-previewSavings)}。
            {:else if previewSavings != null}
              照這個預算，每月約可存下 {formatCurrency(previewSavings)}（收入 −
              預算 − 年繳準備金）。
            {:else}
              用來估計照預算每月可存下多少。
            {/if}
          </span>
        </label>

        <label class="grid gap-1.5">
          <span class="text-sm font-medium">一年的年繳大額總額</span>
          <Input
            inputmode="numeric"
            placeholder="保險、稅、年費、旅遊等，例如 60000"
            bind:value={annualText}
          />
          <span class="text-caption text-subtle">
            {#if form.settings.annualReserve > 0 && !Number.isNaN(form.settings.annualReserve)}
              每月先提撥 {formatCurrency(
                form.settings.annualReserve / 12,
              )}；下方標成「年繳」的商家付款時不扣本月可花。
            {:else}
              每月先提撥十二分之一，付款那個月不會一下子變成超支。
            {/if}
          </span>
        </label>

        {#if form.errors.length > 0}
          <ul class="text-caption text-coral">
            {#each form.errors as error (error)}<li>{error}</li>{/each}
          </ul>
        {/if}
        {#if $saveSettings.isError}
          <p class="text-caption text-coral">儲存失敗，請再試一次。</p>
        {:else if savedCurrent}
          <p class="text-caption text-moss" role="status">已儲存。</p>
        {/if}
        <div class="flex gap-2">
          <Button
            type="submit"
            disabled={form.errors.length > 0 || $saveSettings.isPending}
            >{$saveSettings.isPending ? "儲存中…" : "儲存"}</Button
          >
          <Button
            type="button"
            variant="outline"
            onclick={() => navigate("month")}>回到本月</Button
          >
        </div>
      </form>
    </Card>

    <div class="grid min-w-0 content-start gap-4 xl:col-span-7 xl:gap-5">
      <Card class="min-w-0 p-4 md:p-5" as="section">
        <h2 class="font-semibold">可能的固定支出</h2>
        <p class="mt-1 text-caption text-subtle">
          近 {data.historyMonths.length} 個完整月份每個月都有、金額差不多的商家（資料不完整的月份不採用）。確認後，還沒扣款的部分會先從本月可花預留。
        </p>
        {#if data.candidates.length === 0}
          <p class="mt-3 text-sm text-subtle">目前沒有新的候選。</p>
        {:else}
          <ul class="mt-3 divide-y divide-border">
            {#each data.candidates as candidate (candidate.merchantKey)}
              <li
                class="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
              >
                <div class="min-w-0">
                  <p class="break-words text-sm font-medium">
                    {candidate.displayName}
                  </p>
                  <p class="text-caption text-subtle tabular-nums">
                    每月約 {formatCurrency(
                      candidate.typicalAmount,
                    )}（{candidate.monthlyAmounts
                      .map((amount) => formatCurrency(amount))
                      .join("、")}）
                  </p>
                </div>
                <div class="flex flex-wrap gap-1.5">
                  {#each ["monthly", "annual", "not_fixed"] as const as kind (kind)}
                    <Button
                      size="sm"
                      variant={kind === "not_fixed" ? "outline" : "secondary"}
                      disabled={$saveMerchant.isPending}
                      onclick={() =>
                        $saveMerchant.mutate({
                          merchantKey: candidate.merchantKey,
                          kind,
                          displayName: candidate.displayName,
                          expectedAmount: null,
                        })}>{KIND_LABELS[kind]}</Button
                    >
                  {/each}
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </Card>

      <Card class="min-w-0 p-4 md:p-5" as="section">
        <h2 class="font-semibold">已確認的固定支出</h2>
        {#if data.fixedMerchants.length === 0}
          <p class="mt-3 text-sm text-subtle">還沒有確認任何固定支出。</p>
        {:else}
          <ul class="mt-2 divide-y divide-border">
            {#each data.fixedMerchants as merchant (merchant.merchantKey)}
              <li
                class="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
              >
                <div class="min-w-0">
                  <p class="break-words text-sm font-medium">
                    {merchant.displayName}
                  </p>
                  <p class="text-caption text-subtle">
                    {#if merchant.kind === "annual"}
                      年繳：本月付了 {formatCurrency(
                        merchant.paidThisMonth,
                      )}，由準備金支付
                    {:else}
                      每月 {formatCurrency(
                        merchant.expectedAmount,
                      )}{merchant.expectedAmountSource === "history"
                        ? `（近 ${data.historyMonths.length} 個月推算）`
                        : ""} · 本月已扣 {formatCurrency(
                        merchant.paidThisMonth,
                      )}
                    {/if}
                  </p>
                </div>
                <div class="flex flex-wrap items-center gap-1.5">
                  <select
                    class="h-9 rounded-md border border-input bg-background px-2 text-sm"
                    aria-label={`${merchant.displayName} 的類型`}
                    value={merchant.kind}
                    onchange={(event) =>
                      $saveMerchant.mutate({
                        merchantKey: merchant.merchantKey,
                        kind: (event.currentTarget as HTMLSelectElement)
                          .value as BudgetMerchantKind,
                        displayName: merchant.displayName,
                        expectedAmount:
                          merchant.expectedAmountSource === "user"
                            ? merchant.expectedAmount
                            : null,
                      })}
                  >
                    {#each ["monthly", "annual", "not_fixed"] as const as kind (kind)}
                      <option value={kind}>{KIND_LABELS[kind]}</option>
                    {/each}
                  </select>
                  {#if merchant.kind === "monthly"}
                    <input
                      class="h-9 w-28 rounded-md border border-input bg-background px-2 text-right text-sm tabular-nums"
                      inputmode="numeric"
                      aria-label={`${merchant.displayName} 每月金額`}
                      placeholder={String(Math.round(merchant.expectedAmount))}
                      value={merchant.expectedAmountSource === "user"
                        ? String(merchant.expectedAmount)
                        : ""}
                      onchange={(event) => {
                        const expectedAmount = amountInput(event);
                        amountErrors = {
                          ...amountErrors,
                          [merchant.merchantKey]: expectedAmount === undefined,
                        };
                        if (expectedAmount === undefined) return;
                        $saveMerchant.mutate({
                          merchantKey: merchant.merchantKey,
                          kind: merchant.kind,
                          displayName: merchant.displayName,
                          expectedAmount,
                        });
                      }}
                    />
                  {/if}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={$removeMerchant.isPending}
                    onclick={() => $removeMerchant.mutate(merchant.merchantKey)}
                    >移除</Button
                  >
                </div>
                {#if amountErrors[merchant.merchantKey]}
                  <p class="text-caption text-coral sm:col-span-2">
                    每月金額要是 0 以上的數字，留白則用推算值。
                  </p>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
        {#if $saveMerchant.isError || $removeMerchant.isError}
          <p class="mt-2 text-caption text-coral">更新失敗，請再試一次。</p>
        {/if}
      </Card>

      {#if data.annualWithoutReserve}
        <p
          class="rounded-lg bg-amber-50 px-4 py-3 text-caption text-amber-900"
          role="status"
        >
          有商家標成「年繳」，但年繳總額是
          0：這些付款目前照常扣本月可花。填入一年的年繳總額後，每月先提撥、付款時就不再扣可花。
        </p>
      {/if}

      {#if data.largeMerchants.length > 0}
        <Card class="min-w-0 p-4 md:p-5" as="section">
          <h2 class="font-semibold">本月的大筆消費</h2>
          <p class="mt-1 text-caption text-subtle">
            年繳（保險、稅、年費）一年只出現一次，不會出現在上面的候選；在這裡標成「年繳」後，由年繳準備金支付，不扣本月可花。
          </p>
          <ul class="mt-3 divide-y divide-border">
            {#each data.largeMerchants as merchant (merchant.merchantKey)}
              <li
                class="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
              >
                <div class="min-w-0">
                  <p class="break-words text-sm font-medium">
                    {merchant.displayName}
                  </p>
                  <p class="text-caption text-subtle tabular-nums">
                    本月 {merchant.count} 筆 · {formatCurrency(
                      merchant.amountThisMonth,
                    )}
                  </p>
                </div>
                <div class="flex flex-wrap gap-1.5">
                  {#each ["annual", "monthly", "not_fixed"] as const as kind (kind)}
                    <Button
                      size="sm"
                      variant={kind === "not_fixed" ? "outline" : "secondary"}
                      disabled={$saveMerchant.isPending}
                      onclick={() =>
                        $saveMerchant.mutate({
                          merchantKey: merchant.merchantKey,
                          kind,
                          displayName: merchant.displayName,
                          expectedAmount: null,
                        })}>{KIND_LABELS[kind]}</Button
                    >
                  {/each}
                </div>
              </li>
            {/each}
          </ul>
        </Card>
      {/if}

      {#if data.excludedMerchants.length > 0}
        <Card class="min-w-0 p-4 md:p-5" as="section">
          <details>
            <summary class="cursor-pointer text-sm font-semibold">
              已排除（{data.excludedMerchants.length}）
            </summary>
            <p class="mt-1 text-caption text-subtle">
              標成「不是固定」的商家不再列入候選；移除判斷後會重新偵測。
            </p>
            <ul class="mt-2 divide-y divide-border">
              {#each data.excludedMerchants as merchant (merchant.merchantKey)}
                <li class="flex items-center justify-between gap-3 py-2">
                  <span class="min-w-0 break-words text-sm">
                    {merchant.displayName}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={$removeMerchant.isPending}
                    onclick={() => $removeMerchant.mutate(merchant.merchantKey)}
                    >移除判斷</Button
                  >
                </li>
              {/each}
            </ul>
          </details>
        </Card>
      {/if}
    </div>
  </div>
{/if}
