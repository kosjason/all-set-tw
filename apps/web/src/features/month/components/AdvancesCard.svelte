<!--
  代墊待收回：依對象列出別人還欠多少（代墊 − 收回）。不分月份；只有台幣合計，
  其他幣別另列不換匯。已結清的對象收合，只顯示人數。沒有任何代墊時不顯示。
-->
<script lang="ts">
  import { ChevronDown } from "@lucide/svelte";
  import type { AdvanceCounterpartySummary } from "@taiwan-fin-hub/core";
  import type { AdvancesResponse } from "@/data/advances/queries";
  import { formatCurrency } from "@/shared/format/financial";

  let { advances }: { advances: AdvancesResponse } = $props();

  const open = $derived(
    advances.counterparties.filter((entry) =>
      Object.values(entry.balances).some((balance) => balance !== 0),
    ),
  );
  const settledCount = $derived(advances.counterparties.length - open.length);
  const owed = $derived(
    open.reduce((sum, entry) => sum + Math.max(entry.balances.TWD ?? 0, 0), 0),
  );
  const overpaid = $derived(
    open.reduce(
      (sum, entry) => sum + Math.max(-(entry.balances.TWD ?? 0), 0),
      0,
    ),
  );

  function money(amount: number, currency: string) {
    return currency === "TWD"
      ? formatCurrency(amount)
      : `${currency} ${amount.toLocaleString("zh-TW")}`;
  }
  function status(entry: AdvanceCounterpartySummary) {
    return Object.entries(entry.balances)
      .filter(([, balance]) => balance !== 0)
      .map(([currency, balance]) =>
        balance > 0
          ? `還欠 ${money(balance, currency)}`
          : `多給 ${money(-balance, currency)}`,
      )
      .join("、");
  }
  function shortDate(day: string) {
    return `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;
  }
</script>

<section
  class="rounded-xl border border-border bg-card p-4 shadow-xs md:p-5"
  aria-label="代墊待收回"
  data-testid="month-advances"
>
  <h2 class="text-caption font-medium text-subtle">代墊待收回</h2>
  <p
    class="mt-1 text-[clamp(1.25rem,3.5vw,1.6rem)] leading-tight font-semibold tracking-tight tabular-nums"
    data-testid="advances-owed"
  >
    {formatCurrency(owed)}
  </p>
  <p class="mt-1 text-caption text-subtle">
    {open.length > 0
      ? `${open.length} 人還沒結清${overpaid > 0 ? `；有人多給 ${formatCurrency(overpaid)}` : ""}`
      : "代墊都已結清"}
  </p>

  {#if open.length > 0}
    <ul class="mt-3 grid gap-1">
      {#each open as entry (entry.name)}
        <li>
          <details class="group rounded-lg">
            <summary
              class="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-2 py-2 text-sm hover:bg-ink/3"
            >
              <span class="min-w-0 truncate font-medium">{entry.name}</span>
              <span class="flex shrink-0 items-center gap-1">
                <span
                  class={`tabular-nums ${(entry.balances.TWD ?? 0) < 0 ? "text-moss" : ""}`}
                  >{status(entry)}</span
                >
                <ChevronDown
                  class="size-3.5 text-subtle transition group-open:rotate-180"
                />
              </span>
            </summary>
            <ul
              class="mt-1 grid gap-1 border-l border-border pl-3 text-caption"
            >
              {#each entry.entries as item (item.id)}
                <li class="flex items-baseline justify-between gap-3">
                  <span class="min-w-0 truncate text-subtle">
                    {shortDate(item.day)}
                    {item.role === "advance" ? "代墊" : "收回"} · {item.displayName}{item.pending
                      ? "（待入帳）"
                      : ""}
                  </span>
                  <span class="shrink-0 tabular-nums"
                    >{item.receivableDelta > 0 ? "+" : "−"}{money(
                      Math.abs(item.receivableDelta),
                      item.currency,
                    )}</span
                  >
                </li>
              {/each}
            </ul>
          </details>
        </li>
      {/each}
    </ul>
  {/if}
  {#if settledCount > 0}
    <p class="mt-2 text-caption text-subtle">已結清 {settledCount} 人</p>
  {/if}
  {#if !advances.complete}
    <p class="mt-2 text-caption text-amber-900">
      部分資料載入有問題或超過 36 個月，金額可能不完整。
    </p>
  {/if}
</section>
