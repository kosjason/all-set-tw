/**
 * 國泰存款交易明細查詢（`B_ACCT_Q_TransferDetail`）的請求改寫。
 *
 * 2026-10 改版後明細頁會跳出彈出視窗蓋住帳號與期間選單，無法再用畫面操作切換帳戶。
 * 進入明細頁時頁面會自己送一次查詢；這裡以那筆請求為範本，改寫帳號與日期區間後在同一
 * 已登入頁面內重送。只做唯讀查詢，回應仍逐筆核對帳號。
 */

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export type CathayTransferQueryRewrite = {
  body: string;
  /** 範本中找到並替換了帳號欄位。 */
  accountReplaced: boolean;
  /** 被替換的帳號欄位名稱（只有名稱，供診斷）。 */
  accountKeys: string[];
  /** 範本中找到開始與結束日期，並把開始日期往前推到所需天數。 */
  datesExtended: boolean;
};

type DateFormat = {
  parse: (value: string) => Date | undefined;
  format: (date: Date) => string;
};

const pad = (value: number, length = 2) => String(value).padStart(length, "0");

function utcDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? date
    : undefined;
}

function dateFormatOf(value: string): DateFormat | undefined {
  const separated = /^(\d{4})([/-])(\d{2})\2(\d{2})$/.exec(value);
  if (separated) {
    const separator = separated[2]!;
    return {
      parse: (text) => {
        const match = /^(\d{4})[/-](\d{2})[/-](\d{2})$/.exec(text);
        return match
          ? utcDate(Number(match[1]), Number(match[2]), Number(match[3]))
          : undefined;
      },
      format: (date) =>
        [
          date.getUTCFullYear(),
          pad(date.getUTCMonth() + 1),
          pad(date.getUTCDate()),
        ].join(separator),
    };
  }
  if (/^\d{8}$/.test(value)) {
    return {
      parse: (text) =>
        /^\d{8}$/.test(text)
          ? utcDate(
              Number(text.slice(0, 4)),
              Number(text.slice(4, 6)),
              Number(text.slice(6, 8)),
            )
          : undefined,
      format: (date) =>
        `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`,
    };
  }
  if (/^\d{7}$/.test(value)) {
    // 民國年：1150904
    return {
      parse: (text) =>
        /^\d{7}$/.test(text)
          ? utcDate(
              Number(text.slice(0, 3)) + 1911,
              Number(text.slice(3, 5)),
              Number(text.slice(5, 7)),
            )
          : undefined,
      format: (date) =>
        `${pad(date.getUTCFullYear() - 1911, 3)}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`,
    };
  }
  return undefined;
}

type Leaf = { holder: Record<string, Json> | Json[]; key: string | number };

function stringLeaves(value: Json, leaves: Leaf[] = []): Leaf[] {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      if (typeof item === "string") leaves.push({ holder: value, key: index });
      else stringLeaves(item, leaves);
    });
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === "string") leaves.push({ holder: value, key });
      else stringLeaves(item, leaves);
    }
  }
  return leaves;
}

const read = (leaf: Leaf) =>
  (leaf.holder as Record<string | number, Json>)[leaf.key] as string;
const write = (leaf: Leaf, value: string) => {
  (leaf.holder as Record<string | number, Json>)[leaf.key] = value;
};

/** 帳號欄位：純數字、以帳號結尾、前面只能補 0（API 會補零到 16 碼）。 */
function isAccountValue(value: string, account: string) {
  return (
    /^\d+$/.test(value) &&
    value.endsWith(account) &&
    /^0*$/.test(value.slice(0, -account.length))
  );
}

/**
 * 以範本請求為基礎改寫帳號與日期區間。範本解析失敗時回傳原文且兩個旗標都是 false。
 * 日期只在恰好找到兩個同格式、合理範圍內的日期時才改寫（較早者為開始日）。
 */
export function rewriteCathayTransferQuery(
  postData: string,
  options: {
    fromAccount: string;
    toAccount: string;
    fromCurrency?: string;
    toCurrency?: string;
    lookbackDays: number;
    now?: Date;
  },
): CathayTransferQueryRewrite {
  let parsed: Json;
  try {
    parsed = JSON.parse(postData) as Json;
  } catch {
    return {
      body: postData,
      accountReplaced: false,
      accountKeys: [],
      datesExtended: false,
    };
  }
  const leaves = stringLeaves(parsed);

  const accountKeys: string[] = [];
  for (const leaf of leaves) {
    const value = read(leaf);
    if (isAccountValue(value, options.fromAccount)) {
      write(
        leaf,
        options.toAccount.length <= value.length
          ? options.toAccount.padStart(value.length, "0")
          : options.toAccount,
      );
      accountKeys.push(String(leaf.key).slice(0, 40));
    } else if (
      options.fromCurrency &&
      options.toCurrency &&
      options.fromCurrency !== options.toCurrency &&
      value === options.fromCurrency &&
      // 只換幣別欄位，避免把其他剛好等於幣別代碼的值也換掉。
      /cur|ccy/i.test(String(leaf.key))
    ) {
      write(leaf, options.toCurrency);
    }
  }

  const now = options.now ?? new Date();
  const earliest = now.getTime() - 3 * 366 * 86_400_000;
  const latest = now.getTime() + 86_400_000;
  const dates = leaves
    .map((leaf) => {
      const value = read(leaf);
      const format = dateFormatOf(value);
      const date = format?.parse(value);
      return format &&
        date &&
        date.getTime() >= earliest &&
        date.getTime() <= latest
        ? { leaf, format, date }
        : undefined;
    })
    .filter((entry) => entry !== undefined);
  let datesExtended = false;
  if (dates.length === 2) {
    const [start, end] =
      dates[0]!.date <= dates[1]!.date
        ? [dates[0]!, dates[1]!]
        : [dates[1]!, dates[0]!];
    // 必須同格式、至少差一天，且結束日在最近 3 天內，才視為查詢的開始／結束日。
    const sameFormat = read(start.leaf).length === read(end.leaf).length;
    const spansDays = end.date.getTime() - start.date.getTime() >= 86_400_000;
    const endsRecently = now.getTime() - end.date.getTime() <= 3 * 86_400_000;
    if (sameFormat && spansDays && endsRecently) {
      const wanted = new Date(
        end.date.getTime() - options.lookbackDays * 86_400_000,
      );
      if (wanted < start.date) write(start.leaf, start.format.format(wanted));
      datesExtended = true;
    }
  }

  return {
    body: JSON.stringify(parsed),
    accountReplaced: accountKeys.length > 0,
    accountKeys,
    datesExtended,
  };
}

/**
 * 診斷用：只回傳欄位名稱與值的形狀（例如 `digits16`、`date8`、`alpha3`），不含任何值。
 */
export function describeCathayTransferQuery(postData: string | undefined) {
  if (!postData) return { parsed: false as const };
  let parsed: Json;
  try {
    parsed = JSON.parse(postData) as Json;
  } catch {
    return { parsed: false as const, length: postData.length };
  }
  const shapeOf = (value: Json): unknown => {
    if (value === null) return "null";
    if (Array.isArray(value)) return value.slice(0, 3).map(shapeOf);
    if (typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value)
          .slice(0, 30)
          .map(([key, item]) => [key.slice(0, 40), shapeOf(item)]),
      );
    }
    if (typeof value !== "string") return typeof value;
    if (dateFormatOf(value)) return `date${value.length}`;
    if (/^\d+$/.test(value)) return `digits${value.length}`;
    if (/^[A-Za-z]+$/.test(value)) return `alpha${value.length}`;
    return `text${value.length}`;
  };
  return { parsed: true as const, shape: shapeOf(parsed) };
}

/** 重送時不帶瀏覽器自管或可識別的標頭。 */
export function replayableHeaders(headers: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(headers).filter(
      ([name]) =>
        !name.startsWith(":") &&
        !/^(cookie|host|content-length|origin|referer|user-agent|accept-encoding|connection)$/i.test(
          name,
        ) &&
        !/^sec-/i.test(name),
    ),
  );
}

export type CathayReplayResponse = {
  status: number;
  url: string;
  redirected: boolean;
  contentType: string;
  text: string;
};

/** 頁面內：以頁面自己的 cookie 重送查詢。puppeteer 會序列化，必須自給自足。 */
export async function cathayReplayInPage(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string,
): Promise<CathayReplayResponse> {
  const response = await fetch(url, {
    method,
    headers,
    body,
    credentials: "include",
  });
  return {
    status: response.status,
    url: response.url,
    redirected: response.redirected,
    contentType: response.headers.get("content-type") ?? "",
    text: await response.text(),
  };
}

type TransferData = { accountNumber?: string; details?: unknown[] };

/**
 * 判讀重送結果：
 * - logged-out：被導向登出／登入頁或 401／403，代表工作階段已結束，呼叫端應整次失敗。
 * - ok：每筆資料都屬於目標帳戶；沒有資料時，回應內容必須出現目標帳號才算可驗證。
 * - failed／mismatch／unverified：不可採用，呼叫端降級並停止後續重送（failed）。
 */
export function classifyCathayReplay(
  replay: CathayReplayResponse | null,
  account: string,
):
  | { kind: "ok"; datas: TransferData[] }
  | { kind: "logged-out" }
  | { kind: "failed" | "mismatch" | "unverified"; reason: string } {
  if (!replay) return { kind: "failed", reason: "no-response" };
  if (
    replay.status === 401 ||
    replay.status === 403 ||
    /\/(logout|login|mybank)\b/i.test(replay.redirected ? replay.url : "") ||
    /\/logout\//i.test(replay.url)
  ) {
    return { kind: "logged-out" };
  }
  if (replay.status !== 200) {
    return { kind: "failed", reason: `status-${replay.status}` };
  }
  let parsed: { content?: { datas?: TransferData[] } | null } | null;
  try {
    parsed = JSON.parse(replay.text);
  } catch {
    return { kind: "failed", reason: "not-json" };
  }
  const datas = parsed?.content?.datas;
  if (!Array.isArray(datas)) return { kind: "failed", reason: "no-datas" };
  const belongs = (accountNumber: string | undefined) => {
    const digits = (accountNumber ?? "").replace(/\D/g, "");
    return (
      digits.endsWith(account) && /^0*$/.test(digits.slice(0, -account.length))
    );
  };
  if (datas.length === 0) {
    // 空結果無法用 accountNumber 證明屬於目標帳戶，要求回應內容出現該帳號。
    return replay.text.includes(account)
      ? { kind: "ok", datas }
      : { kind: "unverified", reason: "empty-without-account" };
  }
  return datas.every((data) => belongs(data.accountNumber))
    ? { kind: "ok", datas }
    : { kind: "mismatch", reason: "account-mismatch" };
}
