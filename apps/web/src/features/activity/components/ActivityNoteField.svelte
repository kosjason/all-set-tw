<!--
  明細抽屜的「備註」：多行輸入，停止輸入 800ms 或失焦時自動儲存並顯示「已儲存」；
  清空即刪除。已配對的交易與發票共用同一份備註（寫到哪一筆由頁面依 noteTarget 決定）。
  輸入期間不會被重新載入的資料覆寫；切換到另一筆活動時請以 {#key} 重建元件。
  - note：目前的備註（沒有為 null）。
  - onSave：儲存備註；空字串代表刪除。回傳的 Promise 失敗時顯示錯誤。
  - shared：備註來自配對的另一筆（交易↔發票），顯示共用說明。
  - label：textarea 的無障礙名稱補充（活動名稱）。
-->
<script module lang="ts">
  export interface ActivityNoteFieldProps {
    note: string | null | undefined;
    onSave: (note: string) => Promise<unknown>;
    shared?: boolean;
    label: string;
  }

  /** 停止輸入後多久自動儲存。 */
  export const NOTE_AUTOSAVE_DELAY_MS = 800;
</script>

<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import { ACTIVITY_NOTE_MAX_LENGTH } from "@taiwan-fin-hub/core";

  let {
    note,
    onSave,
    shared = false,
    label,
  }: ActivityNoteFieldProps = $props();

  // 只在建立時讀取 note：之後由使用者輸入主導，重新載入的資料不覆寫草稿。
  const initial = untrack(() => note ?? "");
  let draft = $state(initial);
  let saved = initial.trim();
  let status = $state<"idle" | "saving" | "saved" | "error">("idle");
  let timer: ReturnType<typeof setTimeout> | undefined;
  let saving = false;
  let queued = false;

  function clearTimer() {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  }

  async function save() {
    clearTimer();
    const value = draft.trim();
    if (value === saved) {
      if (status === "error") status = "idle";
      return;
    }
    if (saving) {
      queued = true;
      return;
    }
    saving = true;
    status = "saving";
    try {
      await onSave(value);
      saved = value;
      status = "saved";
    } catch {
      status = "error";
    } finally {
      saving = false;
    }
    if (queued) {
      queued = false;
      void save();
    }
  }

  function input() {
    clearTimer();
    if (status === "saved") status = "idle";
    timer = setTimeout(() => void save(), NOTE_AUTOSAVE_DELAY_MS);
  }

  onDestroy(() => {
    // 關閉抽屜前還沒送出的修改直接儲存。
    if (timer !== undefined) void save();
    clearTimer();
  });
</script>

<div class="grid gap-2">
  <div class="flex items-baseline justify-between gap-3">
    <label for="activity-note" class="text-base font-semibold">備註</label>
    <span
      class={`text-caption ${status === "error" ? "text-coral" : "text-subtle"}`}
      role="status"
      aria-live="polite"
      data-testid="activity-note-status"
      >{status === "saving"
        ? "儲存中…"
        : status === "saved"
          ? "已儲存"
          : status === "error"
            ? "無法儲存，請稍後再試"
            : ""}</span
    >
  </div>
  <textarea
    id="activity-note"
    aria-label={`${label} 的備註`}
    aria-describedby="activity-note-hint"
    class="min-h-24 w-full resize-y rounded-xl border border-input bg-background px-3 py-2 text-sm leading-6 placeholder:text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-steel"
    maxlength={ACTIVITY_NOTE_MAX_LENGTH}
    placeholder="寫下原因，例如：跟朋友換匯、代墊、未實際扣款…"
    bind:value={draft}
    oninput={input}
    onblur={() => void save()}></textarea>
  <p
    id="activity-note-hint"
    class="flex justify-between gap-3 text-caption text-subtle"
  >
    <span
      >{shared
        ? "與配對的交易／發票共用這則備註。"
        : "自動儲存；清空即刪除。備註可搜尋，也會提供給 LLM 分析。"}</span
    >
    <span class="shrink-0 tabular-nums"
      >{draft.length}/{ACTIVITY_NOTE_MAX_LENGTH}</span
    >
  </p>
</div>
