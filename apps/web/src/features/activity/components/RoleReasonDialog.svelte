<!--
  選擇會影響金額的角色（轉到自己帳戶、不計入、收入）時的確認：附一個選填的
  「原因」輸入框，內容會和角色 override 一起存成備註（例如「跟朋友換匯」「未實際扣款」）。
  - title：活動名稱；roleLabel：選擇的角色名稱。
  - note：目前的備註，預先填入。
  - askCounterparty：代墊／收回代墊時必填「對象」；counterparty 預先填入，
    counterpartySuggestions 為已用過的對象名稱。
  - submitting／failed：送出中／失敗。
  - onCancel：取消；onSubmit：確認，reason 為輸入框內容（已去除前後空白），
    counterparty 為對象（askCounterparty 時才有）。
-->
<script module lang="ts">
  export interface RoleReasonDialogProps {
    title: string;
    roleLabel: string;
    note?: string | null;
    askCounterparty?: boolean;
    counterparty?: string | null;
    counterpartySuggestions?: readonly string[];
    submitting?: boolean;
    failed?: boolean;
    onCancel: () => void;
    onSubmit: (reason: string, counterparty?: string) => void;
  }
</script>

<script lang="ts">
  import { untrack } from "svelte";
  import {
    ACTIVITY_NOTE_MAX_LENGTH,
    ADVANCE_COUNTERPARTY_MAX_LENGTH,
    normalizeAdvanceCounterparty,
  } from "@taiwan-fin-hub/shared";
  import Button from "@/shared/ui/Button.svelte";

  let {
    title,
    roleLabel,
    note,
    askCounterparty = false,
    counterparty,
    counterpartySuggestions = [],
    submitting = false,
    failed = false,
    onCancel,
    onSubmit,
  }: RoleReasonDialogProps = $props();

  let reason = $state(untrack(() => note ?? ""));
  let who = $state(untrack(() => counterparty ?? ""));
  let field = $state<HTMLTextAreaElement>();
  let whoField = $state<HTMLInputElement>();
  $effect(() => (askCounterparty ? whoField : field)?.focus());
  const normalizedWho = $derived(normalizeAdvanceCounterparty(who));

  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (askCounterparty) {
      if (!normalizedWho) return;
      onSubmit(reason.trim(), normalizedWho);
      return;
    }
    onSubmit(reason.trim());
  }
</script>

<div
  aria-modal="true"
  aria-labelledby="role-reason-title"
  class="fixed inset-0 z-[70] flex items-end bg-ink/45 md:items-center md:justify-center md:p-6"
  role="dialog"
>
  <form
    class="w-full rounded-t-2xl bg-white p-5 shadow-2xl md:max-w-md md:rounded-2xl md:p-6"
    onsubmit={submit}
  >
    <h2 id="role-reason-title" class="text-lg font-semibold">
      這筆是「{roleLabel}」
    </h2>
    <p class="mt-1 truncate text-sm text-subtle">{title}</p>
    {#if askCounterparty}
      <label
        class="mt-4 block text-sm font-semibold"
        for="role-counterparty-input">對象（必填）</label
      >
      <input
        id="role-counterparty-input"
        bind:this={whoField}
        bind:value={who}
        list="role-counterparty-suggestions"
        maxlength={ADVANCE_COUNTERPARTY_MAX_LENGTH}
        autocomplete="off"
        placeholder="例如：Irene"
        class="mt-2 h-11 w-full rounded-xl border border-input bg-background px-3 text-sm placeholder:text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-steel"
      />
      <datalist id="role-counterparty-suggestions">
        {#each counterpartySuggestions as name (name)}<option value={name}
          ></option>{/each}
      </datalist>
      <p class="mt-1 text-caption text-subtle">
        同一個人的代墊與還款會合併計算還欠多少；不算進收入和消費。
      </p>
    {/if}
    <label class="mt-4 block text-sm font-semibold" for="role-reason-input"
      >原因（選填，會存成備註）</label
    >
    <textarea
      id="role-reason-input"
      bind:this={field}
      bind:value={reason}
      maxlength={ACTIVITY_NOTE_MAX_LENGTH}
      rows="2"
      placeholder="例如：跟朋友換匯、代墊、未實際扣款"
      class="mt-2 w-full resize-y rounded-xl border border-input bg-background px-3 py-2 text-sm leading-6 placeholder:text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-steel"
    ></textarea>
    {#if failed}<p role="alert" class="mt-2 text-sm text-coral">
        無法更新角色，請稍後再試。
      </p>{/if}
    <div class="mt-4 flex justify-end gap-2">
      <Button
        type="button"
        variant="outline"
        class="h-11"
        disabled={submitting}
        onclick={onCancel}>取消</Button
      >
      <Button
        type="submit"
        class="h-11"
        disabled={submitting || (askCounterparty && !normalizedWho)}
        >{submitting ? "更新中…" : "確定"}</Button
      >
    </div>
  </form>
</div>
