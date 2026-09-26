<!--
  待處理（全域收件匣，`GET /api/inbox`）：🔴 需要處理（blocking）與 🟡 待整理（tidy）
  兩組。每項顯示標題、說明、金額與筆數，按鈕依 target 導向對應頁面；待確認角色的
  項目可直接在列上選角色（角色 override API）。活動類項目只計本月與上月。
-->
<script lang="ts">
  import type { EconomicRole, InboxItem } from "@taiwan-fin-hub/core";
  import { ChevronRight, CircleCheckBig } from "@lucide/svelte";
  import {
    createMutation,
    createQuery,
    useQueryClient,
  } from "@tanstack/svelte-query";
  import type { Navigate } from "@/app/types";
  import {
    ECONOMIC_ROLE_CHOICES,
    ECONOMIC_ROLE_CHOICE_LABELS,
    activityRoleTarget,
    roleOverridePath,
  } from "@/data/activity/roles";
  import { inboxQuery } from "@/data/inbox/queries";
  import { messageFromError, type ApiClient } from "@/shared/api/client";
  import { queryKeys } from "@/shared/api/query-keys";
  import { formatCurrency } from "@/shared/format/financial";
  import Button from "@/shared/ui/Button.svelte";
  import EmptyState from "@/shared/ui/EmptyState.svelte";
  import RoleQuickSelect from "@/shared/ui/RoleQuickSelect.svelte";
  import {
    groupInboxItems,
    inboxActionLabel,
    inboxNavigation,
    inboxRoleActivity,
  } from "./model/inbox";

  let { api, navigate }: { api: ApiClient; navigate: Navigate } = $props();

  const qc = useQueryClient();
  const inbox = createQuery(inboxQuery(() => api));
  const groups = $derived(groupInboxItems($inbox.data));
  const unavailableLabels = { sync: "同步", cards: "信用卡", activity: "交易" };
  const roleOptions = ECONOMIC_ROLE_CHOICES.map((role) => ({
    value: role,
    label: ECONOMIC_ROLE_CHOICE_LABELS[role],
  }));

  const roleMutation = createMutation({
    mutationFn: (payload: { item: InboxItem; role: EconomicRole }) => {
      const activity = inboxRoleActivity(payload.item);
      const target = activity && activityRoleTarget(activity);
      if (!target) throw new Error("此項目不支援調整角色。");
      return api.put(roleOverridePath(target), {
        economicRole: payload.role,
      });
    },
    // 收件匣、月收支與交易都以 "bank" 開頭，一次失效。
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.bank }),
  });

  function open(item: InboxItem) {
    const target = inboxNavigation(item);
    navigate(target.view, target.options);
  }
</script>

{#if $inbox.isPending}
  <EmptyState title="載入待處理中" body="正在整理需要你處理的事項。" />
{:else if $inbox.isError}
  <section class="py-12" role="alert">
    <h2 class="text-base font-semibold">待處理項目暫時無法載入</h2>
    <p class="mt-2 text-caption text-subtle">
      {messageFromError($inbox.error)}
    </p>
    <Button class="mt-4" variant="outline" onclick={() => $inbox.refetch()}
      >重試</Button
    >
  </section>
{:else}
  <div class="grid min-w-0 gap-6 pt-3 md:pt-0">
    {#if $inbox.data?.unavailable.length}
      <p
        role="status"
        class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-caption text-amber-900"
      >
        部分項目暫時無法檢查（{$inbox.data.unavailable
          .map((source) => unavailableLabels[source])
          .join("、")}），清單可能不完整。
      </p>
    {/if}
    {#if $roleMutation.isError}
      <p role="alert" class="text-sm font-medium text-coral">
        無法更新角色，請稍後再試。
      </p>
    {/if}
    {#if groups.length === 0}
      <section class="flex items-center gap-3 py-12" aria-live="polite">
        <CircleCheckBig class="size-6 shrink-0 text-moss" />
        <div>
          <h2 class="text-base font-semibold">目前沒有待處理的事項</h2>
          <p class="mt-1 text-caption text-subtle">
            同步正常、卡費都已處理，本月與上月的交易也都確認過了。
          </p>
        </div>
      </section>
    {/if}
    {#each groups as group (group.severity)}
      <section
        class="grid min-w-0 gap-2"
        aria-labelledby={`inbox-${group.severity}`}
      >
        <div>
          <h2
            id={`inbox-${group.severity}`}
            class="flex items-center gap-2 text-base font-semibold"
          >
            <span
              class={`size-2.5 rounded-full ${group.severity === "blocking" ? "bg-coral" : "bg-amber-400"}`}
              aria-hidden="true"
            ></span>
            {group.title}
            <span class="text-caption font-normal text-subtle"
              >{group.items.length} 件</span
            >
          </h2>
          <p class="mt-0.5 text-caption text-subtle">{group.description}</p>
        </div>
        <ul
          class="divide-y divide-ink/8 overflow-hidden rounded-xl border border-ink/10 bg-card"
        >
          {#each group.items as item (item.id)}
            {@const roleActivity = inboxRoleActivity(item)}
            <li
              class="flex min-w-0 flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center"
              data-testid="inbox-item"
            >
              <div class="min-w-0 flex-1">
                <p class="text-sm font-semibold">{item.title}</p>
                <p class="mt-0.5 text-caption text-subtle">{item.detail}</p>
                {#if item.amount != null || item.count != null}
                  <p class="mt-1 text-caption tabular-nums">
                    {#if item.amount != null}{formatCurrency(
                        item.amount,
                        item.currency ?? "TWD",
                      )}{/if}{#if item.amount != null && item.count != null}
                      ・{/if}{#if item.count != null}{item.count} 筆{/if}
                  </p>
                {/if}
              </div>
              <div class="flex shrink-0 flex-wrap items-center gap-2">
                {#if roleActivity}
                  <RoleQuickSelect
                    label={`確認「${item.title.replace(/^確認活動：/, "")}」是哪一種活動`}
                    options={roleOptions}
                    disabled={$roleMutation.isPending}
                    onSelect={(role: EconomicRole) =>
                      $roleMutation.mutate({ item, role })}
                  />
                {/if}
                <Button
                  variant={group.severity === "blocking"
                    ? "default"
                    : "outline"}
                  class="h-10 rounded-full"
                  onclick={() => open(item)}
                  >{inboxActionLabel(item)}<ChevronRight
                    class="size-4"
                  /></Button
                >
              </div>
            </li>
          {/each}
        </ul>
      </section>
    {/each}
  </div>
{/if}
