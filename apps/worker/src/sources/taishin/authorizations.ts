import type { SyncWriteRecord } from "../../features/sync/persistence";
import { carryRoleOverrideAndNoteStatements } from "../../features/sync/transaction-merge";
import { taishinMerchantNamesMatch, normalizeMerchantName } from "./protocol";
import { taishinMaskedIdentityPairs } from "./repository";

type CardRow = {
  id: string;
  account_id: string;
  source_id: string;
  status: string;
  authorized_at: string | null;
  amount: number;
  currency: string;
  description: string | null;
  raw_payload: string;
  matched_transaction_id: string | null;
};

function cardDetails(row: CardRow) {
  try {
    const raw = JSON.parse(row.raw_payload || "{}") as Record<string, unknown>;
    const last4 =
      typeof raw.cardLast4 === "string" && /^\d{4}$/.test(raw.cardLast4)
        ? raw.cardLast4
        : undefined;
    return {
      last4,
      identityDescription:
        typeof raw.identityDescription === "string"
          ? raw.identityDescription
          : undefined,
    };
  } catch {
    return { last4: undefined, identityDescription: undefined };
  }
}

/** 兩筆消費日相差的天數；任一邊沒有日期時回傳 null。 */
function dayDistance(left: CardRow, right: CardRow) {
  if (!left.authorized_at || !right.authorized_at) return null;
  const a = Date.parse(`${left.authorized_at.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${right.authorized_at.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.abs(a - b) / 86_400_000;
}

/** 同一張卡、同幣別同額同方向，消費日相差不超過 `maxDays` 天。 */
function sameCardAmountWithin(left: CardRow, right: CardRow, maxDays: number) {
  const a = cardDetails(left);
  const b = cardDetails(right);
  const days = dayDistance(left, right);
  return Boolean(
    a.last4 &&
    a.last4 === b.last4 &&
    days !== null &&
    days <= maxDays &&
    left.account_id === right.account_id &&
    left.currency === right.currency &&
    left.amount === right.amount,
  );
}

/** 同一張卡、同一消費日、同幣別同額同方向。 */
function sameCardDayAmount(left: CardRow, right: CardRow) {
  return sameCardAmountWithin(left, right, 0);
}

function merchantNamesMatch(left: CardRow, right: CardRow) {
  const a = cardDetails(left);
  const b = cardDetails(right);
  return [left.description, a.identityDescription].some((name) =>
    [right.description, b.identityDescription].some((other) =>
      taishinMerchantNamesMatch(name ?? undefined, other ?? undefined),
    ),
  );
}

/** 有實際店名（不是空白，也不是解析不到店名時的預設描述）。 */
function hasKnownMerchant(row: CardRow) {
  const name = (row.description ?? "").trim();
  return name !== "" && name !== "台新信用卡交易";
}

function samePurchase(left: CardRow, right: CardRow) {
  return sameCardDayAmount(left, right) && merchantNamesMatch(left, right);
}

/** 即時消費清單沒有店名（描述只有消費類別，或解析不到任何名稱）。 */
function storeNameMissing(row: CardRow) {
  const { identityDescription } = cardDetails(row);
  return (
    !hasKnownMerchant(row) ||
    (identityDescription !== undefined &&
      normalizeMerchantName(row.description ?? undefined) ===
        normalizeMerchantName(identityDescription))
  );
}

/** 國外商家的帳單消費日常以商家當地或清算日記錄，與台灣時間的授權日差一天。 */
function sameMerchantAdjacentDay(left: CardRow, right: CardRow) {
  return (
    sameCardAmountWithin(left, right, 1) && merchantNamesMatch(left, right)
  );
}

export async function prepareTaishinAuthorizationWrite(
  db: D1Database,
  records: SyncWriteRecord[],
  encryptedConfig?: string,
) {
  const stored = (
    await db
      .prepare(
        `SELECT id, account_id, source_id, status, authorized_at, amount, currency,
      description, raw_payload, matched_transaction_id FROM bank_transactions
    WHERE connector_id = 'taishin' AND source_id LIKE 'taishin:card:tx:v2:%'`,
      )
      .all<CardRow>()
  ).results;
  const rows = new Map(stored.map((row) => [row.id, row]));
  const incoming = records.filter(
    (record) =>
      record.entityType === "bank_transaction" &&
      String(record.payload.source_id).startsWith("taishin:card:tx:v2:") &&
      record.payload.status === "posted",
  );
  const presentIds = new Set(incoming.map((record) => record.recordKey));
  const unmatchedIncoming = incoming.filter(
    (record) => !rows.has(record.recordKey),
  );
  const unmatchedStored = stored.filter(
    (row) =>
      row.status === "posted" &&
      !presentIds.has(row.id) &&
      row.source_id.split(":").slice(8, -1).join(":") !==
        normalizeMerchantName(row.description ?? undefined),
  );
  const replacements = new Map<string, CardRow>();
  for (const record of incoming) {
    const previous = rows.get(record.recordKey);
    // An authorization already linked to a different posted ID stays pending.
    if (previous?.matched_transaction_id) {
      const target = rows.get(previous.matched_transaction_id);
      if (target?.status === "posted")
        replacements.set(record.recordKey, target);
    }
  }
  for (const record of unmatchedIncoming) {
    const row = record.payload as unknown as CardRow;
    const candidates = unmatchedStored.filter((previous) =>
      samePurchase(row, previous),
    );
    if (candidates.length !== 1) continue;
    const target = candidates[0]!;
    if (
      unmatchedIncoming.filter((other) =>
        samePurchase(other.payload as unknown as CardRow, target),
      ).length !== 1
    )
      continue;
    // Before this connector queried unbilled details, the in-memory lifecycle
    // merger could borrow a pending merchant's ID. Reuse that saved posted ID
    // when the official posted feed later names the purchase differently.
    replacements.set(record.recordKey, target);
  }
  const updated = new Map<string, SyncWriteRecord>();
  for (const original of records) {
    const target = replacements.get(original.recordKey);
    const record = target
      ? {
          ...original,
          recordKey: target.id,
          payload: {
            ...original.payload,
            id: target.id,
            source_id: target.source_id,
          },
        }
      : original;
    const alreadyPrepared = updated.get(record.recordKey);
    if (
      alreadyPrepared?.payload.status === "posted" &&
      record.payload.status === "pending"
    )
      continue;
    updated.set(record.recordKey, record);
    if (
      record.entityType !== "bank_transaction" ||
      !String(record.payload.source_id).startsWith("taishin:card:tx:v2:")
    )
      continue;
    const row = record.payload as unknown as CardRow;
    const previous = rows.get(row.id);
    rows.set(row.id, {
      ...row,
      status: previous?.status === "posted" ? "posted" : row.status,
      authorized_at:
        (previous?.authorized_at?.length ?? 0) > 10
          ? previous!.authorized_at
          : row.authorized_at,
      matched_transaction_id: previous?.matched_transaction_id ?? null,
    });
  }
  // 本次改以新版識別碼寫入、稍後由 prepareTaishinMaskedIdentityMerge 併掉的舊列不當候選，
  // 否則同一筆入帳會同時有新舊兩個候選而配不上；指向舊列的配對視同指向新列。
  const superseded = new Map(
    taishinMaskedIdentityPairs(stored, [...updated.values()]),
  );
  const targeted = new Set(
    [...rows.values()]
      .map((row) => row.matched_transaction_id)
      .filter((id): id is string => Boolean(id))
      .map((id) => superseded.get(id) ?? id),
  );
  const pending = [...rows.values()].filter(
    (row) =>
      row.status === "pending" &&
      !row.matched_transaction_id &&
      !superseded.has(row.id),
  );
  const posted = [...rows.values()].filter(
    (row) =>
      row.status === "posted" &&
      !targeted.has(row.id) &&
      !superseded.has(row.id),
  );
  const links: Array<{
    id: string;
    posted: string;
    authorizedAt: string | null;
  }> = [];
  // 每一輪只在雙向唯一時配對，已配對的授權與入帳不再進入下一輪。
  const linkUnique = (
    pendingPool: CardRow[],
    postedPool: CardRow[],
    match: (left: CardRow, right: CardRow) => boolean,
    // 反向唯一性檢查：同一筆入帳附近符合此條件的授權只能有一筆。
    rival: (left: CardRow, right: CardRow) => boolean = match,
    // 授權時刻是否代表實際消費時間；否則不把它補到入帳列。
    copyAuthorizedAt = true,
  ) => {
    const linkedPending = new Set(links.map((link) => link.id));
    const linkedPosted = new Set(links.map((link) => link.posted));
    const restPending = pendingPool.filter((row) => !linkedPending.has(row.id));
    const restPosted = postedPool.filter((row) => !linkedPosted.has(row.id));
    for (const authorization of restPending) {
      const candidates = restPosted.filter((row) => match(authorization, row));
      if (candidates.length !== 1) continue;
      const target = candidates[0]!;
      if (restPending.filter((row) => rival(row, target)).length !== 1)
        continue;
      links.push({
        id: authorization.id,
        posted: target.id,
        authorizedAt: copyAuthorizedAt ? authorization.authorized_at : null,
      });
    }
  };
  linkUnique(pending, posted, samePurchase);
  // 第二輪：即時消費清單的店名常是公司登記名稱（例如「富邦媒體科技股份有限公司」），
  // 帳單則是商家簡稱（「富邦ｍｏｍｏ－ＥＣ」）。兩邊都有店名、只是寫法不同時，改以同卡、
  // 同日、同幣別同額且雙向唯一配對，避免同一筆消費以授權與入帳各算一次；店名不明時
  // 仍不配對。
  linkUnique(
    pending.filter(hasKnownMerchant),
    posted.filter(hasKnownMerchant),
    sameCardDayAmount,
  );
  // 第三輪：國外商家（例如 APPLE.COM/BILL、STEAMGAMES.COM）帳單上的消費日與台灣時間的
  // 授權日常差一天；店名相符、同卡同額且雙向唯一時才配對。
  linkUnique(pending, posted, sameMerchantAdjacentDay);
  // 第四輪：清單上沒有店名的授權（例如悠遊卡自動加值，授權比帳單消費日晚兩天才送到
  // 銀行）。入帳有店名、同卡同額、相差三天內，且該筆入帳附近沒有其他同額授權時才配對。
  // 台新的授權列不會刪除，配不上的授權會一直和入帳重複計算，因此這裡寧可配對。
  // 這類授權時刻是銀行收到的時間而非消費時間，入帳列保留帳單消費日。
  const nearby = (left: CardRow, right: CardRow) =>
    sameCardAmountWithin(left, right, 3);
  linkUnique(
    pending,
    posted,
    (left, right) =>
      storeNameMissing(left) && hasKnownMerchant(right) && nearby(left, right),
    nearby,
    false,
  );
  const json = JSON.stringify(links);
  const guard =
    encryptedConfig == null
      ? ""
      : " AND EXISTS (SELECT 1 FROM connector_settings WHERE connector_id = 'taishin' AND encrypted_config = ?)";
  const statement = (sql: string, ...bindings: string[]) =>
    db
      .prepare(sql.replace("/* settings guard */", guard))
      .bind(...bindings, ...(encryptedConfig == null ? [] : [encryptedConfig]));
  return {
    records: [...updated.values()],
    afterPromoteStatements:
      links.length === 0
        ? []
        : [
            statement(
              `UPDATE bank_transactions SET matched_transaction_id = json_extract(link.value, '$.posted')
        FROM json_each(?) link WHERE bank_transactions.connector_id = 'taishin'
          AND bank_transactions.id = json_extract(link.value, '$.id')
          AND bank_transactions.status = 'pending' AND bank_transactions.matched_transaction_id IS NULL /* settings guard */`,
              json,
            ),
            statement(
              `UPDATE bank_transactions SET authorized_at = json_extract(link.value, '$.authorizedAt')
        FROM json_each(?) link WHERE bank_transactions.connector_id = 'taishin'
          AND bank_transactions.id = json_extract(link.value, '$.posted')
          AND bank_transactions.status = 'posted' AND length(COALESCE(bank_transactions.authorized_at, '')) <= 10
          AND length(COALESCE(json_extract(link.value, '$.authorizedAt'), '')) > 10 /* settings guard */`,
              json,
            ),
            statement(
              `INSERT INTO bank_transaction_preferences (transaction_id, excluded_from_calculation, created_at, updated_at)
        SELECT json_extract(link.value, '$.posted'), preference.excluded_from_calculation, preference.created_at, preference.updated_at
        FROM json_each(?) link JOIN bank_transaction_preferences preference
          ON preference.transaction_id = json_extract(link.value, '$.id')
        WHERE true /* settings guard */ ON CONFLICT(transaction_id) DO NOTHING`,
              json,
            ),
            statement(
              `INSERT INTO classification_overrides (id, target_type, target_id, category_id, created_at, updated_at)
        SELECT 'override:bank_transaction:' || json_extract(link.value, '$.posted'), 'bank_transaction',
          json_extract(link.value, '$.posted'), preference.category_id, preference.created_at, preference.updated_at
        FROM json_each(?) link JOIN classification_overrides preference
          ON preference.target_type = 'bank_transaction' AND preference.target_id = json_extract(link.value, '$.id')
        WHERE true /* settings guard */ ON CONFLICT(target_type, target_id) DO NOTHING`,
              json,
            ),
            statement(
              `UPDATE invoice_transaction_preferences SET transaction_id = (
          SELECT json_extract(link.value, '$.posted') FROM json_each(?) link
          WHERE json_extract(link.value, '$.id') = invoice_transaction_preferences.transaction_id
        ) WHERE transaction_id IN (SELECT json_extract(value, '$.id') FROM json_each(?))
        AND NOT EXISTS (
          SELECT 1 FROM invoice_transaction_preferences existing JOIN json_each(?) link
            ON existing.transaction_id = json_extract(link.value, '$.posted')
          WHERE existing.decision = 'linked' AND json_extract(link.value, '$.id') = invoice_transaction_preferences.transaction_id
        ) /* settings guard */`,
              json,
              json,
              json,
            ),
            // fork 的代墊角色與備註也帶到入帳列（授權列保留但不再顯示）。
            ...carryRoleOverrideAndNoteStatements(db, json, "$.id", "$.posted"),
          ],
  };
}
