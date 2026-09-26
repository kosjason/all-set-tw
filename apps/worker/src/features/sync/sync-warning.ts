/**
 * 合併同步成功但部分資料未取得的警告為單一訊息，寫入同步工作的 last_error；
 * 沒有警告時回傳 null，讓成功同步清除先前的訊息。
 */
export function syncOutcomeWarning(outcome: { warnings?: string[] }) {
  const warnings = (outcome.warnings ?? [])
    .map((warning) => warning.trim())
    .filter(Boolean);
  return warnings.length > 0 ? warnings.join("；") : null;
}
