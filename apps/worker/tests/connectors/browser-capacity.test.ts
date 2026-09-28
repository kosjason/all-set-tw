import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const puppeteerMock = vi.hoisted(() => ({
  connect: vi.fn(),
  launch: vi.fn(),
  sessions: vi.fn(),
}));
vi.mock("@cloudflare/puppeteer", () => ({ default: puppeteerMock }));

import { createCathaybkConnector } from "../../src/connectors/cathaybk";
import { createEsunConnector } from "../../src/connectors/esun";

const dailyQuota = new Error(
  "Unable to create new browser: code: 429: message: Browser time limit exceeded for today",
);
const rateLimited = new Error(
  "Unable to create new browser: code: 429: message: Rate limit exceeded",
);

describe("browser connectors on Browser Run capacity", () => {
  beforeEach(() => {
    puppeteerMock.launch.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("reports E.SUN launch capacity failures", async () => {
    puppeteerMock.launch.mockRejectedValueOnce(rateLimited);
    await expect(
      createEsunConnector({} as Fetcher).sync({
        userId: "A123456789",
        account: "test-user",
        password: "test-password",
      }),
    ).rejects.toMatchObject({
      name: "BrowserRunCapacityError",
      kind: "rate_limit",
    });
  });

  it("reports Cathay launch capacity failures", async () => {
    puppeteerMock.launch.mockRejectedValueOnce(dailyQuota);
    await expect(
      createCathaybkConnector({} as Fetcher).sync({
        userId: "A123456789",
        account: "test-user",
        password: "test-password",
      }),
    ).rejects.toMatchObject({
      name: "BrowserRunCapacityError",
      kind: "daily_quota",
    });
  });
});
