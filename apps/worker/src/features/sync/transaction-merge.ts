/** Internal SQL supplied by the bank-specific matchers, never user input.
 * Bank-derived values go through `bindings` (bound to every statement, which
 * each repeat the same `candidatesSql`). Execute the returned statements
 * together in the promotion batch.
 */
export function mergeLegacyTransactionStatements(
  db: D1Database,
  candidatesSql: string,
  bindings: readonly unknown[] = [],
): D1PreparedStatement[] {
  // Re-evaluate the same mapping inside the transaction. Copying equal preferences
  // and moving invoice references cannot turn an excluded conflict into a match.
  // Parent rows remain intact until the final statement, keeping cardinality stable.
  const mapping = `WITH candidates AS (${candidatesSql}),
    counted AS (
      SELECT old_id, new_id,
        COUNT(*) OVER (PARTITION BY old_id) AS old_count,
        COUNT(*) OVER (PARTITION BY new_id) AS new_count
      FROM candidates
    ), merges AS (
      SELECT c.old_id, c.new_id FROM counted c
      LEFT JOIN bank_transaction_preferences old_pref ON old_pref.transaction_id = c.old_id
      LEFT JOIN bank_transaction_preferences new_pref ON new_pref.transaction_id = c.new_id
      LEFT JOIN classification_overrides old_category
        ON old_category.target_type = 'bank_transaction' AND old_category.target_id = c.old_id
      LEFT JOIN classification_overrides new_category
        ON new_category.target_type = 'bank_transaction' AND new_category.target_id = c.new_id
      LEFT JOIN invoice_transaction_preferences old_invoice
        ON old_invoice.transaction_id = c.old_id AND old_invoice.decision = 'linked'
      LEFT JOIN invoice_transaction_preferences new_invoice
        ON new_invoice.transaction_id = c.new_id AND new_invoice.decision = 'linked'
      LEFT JOIN activity_role_overrides old_role
        ON old_role.target_kind = 'bank_transaction' AND old_role.target_id = c.old_id
      LEFT JOIN activity_role_overrides new_role
        ON new_role.target_kind = 'bank_transaction' AND new_role.target_id = c.new_id
      WHERE c.old_count = 1 AND c.new_count = 1 AND c.old_id <> c.new_id
        AND (old_pref.transaction_id IS NULL OR new_pref.transaction_id IS NULL
          OR old_pref.excluded_from_calculation = new_pref.excluded_from_calculation)
        AND (old_category.id IS NULL OR new_category.id IS NULL
          OR old_category.category_id = new_category.category_id)
        AND (old_invoice.invoice_id IS NULL OR new_invoice.invoice_id IS NULL)
        AND (old_role.target_id IS NULL OR new_role.target_id IS NULL
          OR old_role.economic_role = new_role.economic_role)
    )`;
  return [
    `INSERT INTO bank_transaction_preferences
      (transaction_id, excluded_from_calculation, created_at, updated_at)
      SELECT m.new_id, p.excluded_from_calculation, p.created_at, p.updated_at
      FROM merges m JOIN bank_transaction_preferences p ON p.transaction_id = m.old_id
      WHERE true ON CONFLICT(transaction_id) DO NOTHING`,
    `INSERT INTO classification_overrides
      (id, target_type, target_id, category_id, created_at, updated_at)
      SELECT 'override:bank_transaction:' || m.new_id, 'bank_transaction', m.new_id,
        p.category_id, p.created_at, p.updated_at
      FROM merges m JOIN classification_overrides p
        ON p.target_type = 'bank_transaction' AND p.target_id = m.old_id
      WHERE true ON CONFLICT(target_type, target_id) DO NOTHING`,
    `UPDATE invoice_transaction_preferences
      SET transaction_id = m.new_id FROM merges m WHERE transaction_id = m.old_id`,
    // A role override that marked one side as a duplicate of the other becomes
    // a plain override once both rows are the same transaction.
    `INSERT INTO activity_role_overrides
      (target_kind, target_id, economic_role, review_status, duplicate_of_kind,
       duplicate_of_id, created_at, updated_at)
      SELECT 'bank_transaction', m.new_id, p.economic_role, p.review_status,
        CASE WHEN p.duplicate_of_kind = 'bank_transaction' AND p.duplicate_of_id = m.new_id
          THEN NULL ELSE p.duplicate_of_kind END,
        CASE WHEN p.duplicate_of_kind = 'bank_transaction' AND p.duplicate_of_id = m.new_id
          THEN NULL ELSE p.duplicate_of_id END,
        p.created_at, p.updated_at
      FROM merges m JOIN activity_role_overrides p
        ON p.target_kind = 'bank_transaction' AND p.target_id = m.old_id
      WHERE true ON CONFLICT(target_kind, target_id) DO NOTHING`,
    // 使用者寫在舊交易（例如未入帳）上的備註移到新交易；新交易已有備註時，
    // 兩段合併保留，避免任何一邊的說明遺失。
    `INSERT INTO activity_notes (target_kind, target_id, note, created_at, updated_at)
      SELECT 'bank_transaction', m.new_id, p.note, p.created_at, p.updated_at
      FROM merges m JOIN activity_notes p
        ON p.target_kind = 'bank_transaction' AND p.target_id = m.old_id
      WHERE true ON CONFLICT(target_kind, target_id) DO UPDATE SET
        note = substr(activity_notes.note || char(10) || excluded.note, 1, 1000),
        updated_at = excluded.updated_at
      WHERE activity_notes.note <> excluded.note`,
    `UPDATE activity_role_overrides SET
      duplicate_of_kind = CASE
        WHEN target_kind = 'bank_transaction'
          AND target_id = (SELECT new_id FROM merges WHERE old_id = duplicate_of_id)
        THEN NULL ELSE duplicate_of_kind END,
      duplicate_of_id = CASE
        WHEN target_kind = 'bank_transaction'
          AND target_id = (SELECT new_id FROM merges WHERE old_id = duplicate_of_id)
        THEN NULL ELSE (SELECT new_id FROM merges WHERE old_id = duplicate_of_id) END
      WHERE duplicate_of_kind = 'bank_transaction'
        AND duplicate_of_id IN (SELECT old_id FROM merges)`,
    `UPDATE bank_transactions SET
      transfer_peer_id = COALESCE((SELECT new_id FROM merges WHERE old_id = transfer_peer_id), transfer_peer_id),
      matched_transaction_id = COALESCE((SELECT new_id FROM merges WHERE old_id = matched_transaction_id), matched_transaction_id)
      WHERE transfer_peer_id IN (SELECT old_id FROM merges)
        OR matched_transaction_id IN (SELECT old_id FROM merges)`,
    `DELETE FROM bank_transaction_preferences WHERE transaction_id IN (SELECT old_id FROM merges)`,
    `DELETE FROM classification_overrides
      WHERE target_type = 'bank_transaction' AND target_id IN (SELECT old_id FROM merges)`,
    `DELETE FROM activity_role_overrides
      WHERE target_kind = 'bank_transaction' AND target_id IN (SELECT old_id FROM merges)`,
    `DELETE FROM activity_notes
      WHERE target_kind = 'bank_transaction' AND target_id IN (SELECT old_id FROM merges)`,
    `DELETE FROM bank_transactions WHERE id IN (SELECT old_id FROM merges)`,
  ].map((statement) => {
    const prepared = db.prepare(`${mapping} ${statement}`);
    return bindings.length > 0 ? prepared.bind(...bindings) : prepared;
  });
}
