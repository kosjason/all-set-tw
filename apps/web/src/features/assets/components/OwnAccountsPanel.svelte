<script lang="ts">
  import {
    createMutation,
    createQuery,
    useQueryClient,
  } from "@tanstack/svelte-query";
  import { Pencil, Plus, Trash2 } from "@lucide/svelte";
  import {
    ownAccountDisplayName,
    taiwanBankName,
    type OwnAccount,
    type OwnAccountInput,
  } from "@taiwan-fin-hub/core";
  import Card from "@/shared/ui/Card.svelte";
  import CardHeader from "@/shared/ui/CardHeader.svelte";
  import CardContent from "@/shared/ui/CardContent.svelte";
  import Button from "@/shared/ui/Button.svelte";
  import Badge from "@/shared/ui/Badge.svelte";
  import Input from "@/shared/ui/Input.svelte";
  import Select from "@/shared/ui/Select.svelte";
  import type { ApiClient } from "@/shared/api/client";
  import { ApiRequestError, messageFromError } from "@/shared/api/client";
  import { queryKeys } from "@/shared/api/query-keys";
  import { ownAccountsQuery } from "@/data/own-accounts/queries";
  import {
    OTHER_BANK_OPTION,
    OWN_ACCOUNT_LABEL_MAX_LENGTH,
    emptyOwnAccountForm,
    ownAccountBankOptions,
    ownAccountFormFrom,
    ownAccountKindOptions,
    validateOwnAccountForm,
    type OwnAccountFormErrors,
    type OwnAccountFormState,
  } from "../model/own-account-form";

  let { api, demoMode = false }: { api: ApiClient; demoMode?: boolean } =
    $props();

  const accounts = createQuery(ownAccountsQuery(() => api));
  const qc = useQueryClient();

  let form = $state<OwnAccountFormState>(emptyOwnAccountForm());
  let errors = $state<OwnAccountFormErrors>({});
  let editingId = $state<string | undefined>();

  function invalidate() {
    qc.invalidateQueries({ queryKey: queryKeys.ownAccounts });
    // 活動與收支以讀取時比對套用，需重新載入交易。
    qc.invalidateQueries({ queryKey: queryKeys.bank });
  }

  function resetForm() {
    form = emptyOwnAccountForm();
    errors = {};
    editingId = undefined;
  }

  const save = createMutation({
    mutationFn: (payload: { id?: string; input: OwnAccountInput }) =>
      payload.id
        ? api.put<OwnAccount>(`/api/own-accounts/${payload.id}`, payload.input)
        : api.post<OwnAccount>("/api/own-accounts", payload.input),
    onSuccess: () => {
      invalidate();
      resetForm();
    },
  });
  const remove = createMutation({
    mutationFn: (id: string) => api.delete(`/api/own-accounts/${id}`),
    onSuccess: (_result, id) => {
      invalidate();
      if (editingId === id) resetForm();
    },
  });

  function submit(event: SubmitEvent) {
    event.preventDefault();
    const result = validateOwnAccountForm(form);
    if (!result.valid) {
      errors = result.errors;
      return;
    }
    errors = {};
    $save.mutate({ id: editingId, input: result.input });
  }

  function startEditing(account: OwnAccount) {
    editingId = account.id;
    form = ownAccountFormFrom(account);
    errors = {};
    $save.reset();
  }

  function confirmRemove(account: OwnAccount) {
    if (
      window.confirm(
        `要移除「${ownAccountDisplayName(account)}」嗎？相關交易會恢復原本的分類與收支計算。`,
      )
    )
      $remove.mutate(account.id);
  }

  function errorMessage(error: unknown) {
    if (error instanceof ApiRequestError) {
      if (error.code === "OWN_ACCOUNT_EXISTS")
        return "這個銀行與帳號末碼已經登記過。";
      if (error.code === "OWN_ACCOUNT_NOT_FOUND")
        return "找不到這個帳戶，可能已被移除。";
      if (error.code === "INVALID_REQUEST")
        return "資料格式不正確，請檢查欄位。";
    }
    return messageFromError(error);
  }

  function kindLabel(kind: OwnAccount["kind"]) {
    return (
      ownAccountKindOptions.find((option) => option.value === kind)?.label ??
      kind
    );
  }
</script>

<Card class="w-full min-w-0">
  <CardHeader class="gap-1">
    <h2 class="text-lg font-semibold">我的其他帳戶</h2>
    <p class="text-sm text-muted-foreground">
      登記無法同步的自有帳戶或卡片。系統會用交易中的對方銀行與帳號末碼比對，
      新增或移除後，所有月份的活動都會重新判定。
    </p>
  </CardHeader>
  <CardContent>
    <form
      class="mb-5 grid gap-4 rounded-lg border border-border bg-muted/40 p-4"
      aria-label={editingId ? "編輯我的其他帳戶" : "新增我的其他帳戶"}
      onsubmit={submit}
    >
      <fieldset class="grid gap-2">
        <legend class="mb-1 text-sm font-medium">帳戶種類</legend>
        <div class="grid gap-2 sm:grid-cols-2">
          {#each ownAccountKindOptions as option (option.value)}
            <label
              class={`flex cursor-pointer gap-3 rounded-lg border bg-background p-3 text-sm transition ${form.kind === option.value ? "border-steel ring-1 ring-steel" : "border-border hover:border-ink/20"}`}
            >
              <input
                class="mt-1 accent-steel"
                type="radio"
                name="own-account-kind"
                value={option.value}
                bind:group={form.kind}
              />
              <span>
                <span class="block font-semibold">{option.label}</span>
                <span class="mt-0.5 block text-muted-foreground"
                  >{option.description}</span
                >
              </span>
            </label>
          {/each}
        </div>
      </fieldset>

      <div
        class="grid gap-3 md:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)_minmax(0,1fr)]"
      >
        <label class="grid gap-1.5 text-sm font-medium">
          銀行
          <Select
            bind:value={form.bankOption}
            aria-invalid={errors.bankCode ? "true" : undefined}
          >
            <option value="" disabled>選擇銀行</option>
            {#each ownAccountBankOptions as option (option.value)}
              <option value={option.value}>{option.label}</option>
            {/each}
            <option value={OTHER_BANK_OPTION}>其他（輸入代碼）</option>
          </Select>
          {#if form.bankOption === OTHER_BANK_OPTION}
            <Input
              aria-label="銀行代碼"
              inputmode="numeric"
              maxlength="3"
              placeholder="3 位數代碼"
              bind:value={form.customBankCode}
            />
          {/if}
          {#if errors.bankCode}<span
              class="text-sm font-normal text-destructive"
              role="alert">{errors.bankCode}</span
            >{/if}
        </label>
        <label class="grid gap-1.5 text-sm font-medium">
          帳號末 4–5 碼
          <Input
            inputmode="numeric"
            autocomplete="off"
            maxlength="8"
            placeholder="例如 66666"
            aria-invalid={errors.accountSuffix ? "true" : undefined}
            bind:value={form.accountSuffix}
          />
          {#if errors.accountSuffix}<span
              class="text-sm font-normal text-destructive"
              role="alert">{errors.accountSuffix}</span
            >{:else}<span class="text-sm font-normal text-muted-foreground"
              >只保存末碼，不需要完整帳號。</span
            >{/if}
        </label>
        <label class="grid gap-1.5 text-sm font-medium">
          名稱（選填）
          <Input
            maxlength={OWN_ACCOUNT_LABEL_MAX_LENGTH}
            placeholder={form.kind === "unsynced_card"
              ? "例如：星展信用卡"
              : "例如：台新活存"}
            aria-invalid={errors.label ? "true" : undefined}
            bind:value={form.label}
          />
          {#if errors.label}<span
              class="text-sm font-normal text-destructive"
              role="alert">{errors.label}</span
            >{/if}
        </label>
      </div>

      <div class="flex flex-wrap items-center justify-end gap-2">
        {#if $save.isError}
          <p class="mr-auto text-sm text-destructive" role="alert">
            {errorMessage($save.error)}
          </p>
        {/if}
        {#if editingId}
          <Button variant="ghost" disabled={$save.isPending} onclick={resetForm}
            >取消</Button
          >
        {/if}
        <Button
          type="submit"
          variant="primary"
          disabled={demoMode || $save.isPending}
        >
          {#if !editingId}<Plus class="size-4" />{/if}
          {$save.isPending ? "儲存中…" : editingId ? "儲存變更" : "新增帳戶"}
        </Button>
      </div>
    </form>

    {#if $accounts.isError}
      <p class="py-3 text-sm text-destructive" role="alert">
        無法載入我的其他帳戶，請稍後再試。
      </p>
    {:else if $accounts.isPending}
      <p class="py-3 text-sm text-muted-foreground">載入中…</p>
    {:else if ($accounts.data?.length ?? 0) === 0}
      <p class="py-3 text-sm text-muted-foreground">
        尚未登記其他帳戶。轉到未同步帳戶的款項目前會計入支出。
      </p>
    {:else}
      <ul class="divide-y divide-border" aria-label="已登記的其他帳戶">
        {#each $accounts.data ?? [] as account (account.id)}
          <li class="flex min-w-0 flex-wrap items-center gap-3 py-3 text-sm">
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-1.5">
                <p class="font-semibold">{ownAccountDisplayName(account)}</p>
                <Badge
                  variant="secondary"
                  class={account.kind === "unsynced_card"
                    ? "bg-amber-50 text-amber-800"
                    : ""}>{kindLabel(account.kind)}</Badge
                >
              </div>
              <p class="mt-1 text-muted-foreground">
                {account.bankCode}
                {taiwanBankName(account.bankCode) ?? ""} · 末碼 {account.accountSuffix}
                · {account.kind === "unsynced_card"
                  ? "轉入計為這張卡的支出"
                  : "互轉不計入收支"}
              </p>
            </div>
            <div class="flex shrink-0 items-center gap-1">
              <Button
                size="icon"
                variant="ghost"
                aria-label={`編輯${ownAccountDisplayName(account)}`}
                title="編輯"
                disabled={demoMode}
                onclick={() => startEditing(account)}
              >
                <Pencil />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`移除${ownAccountDisplayName(account)}`}
                title="移除"
                disabled={demoMode || $remove.isPending}
                onclick={() => confirmRemove(account)}
              >
                <Trash2 />
              </Button>
            </div>
          </li>
        {/each}
      </ul>
      {#if $remove.isError}
        <p class="mt-2 text-sm text-destructive" role="alert">
          {errorMessage($remove.error)}
        </p>
      {/if}
    {/if}
  </CardContent>
</Card>
