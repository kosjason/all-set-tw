import {
  createDrizzle,
  bankAccounts,
  bankTransactions,
  invoiceTransactionPreferences,
  invoices,
} from "../../db";
import {
  and,
  asc,
  desc,
  eq,
  isNotNull,
  isNull,
  ne,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import {
  lateInvoiceMerchantLearning,
  type InvoiceTransactionPreference,
} from "@taiwan-fin-hub/shared";

const bankTx = alias(bankTransactions, "bank_tx");
const account = alias(bankAccounts, "account");
const linkedTx = alias(bankTransactions, "linked_tx");
const linkedAccount = alias(bankAccounts, "linked_account");

export type InvoiceTransactionPreferenceRow = InvoiceTransactionPreference & {
  createdAt: string;
  updatedAt: string;
};

export type MappingInvoiceRow = {
  id: string;
  invoiceDate: string;
};

export type MappingTransactionRow = {
  id: string;
  postedDate: string | null;
  authorizedAt: string | null;
  amount: number;
  currency: string;
  accountType: string | null;
};

/**
 * 手動配對偏好。手動連結另帶 learnedMerchant：發票晚開的連結記下賣方、刷卡商家
 * 與帳戶，供配對學習（{@link lateInvoiceMerchantLearning}）。
 */
export async function listInvoiceTransactionPreferences(
  db: D1Database,
): Promise<InvoiceTransactionPreferenceRow[]> {
  const drizzle = createDrizzle(db);
  const rows = await drizzle
    .select({
      invoiceId: invoiceTransactionPreferences.invoiceId,
      transactionId: invoiceTransactionPreferences.transactionId,
      decision: sql<
        "linked" | "separate"
      >`${invoiceTransactionPreferences.decision}`,
      createdAt: invoiceTransactionPreferences.createdAt,
      updatedAt: invoiceTransactionPreferences.updatedAt,
      invoiceDate: invoices.invoiceDate,
      invoiceCurrency: invoices.currency,
      sellerName: invoices.sellerName,
      sellerBan: invoices.sellerBan,
      transactionConnectorId: linkedTx.connectorId,
      transactionSourceId: linkedTx.sourceId,
      transactionAccountId: linkedTx.accountId,
      transactionAccountType: linkedAccount.accountType,
      transactionAmount: linkedTx.amount,
      transactionCurrency: linkedTx.currency,
      transactionAuthorizedAt: linkedTx.authorizedAt,
      transactionPostedDate: linkedTx.postedDate,
      transactionDescription: linkedTx.description,
      transactionCounterparty: linkedTx.counterparty,
    })
    .from(invoiceTransactionPreferences)
    .leftJoin(
      invoices,
      eq(invoices.id, invoiceTransactionPreferences.invoiceId),
    )
    .leftJoin(
      linkedTx,
      and(
        eq(linkedTx.id, invoiceTransactionPreferences.transactionId),
        eq(invoiceTransactionPreferences.decision, "linked"),
      ),
    )
    .leftJoin(linkedAccount, eq(linkedAccount.id, linkedTx.accountId))
    .where(
      notExists(
        drizzle
          .select({ id: bankTx.id })
          .from(bankTx)
          .where(
            and(
              eq(bankTx.id, invoiceTransactionPreferences.transactionId),
              eq(bankTx.status, "pending"),
              isNotNull(bankTx.matchedTransactionId),
            ),
          ),
      ),
    )
    .orderBy(
      desc(invoiceTransactionPreferences.updatedAt),
      asc(invoiceTransactionPreferences.invoiceId),
    )
    .all();
  return rows.map((row) => {
    const learnedMerchant =
      row.decision === "linked" &&
      row.transactionId &&
      row.invoiceDate &&
      row.transactionConnectorId &&
      row.transactionSourceId &&
      row.transactionAccountId &&
      row.transactionAmount != null &&
      row.transactionCurrency
        ? lateInvoiceMerchantLearning(
            {
              invoiceDate: row.invoiceDate,
              currency: row.invoiceCurrency,
              sellerName: row.sellerName,
              sellerBan: row.sellerBan,
            },
            {
              id: row.transactionId,
              connectorId: row.transactionConnectorId,
              sourceId: row.transactionSourceId,
              accountId: row.transactionAccountId,
              accountType: row.transactionAccountType,
              amount: row.transactionAmount,
              currency: row.transactionCurrency,
              authorizedAt: row.transactionAuthorizedAt,
              postedDate: row.transactionPostedDate,
              description: row.transactionDescription,
              counterparty: row.transactionCounterparty,
            },
          )
        : undefined;
    return {
      invoiceId: row.invoiceId,
      transactionId: row.transactionId,
      decision: row.decision,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      learnedMerchant: learnedMerchant ?? null,
    };
  });
}

export async function findMappingInvoice(db: D1Database, invoiceId: string) {
  return (
    (await createDrizzle(db)
      .select({
        id: invoices.id,
        invoiceDate: invoices.invoiceDate,
      })
      .from(invoices)
      .where(eq(invoices.id, invoiceId))
      .get()) ?? null
  );
}

export async function findMappingTransaction(
  db: D1Database,
  transactionId: string,
) {
  return (
    (await createDrizzle(db)
      .select({
        id: bankTx.id,
        postedDate: bankTx.postedDate,
        authorizedAt: bankTx.authorizedAt,
        amount: bankTx.amount,
        currency: bankTx.currency,
        accountType: account.accountType,
      })
      .from(bankTx)
      .innerJoin(account, eq(account.id, bankTx.accountId))
      .where(
        and(
          eq(bankTx.id, transactionId),
          or(ne(bankTx.status, "pending"), isNull(bankTx.matchedTransactionId)),
        ),
      )
      .get()) ?? null
  );
}

export async function findLinkedInvoiceId(
  db: D1Database,
  transactionId: string,
) {
  const row = await createDrizzle(db)
    .select({
      invoiceId: invoiceTransactionPreferences.invoiceId,
    })
    .from(invoiceTransactionPreferences)
    .where(
      and(
        eq(invoiceTransactionPreferences.transactionId, transactionId),
        eq(invoiceTransactionPreferences.decision, "linked"),
      ),
    )
    .get();
  return row?.invoiceId;
}

export async function upsertInvoiceTransactionPreference(
  db: D1Database,
  input: {
    invoiceId: string;
    transactionId: string | null;
    decision: "linked" | "separate";
    now: string;
  },
) {
  await createDrizzle(db)
    .insert(invoiceTransactionPreferences)
    .values({
      invoiceId: input.invoiceId,
      transactionId: input.transactionId,
      decision: input.decision,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .onConflictDoUpdate({
      target: invoiceTransactionPreferences.invoiceId,
      set: {
        transactionId: input.transactionId,
        decision: input.decision,
        updatedAt: input.now,
      },
    })
    .run();
}
