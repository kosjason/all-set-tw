import type { OwnAccount, OwnAccountInput } from "@taiwan-fin-hub/core";
import {
  deleteOwnAccount,
  findOwnAccount,
  insertOwnAccount,
  listOwnAccounts,
  ownAccountIdentityExists,
  updateOwnAccount,
} from "./repository";

export class OwnAccountNotFoundError extends Error {}
export class OwnAccountExistsError extends Error {}

function normalizeLabel(label?: string | null) {
  const trimmed = label?.trim();
  return trimmed ? trimmed : null;
}

function isUniqueViolation(error: unknown) {
  for (
    let current: unknown = error;
    current instanceof Error;
    current = current.cause
  ) {
    if (/UNIQUE constraint failed/i.test(current.message)) return true;
  }
  return false;
}

export async function getOwnAccounts(db: D1Database): Promise<OwnAccount[]> {
  return listOwnAccounts(db);
}

export async function createOwnAccount(
  db: D1Database,
  input: OwnAccountInput,
): Promise<OwnAccount> {
  if (await ownAccountIdentityExists(db, input.bankCode, input.accountSuffix))
    throw new OwnAccountExistsError();
  const now = new Date().toISOString();
  const row = {
    id: `own:${crypto.randomUUID()}`,
    kind: input.kind,
    bankCode: input.bankCode,
    accountSuffix: input.accountSuffix,
    label: normalizeLabel(input.label),
    createdAt: now,
    updatedAt: now,
  };
  try {
    await insertOwnAccount(db, row);
  } catch (error) {
    if (isUniqueViolation(error)) throw new OwnAccountExistsError();
    throw error;
  }
  return row;
}

export async function editOwnAccount(
  db: D1Database,
  id: string,
  input: Partial<OwnAccountInput>,
): Promise<OwnAccount> {
  const current = await findOwnAccount(db, id);
  if (!current) throw new OwnAccountNotFoundError();
  const next = {
    kind: input.kind ?? current.kind,
    bankCode: input.bankCode ?? current.bankCode,
    accountSuffix: input.accountSuffix ?? current.accountSuffix,
    label:
      input.label === undefined ? current.label : normalizeLabel(input.label),
    updatedAt: new Date().toISOString(),
  };
  if (await ownAccountIdentityExists(db, next.bankCode, next.accountSuffix, id))
    throw new OwnAccountExistsError();
  try {
    if (!(await updateOwnAccount(db, id, next)))
      throw new OwnAccountNotFoundError();
  } catch (error) {
    if (isUniqueViolation(error)) throw new OwnAccountExistsError();
    throw error;
  }
  return { ...current, ...next };
}

export async function removeOwnAccount(db: D1Database, id: string) {
  if (!(await deleteOwnAccount(db, id))) throw new OwnAccountNotFoundError();
}
