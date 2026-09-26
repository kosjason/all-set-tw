import {
  createDrizzle,
  bankAccounts,
  bankBalanceSnapshots,
  bankTransactions,
  exchangeRates,
  manualAssets,
  netWorthHistory,
} from "@taiwan-fin-hub/db";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import {
  DERIVED_BALANCE_SOURCE_PREFIX,
  derivedAsOfAt,
  derivedSourceId,
  type BackfillAccountInput,
  type BackfillPlan,
  type BackfillTransactionInput,
} from "./backfill";

const history = alias(netWorthHistory, "history");
const asset = alias(manualAssets, "asset");
const rate = alias(exchangeRates, "rate");
const account = alias(bankAccounts, "account");
const latest = alias(bankBalanceSnapshots, "latest");

export type NetWorthPageCursor = {
  date: string;
  source: string;
  assetType: string;
  id: string;
};

export async function listNetWorthChartHistory(db: D1Database) {
  return createDrizzle(db)
    .select({
      date: history.date,
      netWorth: sql<number>`CASE
           WHEN ${history.source} != 'manual' OR ${asset.currency} = 'TWD'
             THEN ${history.netWorth}
           WHEN ${rate.rateToTwd} IS NOT NULL
             THEN ${history.netWorth} * ${rate.rateToTwd}
           ELSE 0
         END`.as("netWorth"),
      assetType: history.assetType,
      source: history.source,
    })
    .from(history)
    .leftJoin(
      asset,
      sql`${history.source} = 'manual' AND ${asset.id} = ${history.assetType}`,
    )
    .leftJoin(rate, eq(rate.currency, asset.currency))
    .where(
      sql`${history.source} = 'manual'
          OR (${history.source} = 'bank' AND ${history.assetType} = 'deposit')
          OR ${history.assetType} IN ('stock', 'fund')`,
    )
    .orderBy(
      asc(history.date),
      asc(history.source),
      asc(history.assetType),
      asc(history.id),
    )
    .all();
}

export async function listNetWorthHistory(
  db: D1Database,
  limit: number,
  cursor?: NetWorthPageCursor,
) {
  return createDrizzle(db)
    .select({
      id: history.id,
      date: history.date,
      netWorth: history.netWorth,
      assetType: history.assetType,
      source: history.source,
    })
    .from(history)
    .where(
      cursor
        ? sql`(
            ${history.date} < ${cursor.date}
            OR (
              ${history.date} = ${cursor.date}
              AND (${history.source}, ${history.assetType}, ${history.id}) > (${cursor.source}, ${cursor.assetType}, ${cursor.id})
            )
          )`
        : undefined,
    )
    .orderBy(
      desc(history.date),
      asc(history.source),
      asc(history.assetType),
      asc(history.id),
    )
    .limit(limit)
    .all();
}

export async function findBankHistoryDateBounds(db: D1Database) {
  return (
    (await createDrizzle(db)
      .select({
        minDate: sql<
          string | null
        >`min(substr(${bankBalanceSnapshots.asOfAt}, 1, 10))`.as("minDate"),
        maxDate: sql<
          string | null
        >`max(substr(${bankBalanceSnapshots.asOfAt}, 1, 10))`.as("maxDate"),
      })
      .from(bankBalanceSnapshots)
      .get()) ?? null
  );
}

export async function calculateBankDepositValue(db: D1Database, date: string) {
  const rows = await createDrizzle(db)
    .select({
      balance: latest.balance,
      currency: latest.currency,
      rateToTwd: rate.rateToTwd,
    })
    .from(account)
    .innerJoin(
      latest,
      eq(
        latest.id,
        sql`(
          SELECT snapshot.id
          FROM bank_balance_snapshots snapshot
          WHERE snapshot.account_id = ${account.id}
            AND substr(snapshot.as_of_at, 1, 10) <= ${date}
          ORDER BY snapshot.as_of_at DESC, snapshot.updated_at DESC
          LIMIT 1
        )`,
      ),
    )
    .leftJoin(rate, eq(rate.currency, latest.currency))
    .where(
      and(
        isNull(account.canonicalAccountId),
        sql`COALESCE(${account.accountType}, 'unknown') != 'credit'`,
      ),
    )
    .all();

  return Math.round(
    rows.reduce((sum, row) => {
      const currency = row.currency || "TWD";
      if (currency === "TWD") return sum + row.balance;
      return row.rateToTwd ? sum + row.balance * row.rateToTwd : sum;
    }, 0),
  );
}

export async function upsertBankDepositHistory(
  db: D1Database,
  points: Array<{ date: string; netWorth: number }>,
  now: string,
) {
  const database = createDrizzle(db);
  for (let offset = 0; offset < points.length; offset += 100) {
    const [first, ...rest] = points
      .slice(offset, offset + 100)
      .map(({ date, netWorth }) =>
        database
          .insert(netWorthHistory)
          .values({
            id: `bank:deposit:${date}`,
            date,
            netWorth,
            assetType: "deposit",
            source: "bank",
            snapshottedAt: now,
          })
          .onConflictDoUpdate({
            target: [
              netWorthHistory.source,
              netWorthHistory.assetType,
              netWorthHistory.date,
            ],
            set: {
              netWorth,
              snapshottedAt: now,
            },
          }),
      );
    if (first) await database.batch([first, ...rest]);
  }
}

const DERIVED_SOURCE_PATTERN = `${DERIVED_BALANCE_SOURCE_PREFIX}%`;

function depositAccountFilter() {
  return and(
    isNull(bankAccounts.canonicalAccountId),
    sql`COALESCE(${bankAccounts.accountType}, 'unknown') != 'credit'`,
  );
}

/** 存款帳戶（排除信用卡與已合併帳戶）及其最早一筆真實餘額快照。 */
export async function listDepositBackfillAccounts(
  db: D1Database,
): Promise<BackfillAccountInput[]> {
  const rows = await createDrizzle(db)
    .select({
      id: bankAccounts.id,
      connectorId: bankAccounts.connectorId,
      accountLast4: bankAccounts.accountLast4,
      openedDate: bankAccounts.openedDate,
      anchorBalance: latest.balance,
      anchorCurrency: latest.currency,
      anchorAsOfAt: latest.asOfAt,
    })
    .from(bankAccounts)
    .leftJoin(
      latest,
      eq(
        latest.id,
        sql`(
          SELECT snapshot.id
          FROM bank_balance_snapshots snapshot
          WHERE snapshot.account_id = ${bankAccounts.id}
            AND snapshot.source_id NOT LIKE ${DERIVED_SOURCE_PATTERN}
          ORDER BY snapshot.as_of_at ASC, snapshot.updated_at ASC
          LIMIT 1
        )`,
      ),
    )
    .where(depositAccountFilter())
    .orderBy(asc(bankAccounts.connectorId), asc(bankAccounts.id))
    .all();
  return rows.map((row) => ({
    id: row.id,
    connectorId: row.connectorId,
    accountLast4: row.accountLast4,
    openedDate: row.openedDate?.slice(0, 10) ?? null,
    anchor:
      row.anchorAsOfAt && row.anchorBalance !== null
        ? {
            balance: row.anchorBalance,
            currency: row.anchorCurrency || "TWD",
            asOfAt: row.anchorAsOfAt,
          }
        : null,
  }));
}

/** 存款帳戶的已入帳交易（推算只需要金額、日期與 raw 中的交易後餘額）。 */
export async function listDepositBackfillTransactions(
  db: D1Database,
): Promise<BackfillTransactionInput[]> {
  return createDrizzle(db)
    .select({
      accountId: bankTransactions.accountId,
      postedDate: bankTransactions.postedDate,
      authorizedAt: bankTransactions.authorizedAt,
      amount: bankTransactions.amount,
      currency: bankTransactions.currency,
      rawPayload: bankTransactions.rawPayload,
    })
    .from(bankTransactions)
    .innerJoin(bankAccounts, eq(bankAccounts.id, bankTransactions.accountId))
    .where(and(depositAccountFilter(), eq(bankTransactions.status, "posted")))
    .orderBy(asc(bankTransactions.accountId), asc(bankTransactions.id))
    .all();
}

/**
 * 寫入推算快照並清掉不再成立的舊推算值；真實快照（source_id 不以 derived 前綴開頭）
 * 不會被刪除或覆蓋。source_id 以日期組成，重跑不會重複寫入。
 */
export async function replaceDerivedBalanceSnapshots(
  db: D1Database,
  plan: BackfillPlan,
  now: string,
) {
  const database = createDrizzle(db);
  const cleanup = plan.accounts.map((report) =>
    database.delete(bankBalanceSnapshots).where(
      and(
        eq(bankBalanceSnapshots.accountId, report.accountId),
        sql`${bankBalanceSnapshots.sourceId} LIKE ${DERIVED_SOURCE_PATTERN}`,
        report.status === "backfilled" && report.from && report.to
          ? sql`(${bankBalanceSnapshots.sourceId} < ${derivedSourceId(report.from)}
                OR ${bankBalanceSnapshots.sourceId} > ${derivedSourceId(report.to)})`
          : undefined,
      ),
    ),
  );
  const upserts = plan.snapshots.map((snapshot) => {
    const sourceId = derivedSourceId(snapshot.date);
    const asOfAt = derivedAsOfAt(snapshot.date);
    const rawPayload = JSON.stringify({
      derived: true,
      method: snapshot.method,
    });
    return database
      .insert(bankBalanceSnapshots)
      .values({
        id: `${snapshot.accountId}:${sourceId}`,
        connectorId: snapshot.connectorId,
        accountId: snapshot.accountId,
        sourceId,
        balance: snapshot.balance,
        currency: snapshot.currency,
        asOfAt,
        rawPayload,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          bankBalanceSnapshots.connectorId,
          bankBalanceSnapshots.accountId,
          bankBalanceSnapshots.sourceId,
        ],
        set: {
          balance: snapshot.balance,
          currency: snapshot.currency,
          asOfAt,
          rawPayload,
          updatedAt: now,
        },
        setWhere: sql`${bankBalanceSnapshots.sourceId} LIKE ${DERIVED_SOURCE_PATTERN}`,
      });
  });
  const statements = [...cleanup, ...upserts];
  for (let offset = 0; offset < statements.length; offset += 100) {
    const [first, ...rest] = statements.slice(offset, offset + 100);
    if (first) await database.batch([first, ...rest]);
  }
}

/** 計算存款歷史所需的全部快照（含推算），一次載入後在記憶體內逐日計算。 */
export async function listDepositHistorySnapshots(db: D1Database) {
  return createDrizzle(db)
    .select({
      accountId: latest.accountId,
      balance: latest.balance,
      currency: latest.currency,
      asOfAt: latest.asOfAt,
      updatedAt: latest.updatedAt,
      rateToTwd: rate.rateToTwd,
    })
    .from(latest)
    .innerJoin(account, eq(account.id, latest.accountId))
    .leftJoin(rate, eq(rate.currency, latest.currency))
    .where(
      and(
        isNull(account.canonicalAccountId),
        sql`COALESCE(${account.accountType}, 'unknown') != 'credit'`,
      ),
    )
    .orderBy(asc(latest.accountId), asc(latest.asOfAt), asc(latest.updatedAt))
    .all();
}

/** 推算快照涵蓋的日期範圍（供前端標示推算區段）。 */
export async function findDerivedBalanceDateBounds(db: D1Database) {
  return (
    (await createDrizzle(db)
      .select({
        from: sql<
          string | null
        >`min(substr(${bankBalanceSnapshots.asOfAt}, 1, 10))`.as("from"),
        until: sql<
          string | null
        >`max(substr(${bankBalanceSnapshots.asOfAt}, 1, 10))`.as("until"),
      })
      .from(bankBalanceSnapshots)
      .where(
        sql`${bankBalanceSnapshots.sourceId} LIKE ${DERIVED_SOURCE_PATTERN}`,
      )
      .get()) ?? null
  );
}

export async function findLatestBankDepositHistoryDate(db: D1Database) {
  const row = await createDrizzle(db)
    .select({
      date: sql<string | null>`max(${netWorthHistory.date})`.as("date"),
    })
    .from(netWorthHistory)
    .where(
      and(
        eq(netWorthHistory.source, "bank"),
        eq(netWorthHistory.assetType, "deposit"),
      ),
    )
    .get();
  return row?.date ?? null;
}
