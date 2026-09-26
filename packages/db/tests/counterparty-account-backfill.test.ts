import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { unstable_splitSqlQuery } from "wrangler";
import { TAIWAN_BANKS, taiwanBankShortName } from "../../core/src/taiwan-banks";
import { createTestD1, readMigrations } from "../testing/d1";

const migration = readFileSync(
  new URL(
    "../migrations/0051_bank_transaction_counterparty_account.sql",
    import.meta.url,
  ),
  "utf8",
);
const all = readMigrations();
const previous = all.slice(0, all.indexOf(migration));

const FULL_OUT = "0000111100066666";
const FULL_IN = "0000333300088888";

function raw(fields: Record<string, unknown>) {
  return JSON.stringify({ description: "測試", ...fields });
}

it("keeps the migration bank names in sync with the core bank table", () => {
  const cases = [...migration.matchAll(/WHEN '(\d{3})' THEN '([^']+)'/g)].map(
    ([, code, name]) => [code, name],
  );
  expect(cases).toEqual(
    TAIWAN_BANKS.map((bank) => [bank.code, taiwanBankShortName(bank.code)]),
  );
});

it("backfills masked Cathay counterparties without copying full account numbers", async () => {
  const h = await createTestD1(undefined, previous);
  try {
    const db = h.binding;
    const rows: Array<[string, string, number, string, string | null]> = [
      [
        "out",
        "cathaybk",
        -27000,
        raw({
          expendBankId: "012",
          expendAcctNo: FULL_OUT,
          specialMemo: `(012)${FULL_OUT}；`,
        }),
        null,
      ],
      [
        "in",
        "cathaybk",
        5000,
        raw({
          expendBankId: "",
          expendAcctNo: "",
          specialMemo: `(807)${FULL_IN}；`,
        }),
        null,
      ],
      [
        "unknown-bank",
        "cathaybk",
        -100,
        raw({ expendBankId: "999", expendAcctNo: FULL_OUT }),
        null,
      ],
      [
        "e-wallet-name",
        "cathaybk",
        -500,
        raw({
          expendBankId: "",
          specialMemo: "(013)街口電子支付股份有限公司",
        }),
        null,
      ],
      [
        "cardless",
        "cathaybk",
        -1000,
        raw({ expendBankId: "   ", expendAcctNo: "0000000000000000" }),
        null,
      ],
      [
        "inflow-ignores-expend",
        "cathaybk",
        100,
        raw({ expendBankId: "012", expendAcctNo: FULL_OUT }),
        null,
      ],
      [
        "existing-counterparty",
        "cathaybk",
        -100,
        raw({ expendBankId: "012", expendAcctNo: FULL_OUT }),
        "自訂名稱",
      ],
      [
        "other-connector",
        "esun",
        -100,
        raw({ expendBankId: "012", expendAcctNo: FULL_OUT }),
        null,
      ],
    ];
    await db.batch([
      db.prepare(
        "INSERT INTO bank_accounts (id,connector_id,source_id,created_at,updated_at) VALUES ('a','cathaybk','a','t','t')",
      ),
      ...rows.map(([id, connector, amount, payload, counterparty]) =>
        db
          .prepare(
            "INSERT INTO bank_transactions (id,connector_id,account_id,source_id,amount,counterparty,raw_payload,created_at,updated_at) VALUES (?,?,'a',?,?,?,?,'t','t')",
          )
          .bind(id, connector, id, amount, counterparty, payload),
      ),
    ]);

    await db.batch(
      unstable_splitSqlQuery(migration).map((statement) =>
        db.prepare(statement),
      ),
    );

    const { results } = await db
      .prepare(
        "SELECT id, counterparty, counterparty_bank_code AS bankCode, counterparty_account_suffix AS suffix FROM bank_transactions ORDER BY id",
      )
      .all();
    expect(results).toEqual([
      { id: "cardless", counterparty: null, bankCode: null, suffix: null },
      {
        id: "e-wallet-name",
        counterparty: null,
        bankCode: null,
        suffix: null,
      },
      {
        id: "existing-counterparty",
        counterparty: "自訂名稱",
        bankCode: "012",
        suffix: "66666",
      },
      {
        id: "in",
        counterparty: "永豐 …88888",
        bankCode: "807",
        suffix: "88888",
      },
      {
        id: "inflow-ignores-expend",
        counterparty: null,
        bankCode: null,
        suffix: null,
      },
      {
        id: "other-connector",
        counterparty: null,
        bankCode: null,
        suffix: null,
      },
      {
        id: "out",
        counterparty: "台北富邦 …66666",
        bankCode: "012",
        suffix: "66666",
      },
      {
        id: "unknown-bank",
        counterparty: "999 …66666",
        bankCode: "999",
        suffix: "66666",
      },
    ]);
    for (const row of results)
      expect(JSON.stringify([row.counterparty, row.suffix])).not.toMatch(
        /\d{6,}/,
      );

    await expect(
      db
        .prepare(
          "UPDATE bank_transactions SET counterparty_account_suffix = ? WHERE id = 'out'",
        )
        .bind(FULL_OUT)
        .run(),
    ).rejects.toThrow(/CHECK/);
  } finally {
    await h.mf.dispose();
  }
}, 60_000);
