import { describe, expect, it } from "vitest";
import {
  ECONOMIC_ROLE_CHOICES,
  ECONOMIC_ROLE_CHOICE_LABELS,
  ECONOMIC_ROLES_ASKING_REASON,
  activityAccountLines,
  activityNoteTarget,
  activityRoleBadges,
  activityRoleReasonLabel,
  activityRoleTarget,
  duplicateTargetLabel,
  excludedStatusLabel,
  findDuplicateTarget,
  hasRoleOverride,
  isExcludedActivity,
  roleOverridePath,
  showsRoleInsteadOfCategory,
  suggestsOwnAccount,
} from "./roles";
import type { ActivityItem } from "./types";

const base: ActivityItem = {
  id: "tx-1",
  source: "bank",
  date: "2026-09-04",
  title: "轉帳",
  subtitle: "",
  institutionName: "國泰世華",
  accountName: "薪轉戶",
  amount: -3000,
  currency: "TWD",
  category: "轉帳",
  categoryId: "other",
  classificationRuleId: "system:bank:transfer-keywords",
  status: "posted",
  transactionId: "tx-1",
  economicRole: "spending",
  reviewStatus: "auto",
  duplicateOf: null,
  investmentEventKind: null,
  roleReason: "sign",
};

const invoice: ActivityItem = {
  ...base,
  id: "inv-1",
  source: "invoice",
  title: "全聯",
  institutionName: "電子發票",
  accountName: "AB12345678",
  subtitle: "AB12345678",
  transactionId: undefined,
  invoiceId: "inv-1",
  categoryId: undefined,
  category: "發票",
};

describe("activity role badges", () => {
  it("hides spending and labels every other role", () => {
    expect(activityRoleBadges(base)).toEqual([]);
    expect(
      activityRoleBadges({ ...base, economicRole: "income" }).map(
        (badge) => badge.label,
      ),
    ).toEqual(["收入"]);
    expect(
      activityRoleBadges({ ...base, economicRole: "investment" })[0]?.label,
    ).toBe("投資");
    expect(
      activityRoleBadges({ ...base, economicRole: "own_transfer" })[0]?.label,
    ).toBe("轉到自己帳戶");
    expect(
      activityRoleBadges({ ...base, economicRole: "card_payment" })[0]?.label,
    ).toBe("繳卡費");
  });

  it("marks duplicates instead of their role and adds the review badge", () => {
    expect(
      activityRoleBadges({
        ...invoice,
        duplicateOf: { kind: "bank_transaction", id: "tx-1" },
      }),
    ).toEqual([{ key: "duplicate", label: "重複", tone: "muted" }]);
    expect(
      activityRoleBadges({
        ...base,
        economicRole: "card_payment",
        reviewStatus: "needs_review",
      }).map((badge) => badge.key),
    ).toEqual(["card_payment", "review"]);
  });
});

describe("role in the category column", () => {
  it("replaces the category for every role except spending", () => {
    expect(showsRoleInsteadOfCategory(base)).toBe(false);
    for (const role of [
      "income",
      "investment",
      "own_transfer",
      "card_payment",
    ] as const)
      expect(showsRoleInsteadOfCategory({ ...base, economicRole: role })).toBe(
        true,
      );
    expect(
      showsRoleInsteadOfCategory({
        ...base,
        economicRole: "income",
        duplicateOf: { kind: "bank_transaction", id: "x" },
      }),
    ).toBe(false);
    expect(
      activityRoleBadges(
        { ...base, economicRole: "income", reviewStatus: "needs_review" },
        { includeRole: false },
      ).map((badge) => badge.key),
    ).toEqual(["review"]);
  });

  it("names transfers and card payments when they are excluded", () => {
    expect(excludedStatusLabel({ ...base, economicRole: "card_payment" })).toBe(
      "繳卡費",
    );
    expect(excludedStatusLabel({ ...base, economicRole: "own_transfer" })).toBe(
      "轉到自己帳戶",
    );
    expect(excludedStatusLabel(base)).toBe("不計入收支");
    expect(excludedStatusLabel({ ...base, economicRole: "excluded" })).toBe(
      "不計入",
    );
    expect(
      excludedStatusLabel({
        ...invoice,
        economicRole: "excluded",
        roleReason: "invoice_voided",
      }),
    ).toBe("發票已作廢");
  });

  it("treats the excluded role like the old calculation exclusion", () => {
    expect(isExcludedActivity(base)).toBe(false);
    expect(isExcludedActivity({ ...base, excludedFromCalculation: true })).toBe(
      true,
    );
    expect(isExcludedActivity({ ...base, economicRole: "excluded" })).toBe(
      true,
    );
  });
});

describe("role choices", () => {
  it("offers 不計入 last with an explanation and asks why for amount-changing roles", () => {
    expect(ECONOMIC_ROLE_CHOICES.at(-1)).toBe("excluded");
    expect(ECONOMIC_ROLE_CHOICE_LABELS.excluded).toBe(
      "不計入（未實際付款、已作廢）",
    );
    expect(ECONOMIC_ROLE_CHOICE_LABELS.spending).toBe("消費");
    expect([...ECONOMIC_ROLES_ASKING_REASON].sort()).toEqual([
      "excluded",
      "income",
      "own_transfer",
    ]);
  });
});

describe("activity notes", () => {
  it("writes to the activity itself unless the matched activity holds the note", () => {
    expect(activityNoteTarget(base)).toEqual({
      targetKind: "bank_transaction",
      targetId: "tx-1",
    });
    expect(
      activityNoteTarget({
        ...base,
        invoiceId: "inv-1",
        noteTarget: { kind: "invoice", id: "inv-1" },
      }),
    ).toEqual({ targetKind: "invoice", targetId: "inv-1" });
    expect(
      activityNoteTarget({
        ...base,
        source: "investment",
        transactionId: undefined,
      }),
    ).toBeNull();
  });
});

describe("role reasons", () => {
  it("explains the role in Chinese", () => {
    expect(
      activityRoleReasonLabel({ ...base, roleReason: "invoice_repeat" }),
    ).toBe("同一筆消費可能重複開立發票");
    expect(
      activityRoleReasonLabel({ ...base, roleReason: "own_account" }),
    ).toBe("對方是我的其他帳戶");
    expect(
      activityRoleReasonLabel({
        ...base,
        roleReason: "possible_unsynced_card",
      }),
    ).toContain("可能是未同步的信用卡");
    expect(
      activityRoleReasonLabel({ ...base, reviewStatus: "needs_review" }),
    ).toBe("分類為轉帳，但無法確認對方是不是自己的帳戶");
    expect(activityRoleReasonLabel({ ...base, roleReason: undefined })).toBe(
      undefined,
    );
  });
});

describe("role override targets", () => {
  it("targets bank transactions and invoices but not investment trades", () => {
    expect(activityRoleTarget({ ...base, source: "card" })).toEqual({
      targetKind: "bank_transaction",
      targetId: "tx-1",
    });
    expect(activityRoleTarget(invoice)).toEqual({
      targetKind: "invoice",
      targetId: "inv-1",
    });
    expect(activityRoleTarget({ ...base, source: "investment" })).toBeNull();
    expect(roleOverridePath({ targetKind: "invoice", targetId: "a/b" })).toBe(
      "/api/activity/role-overrides/invoice/a%2Fb",
    );
    expect(hasRoleOverride({ ...base, roleReason: "override" })).toBe(true);
    expect(hasRoleOverride(base)).toBe(false);
  });

  it("suggests registering my own account for unresolved transfers", () => {
    expect(suggestsOwnAccount({ ...base, reviewStatus: "needs_review" })).toBe(
      true,
    );
    expect(suggestsOwnAccount(base)).toBe(false);
    // 舊的「轉帳」分類已不存在，只看轉帳提示規則。
    expect(
      suggestsOwnAccount({
        ...base,
        reviewStatus: "needs_review",
        categoryId: "transfer",
        classificationRuleId: undefined,
      }),
    ).toBe(false);
    expect(
      suggestsOwnAccount({
        ...base,
        reviewStatus: "needs_review",
        ownAccountTransfer: {
          kind: "own_account",
          label: "富邦",
          marker: "轉到自己的帳戶",
        },
      }),
    ).toBe(false);
    expect(
      suggestsOwnAccount({
        ...base,
        economicRole: "own_transfer",
        roleReason: "override",
      }),
    ).toBe(true);
  });
});

describe("duplicates", () => {
  const card: ActivityItem = { ...base, source: "card", title: "全聯福利中心" };
  const duplicate: ActivityItem = {
    ...invoice,
    duplicateOf: { kind: "bank_transaction", id: "tx-1" },
  };

  it("finds the activity a duplicate was merged into", () => {
    const target = findDuplicateTarget(duplicate, [duplicate, card]);
    expect(target).toBe(card);
    expect(duplicateTargetLabel(duplicate, target)).toBe("已併入信用卡交易");
    expect(duplicateTargetLabel(duplicate, undefined)).toBe(
      "已併入銀行／信用卡交易",
    );
    expect(duplicateTargetLabel(card, undefined)).toBeUndefined();
  });
});

describe("account column", () => {
  it("shows 電子發票 for invoices without the invoice number", () => {
    expect(activityAccountLines(invoice)).toEqual({ primary: "電子發票" });
    expect(activityAccountLines(base)).toEqual({
      primary: "國泰世華",
      secondary: "薪轉戶",
    });
  });
});
