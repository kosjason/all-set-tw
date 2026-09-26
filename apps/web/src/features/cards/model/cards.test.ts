import { describe, expect, it } from "vitest";
import { parseActivityHash } from "@/features/activity/model/url-state";
import {
  cardActivityHash,
  cardsHashIssuer,
  countdownLabel,
  dueUrgency,
  isDueHighlighted,
} from "./cards";

describe("dueUrgency", () => {
  it("highlights unpaid or partial bills due within seven days, including today", () => {
    for (const daysUntilDue of [0, 3, 7])
      expect(
        isDueHighlighted(dueUrgency({ paymentStatus: "unpaid", daysUntilDue })),
      ).toBe(true);
    expect(dueUrgency({ paymentStatus: "partial", daysUntilDue: 5 })).toBe(
      "soon",
    );
    expect(dueUrgency({ paymentStatus: "unpaid", daysUntilDue: -2 })).toBe(
      "overdue",
    );
  });

  it("does not highlight paid, unknown or far-off bills", () => {
    expect(dueUrgency({ paymentStatus: "paid", daysUntilDue: 1 })).toBe(
      "settled",
    );
    expect(dueUrgency({ paymentStatus: "unknown", daysUntilDue: 1 })).toBe(
      "unknown",
    );
    expect(dueUrgency({ paymentStatus: "unpaid", daysUntilDue: 8 })).toBe(
      "normal",
    );
    expect(dueUrgency({ paymentStatus: "unpaid", daysUntilDue: null })).toBe(
      "unknown",
    );
    expect(dueUrgency(null)).toBe("unknown");
  });
});

describe("countdownLabel", () => {
  it("describes today, upcoming and overdue dates", () => {
    expect(countdownLabel(0)).toBe("今天到期");
    expect(countdownLabel(4)).toBe("還有 4 天");
    expect(countdownLabel(-3)).toBe("已逾期 3 天");
    expect(countdownLabel(null)).toBe("截止日未提供");
  });
});

describe("cardActivityHash", () => {
  it("opens the transactions card tab filtered by the card's last four digits", () => {
    const hash = cardActivityHash({ last4: "1111" });
    expect(hash).toBe("#/transactions?tab=card&card=1111");
    // 交易頁解析回相同條件：信用卡分頁、卡片末四碼 1111。
    expect(parseActivityHash(hash)).toMatchObject({
      tab: "card",
      card: "1111",
    });
  });

  it("falls back to the card tab when the card has no last four digits", () => {
    expect(cardActivityHash({ last4: null })).toBe("#/transactions?tab=card");
  });
});

describe("cardsHashIssuer", () => {
  it("reads the issuer only from the cards route", () => {
    expect(cardsHashIssuer("#/cards?issuer=ctbc")).toBe("ctbc");
    expect(cardsHashIssuer("#/cards")).toBe("");
    expect(cardsHashIssuer("#/activity?issuer=ctbc")).toBe("");
    expect(cardsHashIssuer("#/cards?issuer=Bad%20Value")).toBe("");
  });
});
