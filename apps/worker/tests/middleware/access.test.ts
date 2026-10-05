import { Buffer } from "node:buffer";
import { Hono } from "hono";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  accessMiddleware,
  isLocalDevRequest,
} from "../../src/middleware/access";
import type { AppBindings, Env } from "../../src/platform/env";

const issuer = "https://test-access.cloudflareaccess.com";
const audience = "synthetic-application";
const env = {
  TEAM_DOMAIN: issuer,
  POLICY_AUD: audience,
  LOCAL_DEV_MODE: "true",
} as Env;
let keys: CryptoKeyPair;
let jwk: JsonWebKey;

beforeAll(async () => {
  keys = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  jwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
});
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ keys: [{ ...jwk, kid: "test-key" }] })),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function token(state: string) {
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", kid: "test-key" }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: issuer,
      aud: state === "wrong-audience" ? "other-application" : audience,
      exp: Math.floor(Date.now() / 1000) + (state === "expired" ? -60 : 3600),
    }),
  ).toString("base64url");
  const data = `${header}.${payload}`;
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      keys.privateKey,
      new TextEncoder().encode(data),
    ),
  );
  if (state === "forged") signature[0] = signature[0]! ^ 1;
  return `${data}.${Buffer.from(signature).toString("base64url")}`;
}

function app() {
  const mutation = vi.fn();
  const api = new Hono<AppBindings>();
  api.use("*", accessMiddleware);
  api.post("/resource", (c) => {
    mutation();
    return c.json({ updated: true });
  });
  return { api, mutation };
}

describe("外部請求的授權邊界", () => {
  it.each(["valid", "missing", "expired", "wrong-audience", "forged"])(
    "%s JWT 僅在授權有效時執行寫入",
    async (state) => {
      const { api, mutation } = app();
      const response = await api.request(
        "https://example.com/resource",
        {
          method: "POST",
          headers:
            state === "missing"
              ? {}
              : { "Cf-Access-Jwt-Assertion": await token(state) },
        },
        env,
      );
      expect(response.status).toBe(state === "valid" ? 200 : 401);
      expect(mutation).toHaveBeenCalledTimes(state === "valid" ? 1 : 0);
      if (state !== "valid")
        expect(await response.json()).toMatchObject({
          error: { code: "UNAUTHORIZED" },
        });
    },
  );

  it("本機跳過登入必須明確啟用", async () => {
    const { api, mutation } = app();
    expect(
      (
        await api.request(
          "http://localhost/resource",
          { method: "POST" },
          { ...env, LOCAL_DEV_MODE: "false" },
        )
      ).status,
    ).toBe(401);
    expect(mutation).not.toHaveBeenCalled();
    expect(
      (await api.request("http://localhost/resource", { method: "POST" }, env))
        .status,
    ).toBe(200);
    expect(mutation).toHaveBeenCalledTimes(1);
  });
});

// 正式環境以本機模式經 Cloudflare Tunnel 對外：轉送進來的請求絕不可跳過 Access。
describe("本機模式與 Cloudflare 轉送", () => {
  const localEnv = { LOCAL_DEV_MODE: "true" } as Env;

  it("只有本機位址可以跳過 Access", () => {
    expect(
      isLocalDevRequest(new Request("https://example.com"), localEnv),
    ).toBe(false);
    expect(isLocalDevRequest(new Request("http://127.0.0.1"), localEnv)).toBe(
      true,
    );
    expect(isLocalDevRequest(new Request("http://[::1]"), localEnv)).toBe(true);
  });

  it("經 Cloudflare 轉送的請求絕不跳過 Access", () => {
    const request = (headers: Record<string, string>) =>
      new Request("http://localhost:8797/api/bank", { headers });
    expect(isLocalDevRequest(request({ "cf-ray": "x" }), localEnv)).toBe(false);
    // Tunnel 實際送達本機時的組合：cf-ray 加上 loopback 的連線 IP。
    expect(
      isLocalDevRequest(
        request({ "cf-ray": "x", "cf-connecting-ip": "127.0.0.1" }),
        localEnv,
      ),
    ).toBe(false);
    expect(
      isLocalDevRequest(
        request({ "cf-connecting-ip": "203.0.113.7" }),
        localEnv,
      ),
    ).toBe(false);
  });

  it("Miniflare 的 loopback CF-Connecting-IP 仍視為本機", () => {
    for (const ip of ["127.0.0.1", "::1", "::ffff:127.0.0.1"])
      expect(
        isLocalDevRequest(
          new Request("http://localhost:8797/api/bank", {
            headers: { "cf-connecting-ip": ip },
          }),
          localEnv,
        ),
      ).toBe(true);
  });
});
