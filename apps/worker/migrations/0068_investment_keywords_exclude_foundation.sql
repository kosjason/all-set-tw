-- 投資關鍵字規則的「基金」會比對到「家扶基金會」這類慈善機構，把捐款誤判為投資。
-- 改為「基金(?!會)」；只修改仍含原本寫法的系統規則，不動使用者自訂規則。
UPDATE classification_rules
SET pattern = replace(pattern, '基金|', '基金(?!會)|'),
    updated_at = '2026-09-26T00:00:00.000Z'
WHERE id = 'system:bank:investment-keywords'
  AND instr(pattern, '基金|') > 0
  AND instr(pattern, '基金(?!會)') = 0;
