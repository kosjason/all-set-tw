<!--
  週回顧：本週／上週的消費，與過去 8 週「同一段天數」的中位數比較；列出多花最多的分類、
  最大 5 筆與 8 週內沒出現過的商家。進行中的週最近 3 天標示可能未到齊；有來源同步落後時
  不下「比平常少」的結論，改寫「目前至少」。
-->
<script lang="ts">
  import { createQuery, keepPreviousData } from "@tanstack/svelte-query";
  import { toStore } from "svelte/store";
  import {
    addDays,
    getCategoryDefinition,
    taipeiDay,
    weekStartOf,
  } from "@taiwan-fin-hub/core";
  import type { Navigate } from "@/app/types";
  import { weeklyReviewQuery } from "@/data/budget/queries";
  import type { ApiClient } from "@/shared/api/client";
  import { formatCurrency } from "@/shared/format/financial";
  import { moneyState } from "@/shared/state/money-visibility.svelte";

  let {
    api,
    navigate,
    dailyAllowance = null,
  }: {
    api: ApiClient;
    navigate: Navigate;
    /** 本月每天約可花；有值時顯示本週額度作為另一把尺。 */
    dailyAllowance?: number | null;
  } = $props();

  const today = taipeiDay(new Date());
  const thisWeek = weekStartOf(today);
  const lastWeek = addDays(thisWeek, -7);
  // 週一時本週幾乎沒有資料，預設看上週回顧。
  let selected = $state<"this" | "last">(today === thisWeek ? "last" : "this");
  const weekStart = $derived(selected === "this" ? thisWeek : lastWeek);
  const review = createQuery(
    toStore(() => ({
      ...weeklyReviewQuery(() => api, weekStart),
      placeholderData: keepPreviousData,
    })),
  );

  const data = $derived($review.data);
  const staleSources = $derived(
    (data?.sources ?? []).filter((source) => source.stale),
  );
  const maxDay = $derived(
    Math.max(1, ...(data?.byDay ?? []).map((day) => day.amount)),
  );
  const weeklyAllowance = $derived(
    dailyAllowance == null ? null : Math.round(dailyAllowance * 7),
  );

  function dayLabel(day: string) {
    return ["一", "二", "三", "四", "五", "六", "日"][
      (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7
    ]!;
  }
  function shortDate(day: string) {
    return `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;
  }
  function category(id: string) {
    const definition = getCategoryDefinition(id);
    return definition ? `${definition.emoji} ${definition.label}` : "未分類";
  }
  function isFuture(day: string) {
    return day > today;
  }
  function maybeIncomplete(day: string) {
    return Boolean(
      data?.possiblyIncompleteFrom &&
      day >= data.possiblyIncompleteFrom &&
      day <= today,
    );
  }

  const verdict = $derived.by(() => {
    if (!data || data.baseline.median == null || data.difference == null)
      return null;
    const span = data.complete ? "平常一週" : `平常同樣 ${data.elapsedDays} 天`;
    if (data.difference > 0)
      return {
        tone: "text-coral",
        text: `比${span}多 ${formatCurrency(data.difference)}`,
      };
    // 資料可能還沒到齊時，不說「花得比較少」。
    if (!data.complete || staleSources.length > 0)
      return {
        tone: "text-subtle",
        text: `目前至少 ${formatCurrency(data.total)}；${span}約 ${formatCurrency(data.baseline.median)}`,
      };
    return {
      tone: "text-moss",
      text: `比${span}少 ${formatCurrency(-data.difference)}`,
    };
  });
</script>

<section
  class="grid min-w-0 gap-4"
  aria-label="週回顧"
  data-testid="weekly-review"
>
  <div class="flex flex-wrap items-center justify-between gap-3">
    <div>
      <h2 class="font-semibold">週回顧</h2>
      {#if data}
        <p class="mt-0.5 text-caption text-subtle">
          {shortDate(data.weekStart)}（一）～{shortDate(data.weekEnd)}（日）·
          只算消費
        </p>
      {/if}
    </div>
    <div
      class="flex rounded-lg bg-ink/5 p-0.5 text-sm font-semibold"
      role="group"
      aria-label="選擇週"
    >
      {#each [["this", "本週"], ["last", "上週"]] as const as [key, label] (key)}
        <button
          type="button"
          class={`h-9 rounded-md px-3 ${selected === key ? "bg-steel text-white" : "text-subtle hover:text-ink"}`}
          aria-pressed={selected === key}
          onclick={() => (selected = key)}>{label}</button
        >
      {/each}
    </div>
  </div>

  {#if $review.isPending}
    <p class="text-sm text-subtle">正在整理這週的消費…</p>
  {:else if $review.isError || !data}
    <p class="text-sm text-coral">週回顧無法載入。</p>
  {:else}
    <div class="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div class="min-w-0">
        <p class="text-caption text-subtle">
          {data.complete ? "這週花了" : `這週到今天（${data.elapsedDays} 天）`}
        </p>
        <p
          class="mt-1 text-[clamp(1.5rem,4vw,2rem)] leading-tight font-semibold tracking-tight tabular-nums"
          data-testid="weekly-total"
        >
          {formatCurrency(data.total)}
        </p>
        {#if verdict}
          <p class={`mt-1 text-sm font-medium ${verdict.tone}`}>
            {verdict.text}
          </p>
        {:else}
          <p class="mt-1 text-sm text-subtle">還沒有足夠的過去資料可比較。</p>
        {/if}
        {#if weeklyAllowance != null && !data.complete}
          <p class="mt-1 text-caption text-subtle">
            照本月可花，一週約 {formatCurrency(weeklyAllowance)}
          </p>
        {/if}
        {#if data.pendingAmount > 0}
          <p class="mt-1 text-caption text-subtle">
            含待入帳 {formatCurrency(data.pendingAmount)}
          </p>
        {/if}

        <div
          class="mt-4 grid h-28 grid-cols-7 items-end gap-1.5"
          role="img"
          aria-label={data.byDay
            .map(
              (day) =>
                `週${dayLabel(day.day)} ${moneyState.hidden ? "" : formatCurrency(day.amount)}`,
            )
            .join("、")}
        >
          {#each data.byDay as day (day.day)}
            <div
              class="flex h-full min-w-0 flex-col items-center justify-end gap-1"
            >
              <div
                class={`w-full max-w-9 rounded-t ${isFuture(day.day) ? "bg-ink/5" : maybeIncomplete(day.day) ? "bg-steel/35 [background-image:repeating-linear-gradient(45deg,transparent_0_3px,rgba(255,255,255,.5)_3px_6px)]" : "bg-steel"}`}
                style={`height:${isFuture(day.day) ? 4 : Math.max((day.amount / maxDay) * 100, day.amount > 0 ? 4 : 2)}%`}
                title={`${shortDate(day.day)} ${formatCurrency(day.amount)}`}
              ></div>
              <span class="text-caption text-subtle">{dayLabel(day.day)}</span>
            </div>
          {/each}
        </div>
        {#if data.possiblyIncompleteFrom}
          <p class="mt-2 text-caption text-subtle">
            斜線：{shortDate(data.possiblyIncompleteFrom)} 起信用卡可能還沒入帳完
          </p>
        {/if}
        {#if staleSources.length > 0}
          <p class="mt-1 text-caption text-amber-900">
            {staleSources
              .map((source) =>
                source.lastSuccessAt
                  ? `${source.name}停在 ${shortDate(taipeiDay(new Date(source.lastSuccessAt)))}`
                  : `${source.name}尚未同步`,
              )
              .join("、")}，這週可能少算。
          </p>
        {/if}
      </div>

      <div class="grid min-w-0 content-start gap-4">
        {#if data.topCategoryIncreases.length > 0}
          <div>
            <h3 class="text-caption font-semibold text-subtle">
              比平常多花的分類
            </h3>
            <ul class="mt-2 grid gap-1.5 text-sm">
              {#each data.topCategoryIncreases as change (change.categoryId)}
                <li class="flex items-baseline justify-between gap-3">
                  <span class="truncate">{category(change.categoryId)}</span>
                  <span class="shrink-0 tabular-nums">
                    {formatCurrency(change.amount)}
                    <span class="text-caption text-coral"
                      >+{formatCurrency(change.delta)}</span
                    >
                  </span>
                </li>
              {/each}
            </ul>
          </div>
        {/if}

        <div>
          <h3 class="text-caption font-semibold text-subtle">最大的幾筆</h3>
          {#if data.largest.length === 0}
            <p class="mt-2 text-sm text-subtle">這週還沒有消費。</p>
          {:else}
            <ul class="mt-1 divide-y divide-border">
              {#each data.largest as largest (largest.id)}
                <li>
                  <button
                    type="button"
                    class="grid w-full grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 py-2 text-left hover:bg-ink/3"
                    onclick={() =>
                      navigate("transactions", {
                        query: new URLSearchParams({
                          month: largest.day.slice(0, 7),
                          activity: `${largest.source}:${largest.id}`,
                        }).toString(),
                      })}
                  >
                    <span class="min-w-0">
                      <span class="block truncate text-sm font-medium"
                        >{largest.displayName}</span
                      >
                      <span class="block text-caption text-subtle">
                        {shortDate(largest.day)}（{dayLabel(largest.day)}）· {category(
                          largest.categoryId,
                        )}{largest.pending ? " · 待入帳" : ""}
                      </span>
                    </span>
                    <span class="text-sm font-semibold tabular-nums"
                      >{formatCurrency(largest.amount)}</span
                    >
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </div>

        {#if data.newMerchants.length > 0}
          <div>
            <h3 class="text-caption font-semibold text-subtle">
              8 週內第一次出現的商家
            </h3>
            <ul class="mt-2 grid gap-1.5 text-sm">
              {#each data.newMerchants as merchant (merchant.merchantKey)}
                <li class="flex items-baseline justify-between gap-3">
                  <span class="truncate">{merchant.displayName}</span>
                  <span class="shrink-0 tabular-nums text-subtle">
                    {merchant.count} 筆 · {formatCurrency(merchant.amount)}
                  </span>
                </li>
              {/each}
            </ul>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</section>
