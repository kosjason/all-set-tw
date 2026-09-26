<!--
  選擇會影響金額的角色（轉到自己帳戶、不計入、收入）時的確認：附一個選填的
  「原因」輸入框，內容會和角色 override 一起存成備註（例如「跟朋友換匯」「未實際扣款」）。
  - title：活動名稱；roleLabel：選擇的角色名稱。
  - note：目前的備註，預先填入。
  - submitting／failed：送出中／失敗。
  - onCancel：取消；onSubmit：確認，reason 為輸入框內容（已去除前後空白）。
-->
<script module lang="ts">
  export interface RoleReasonDialogProps {
    title: string;
    roleLabel: string;
    note?: string | null;
    submitting?: boolean;
    failed?: boolean;
    onCancel: () => void;
    onSubmit: (reason: string) => void;
  }
</script>

<script lang="ts">
  import { untrack } from "svelte";
  import { ACTIVITY_NOTE_MAX_LENGTH } from "@taiwan-fin-hub/core";
  import Button from "@/shared/ui/Button.svelte";

  let {
    title,
    roleLabel,
    note,
    submitting = false,
    failed = false,
    onCancel,
    onSubmit,
  }: RoleReasonDialogProps = $props();

  let reason = $state(untrack(() => note ?? ""));
  let field = $state<HTMLTextAreaElement>();
  $effect(() => field?.focus());

  function submit(event: SubmitEvent) {
    event.preventDefault();
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
      <Button type="submit" class="h-11" disabled={submitting}
        >{submitting ? "更新中…" : "確定"}</Button
      >
    </div>
  </form>
</div>
