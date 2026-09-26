import { createDrizzle, ownAccounts } from "@taiwan-fin-hub/db";
import type { OwnAccountKind } from "@taiwan-fin-hub/core";
import { and, asc, eq, ne, sql } from "drizzle-orm";

export type OwnAccountRow = {
  id: string;
  kind: OwnAccountKind;
  bankCode: string;
  accountSuffix: string;
  label: string | null;
  createdAt: string;
  updatedAt: string;
};

const ownAccountColumns = {
  id: ownAccounts.id,
  kind: sql<OwnAccountKind>`${ownAccounts.kind}`,
  bankCode: ownAccounts.bankCode,
  accountSuffix: ownAccounts.accountSuffix,
  label: ownAccounts.label,
  createdAt: ownAccounts.createdAt,
  updatedAt: ownAccounts.updatedAt,
};

export async function listOwnAccounts(
  db: D1Database,
): Promise<OwnAccountRow[]> {
  return createDrizzle(db)
    .select(ownAccountColumns)
    .from(ownAccounts)
    .orderBy(asc(ownAccounts.createdAt), asc(ownAccounts.id))
    .all();
}

export async function findOwnAccount(
  db: D1Database,
  id: string,
): Promise<OwnAccountRow | undefined> {
  return createDrizzle(db)
    .select(ownAccountColumns)
    .from(ownAccounts)
    .where(eq(ownAccounts.id, id))
    .get();
}

export async function ownAccountIdentityExists(
  db: D1Database,
  bankCode: string,
  accountSuffix: string,
  exceptId?: string,
) {
  const row = await createDrizzle(db)
    .select({ id: ownAccounts.id })
    .from(ownAccounts)
    .where(
      and(
        eq(ownAccounts.bankCode, bankCode),
        eq(ownAccounts.accountSuffix, accountSuffix),
        exceptId ? ne(ownAccounts.id, exceptId) : undefined,
      ),
    )
    .get();
  return Boolean(row);
}

export async function insertOwnAccount(db: D1Database, row: OwnAccountRow) {
  await createDrizzle(db).insert(ownAccounts).values(row).run();
}

export async function updateOwnAccount(
  db: D1Database,
  id: string,
  values: Pick<
    OwnAccountRow,
    "kind" | "bankCode" | "accountSuffix" | "label" | "updatedAt"
  >,
) {
  const result = await createDrizzle(db)
    .update(ownAccounts)
    .set(values)
    .where(eq(ownAccounts.id, id))
    .run();
  return result.meta.changes > 0;
}

export async function deleteOwnAccount(db: D1Database, id: string) {
  const result = await createDrizzle(db)
    .delete(ownAccounts)
    .where(eq(ownAccounts.id, id))
    .run();
  return result.meta.changes > 0;
}
