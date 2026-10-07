import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const puppeteerMock = vi.hoisted(() => ({
  connect: vi.fn(),
  launch: vi.fn(),
  limits: vi.fn(),
  sessions: vi.fn(),
}));
vi.mock("@cloudflare/puppeteer", () => ({ default: puppeteerMock }));

import { createCathaybkConnector } from "../../src/sources/cathaybk/connector";
import { createEsunConnector } from "../../src/sources/esun/connector";

const dailyQuota = new Error(
  "Unable to create new browser: code: 429: message: Browser time limit exceeded for today",
);
const rateLimited = new Error(
  "Unable to create new browser: code: 429: message: Rate limit exceeded",
);

// prepareBrowserLoginWithRetry binds the binding's fetch (07e328c).
const browserBinding = { fetch: vi.fn() } as unknown as Fetcher;

describe("browser connectors on Browser Run capacity", () => {
  beforeEach(() => {
    puppeteerMock.launch.mockReset();
    // prepareBrowserLoginWithRetry (07e328c) checks Browser Run limits first.
    puppeteerMock.limits.mockReset().mockResolvedValue({
      allowedBrowserAcquisitions: 1,
      timeUntilNextAllowedBrowserAcquisition: 0,
      activeSessions: [],
      maxConcurrentSessions: 2,
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("reports E.SUN launch capacity failures", async () => {
    puppeteerMock.launch.mockRejectedValueOnce(rateLimited);
    await expect(
      createEsunConnector(browserBinding).sync({
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
      createCathaybkConnector(browserBinding).sync({
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
