import type { Browser } from "@cloudflare/puppeteer";
import {
  closeBrowserSession,
  launchBrowserWithRetry,
} from "../../sources/browser";
import type { Env } from "../../platform/env";

/**
 * 同步用瀏覽器的自我檢查：用與銀行同步相同的 BROWSER binding 啟動瀏覽器、開一個空白頁、
 * 關閉，不連任何銀行。給 mini 的每日檢查在 6 點排程同步前確認瀏覽器能用（本機
 * Browser Rendering 的 Chrome 快取被清掉後，重新下載可能卡住，之後每次同步都在啟動
 * 瀏覽器時逾時）。
 */
export const BROWSER_CHECK_TIMEOUT_MS = 120_000;

export class BrowserCheckError extends Error {
  constructor(
    message: string,
    readonly stage: "launch" | "page" | "close" | "timeout",
  ) {
    super(message);
    this.name = "BrowserCheckError";
  }
}

export interface BrowserCheckResult {
  ok: true;
  /** 瀏覽器回報的版本，例如 HeadlessChrome/126.0.6478.182。 */
  version: string;
  elapsedMs: number;
}

function errorText(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").slice(0, 200);
}

export async function checkSyncBrowser(
  env: Pick<Env, "BROWSER">,
  timeoutMs = BROWSER_CHECK_TIMEOUT_MS,
): Promise<BrowserCheckResult> {
  const started = Date.now();
  const controller = new AbortController();
  const binding = { fetch: env.BROWSER.fetch.bind(env.BROWSER) };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(
        new BrowserCheckError(
          `瀏覽器在 ${Math.round(timeoutMs / 1000)} 秒內沒有完成啟動與開頁。`,
          "timeout",
        ),
      );
    }, timeoutMs);
  });
  // 逾時後 run 仍可能晚一點才拿到瀏覽器，所以由 run 自己負責關閉。若卡在取得工作階段那一步、
  // 逾時後才拿到，那個工作階段沒有連上，只能等 keep_alive 到期釋放。
  const run = async (): Promise<BrowserCheckResult> => {
    let browser: Browser | undefined;
    try {
      browser = await launchBrowserWithRetry({
        ...binding,
        syncSignal: controller.signal,
      });
    } catch (error) {
      throw new BrowserCheckError(
        `瀏覽器啟動失敗：${errorText(error)}`,
        "launch",
      );
    }
    let version: string;
    try {
      version = await browser.version();
      const page = await browser.newPage();
      await page.setContent("<p>ok</p>");
      const text = await page.evaluate(
        () => document.querySelector("p")?.textContent ?? "",
      );
      if (text !== "ok") throw new Error("空白頁內容不符。");
    } catch (error) {
      await closeBrowserSession(binding, browser);
      throw new BrowserCheckError(
        `瀏覽器開頁失敗：${errorText(error)}`,
        "page",
      );
    }
    // 關不掉的工作階段會占住瀏覽器，不能算健康。
    if (!(await closeBrowserSession(binding, browser)))
      throw new BrowserCheckError(
        "瀏覽器開頁正常，但無法確認工作階段已關閉。",
        "close",
      );
    return { ok: true, version, elapsedMs: Date.now() - started };
  };
  const running = run();
  // 逾時後 run 的失敗不再有人等，避免未處理的 rejection。
  running.catch(() => undefined);
  try {
    return await Promise.race([running, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
