import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../../../src/platform/env";
import { ownAccountRoutes } from "../../../src/features/own-accounts/route";
import { listOwnAccounts } from "../../../src/features/own-accounts/repository";
import { createTestD1 } from "../../../../../packages/db/testing/d1";

describe("own account routes", () => {
  let harness: Awaited<ReturnType<typeof createTestD1>>;

  beforeAll(async () => {
    harness = await createTestD1();
  }, 60_000);

  afterAll(async () => {
    await harness?.mf.dispose();
  });

  beforeEach(async () => {
    await harness.binding.prepare("DELETE FROM own_accounts").run();
  });

  function request(path: string, init: RequestInit = {}) {
    return ownAccountRoutes.request(
      path,
      {
        ...init,
        headers:
          init.body === undefined
            ? init.headers
            : { "Content-Type": "application/json" },
      },
      { DB: harness.binding } as Env,
    );
  }

  function create(body: unknown) {
    return request("/own-accounts", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  it("creates, lists, updates and deletes own accounts", async () => {
    const created = await create({
      bankCode: "012",
      accountSuffix: "77777",
      label: "  富邦活存 ",
    });
    expect(created.status).toBe(201);
    const account = (await created.json()) as { id: string };
    expect(account).toMatchObject({
      kind: "own_account",
      bankCode: "012",
      accountSuffix: "77777",
      label: "富邦活存",
    });

    const card = await create({
      kind: "unsynced_card",
      bankCode: "810",
      accountSuffix: "99999",
    });
    expect(card.status).toBe(201);
    expect(await card.json()).toMatchObject({
      kind: "unsynced_card",
      label: null,
    });

    const listed = await request("/own-accounts");
    expect(
      ((await listed.json()) as Array<{ bankCode: string }>)
        .map((row) => row.bankCode)
        .sort(),
    ).toEqual(["012", "810"]);

    const updated = await request(`/own-accounts/${account.id}`, {
      method: "PUT",
      body: JSON.stringify({ accountSuffix: "7777", label: "" }),
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({
      id: account.id,
      kind: "own_account",
      bankCode: "012",
      accountSuffix: "7777",
      label: null,
    });

    const deleted = await request(`/own-accounts/${account.id}`, {
      method: "DELETE",
    });
    expect(deleted.status).toBe(200);
    expect(
      (await listOwnAccounts(harness.binding)).map((row) => row.bankCode),
    ).toEqual(["810"]);
  });

  it("rejects full account numbers and malformed input", async () => {
    for (const body of [
      { bankCode: "012", accountSuffix: "0222200077777" },
      { bankCode: "012", accountSuffix: "123" },
      { bankCode: "12", accountSuffix: "77777" },
      { bankCode: "012", accountSuffix: "77777", kind: "credit" },
      { bankCode: "012", accountSuffix: "77777", accountNumber: "1" },
      { bankCode: "012", accountSuffix: "77777", label: "x".repeat(41) },
    ]) {
      const response = await create(body);
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
    expect(await listOwnAccounts(harness.binding)).toEqual([]);

    const empty = await request("/own-accounts/own:missing", {
      method: "PUT",
      body: JSON.stringify({}),
    });
    expect(empty.status).toBe(400);
  });

  it("returns stable errors for duplicates and missing accounts", async () => {
    expect(
      (await create({ bankCode: "812", accountSuffix: "12345" })).status,
    ).toBe(201);
    const duplicate = await create({
      kind: "unsynced_card",
      bankCode: "812",
      accountSuffix: "12345",
    });
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toMatchObject({
      error: { code: "OWN_ACCOUNT_EXISTS" },
    });

    const other = (await (
      await create({ bankCode: "812", accountSuffix: "54321" })
    ).json()) as { id: string };
    const conflict = await request(`/own-accounts/${other.id}`, {
      method: "PUT",
      body: JSON.stringify({ accountSuffix: "12345" }),
    });
    expect(conflict.status).toBe(409);

    for (const init of [
      { method: "PUT", body: JSON.stringify({ label: "x" }) },
      { method: "DELETE" },
    ]) {
      const missing = await request("/own-accounts/own:missing", init);
      expect(missing.status).toBe(404);
      expect(await missing.json()).toMatchObject({
        error: { code: "OWN_ACCOUNT_NOT_FOUND" },
      });
    }
  });
});
