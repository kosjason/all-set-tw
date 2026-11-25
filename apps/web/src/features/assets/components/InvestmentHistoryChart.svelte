<!--
  單一持股的市值與本金走勢（集保每日快照）。本金為 null 的日子不畫本金線。
  - history：每日市值與當天本金。
-->
<script lang="ts">
  import { LineChart } from "layerchart";
  import type { InvestmentHistoryPoint } from "@taiwan-fin-hub/shared";
  import {
    ChartContainer,
    ChartTooltip,
    type ChartConfig,
  } from "@/shared/ui/chart";
  import {
    formatCompactTwd,
    formatCurrency,
    formatDate,
  } from "@/shared/format/financial";

  let { history }: { history: InvestmentHistoryPoint[] } = $props();

  const chartConfig: ChartConfig = {
    marketValue: { label: "市值", color: "#3e6f7c" },
    costBasis: { label: "本金", color: "#b5853f" },
  };

  type Point = { date: Date; marketValue: number; costBasis?: number };
  const data = $derived<Point[]>(
    history.map((point) => ({
      date: new Date(`${point.date}T00:00:00`),
      marketValue: point.marketValue,
      ...(point.costBasis == null ? {} : { costBasis: point.costBasis }),
    })),
  );
  const hasCost = $derived(data.some((point) => point.costBasis != null));
  const series = $derived([
    {
      key: "marketValue",
      label: "市值",
      value: "marketValue",
      color: "var(--color-marketValue)",
    },
    ...(hasCost
      ? [
          {
            key: "costBasis",
            label: "本金",
            value: "costBasis",
            color: "var(--color-costBasis)",
          },
        ]
      : []),
  ]);

  function formatAxisDate(value: unknown) {
    const date = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("zh-TW", {
      month: "numeric",
      day: "numeric",
    }).format(date);
  }
</script>

{#snippet tooltip()}
  <ChartTooltip
    indicator="line"
    labelFormatter={(value) =>
      formatDate(value instanceof Date ? value.toISOString() : String(value))}
    valueFormatter={(value) => formatCurrency(Number(value))}
  />
{/snippet}

{#if data.length < 2}
  <p class="rounded-lg bg-ink/2 px-3 py-4 text-center text-caption text-subtle">
    集保每天記錄一次持股，累積兩天以上才畫得出走勢。
  </p>
{:else}
  <ChartContainer config={chartConfig} class="h-44 min-h-44 w-full min-w-0">
    <LineChart
      {data}
      x="date"
      {series}
      padding={{ top: 12, right: 12, bottom: 24, left: 44 }}
      yBaseline={null}
      axis={true}
      grid={false}
      {tooltip}
      props={{
        xAxis: { format: formatAxisDate, tickSpacing: 90, tickMarks: false },
        yAxis: {
          format: (value: number) => formatCompactTwd(value),
          tickMarks: false,
          grid: { opacity: 0.35 },
        },
        spline: { strokeWidth: 2 },
        highlight: { points: true, lines: true },
      }}
    />
  </ChartContainer>
  <div
    class="mt-1 flex flex-wrap gap-3 text-caption text-subtle"
    aria-hidden="true"
  >
    <span class="inline-flex items-center gap-1.5"
      ><span class="h-0.5 w-3 rounded" style="background:#3e6f7c"
      ></span>市值</span
    >
    {#if hasCost}
      <span class="inline-flex items-center gap-1.5"
        ><span class="h-0.5 w-3 rounded" style="background:#b5853f"
        ></span>本金</span
      >
    {/if}
  </div>
{/if}
