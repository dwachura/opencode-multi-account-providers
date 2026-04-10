import { describe, test, expect, beforeEach, mock } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import * as storage from "../src/storage"
import * as rotation from "../src/rotation"
import plugin from "../src/index"

// ── Test setup ──

let testDir: string
let authSetCalls: Array<{ path: { id: string }; body: any }>
let toastCalls: Array<{ variant: string; message: string; title?: string }>
let mockClient: any

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "multi-account-plugin-test-"))
  storage.configure(testDir)
  authSetCalls = []
  toastCalls = []
  mockClient = {
    auth: {
      set: mock(async (args: any) => {
        authSetCalls.push(args)
      }),
    },
    app: {
      log: mock(async () => {}),
    },
    tui: {
      showToast: mock(async (args: { body: { variant: string; message: string; title?: string } }) => {
        toastCalls.push(args.body)
      }),
    },
  }
})

// ── Helpers ──

async function createHooks(provider: string) {
  return plugin.server!({ client: mockClient } as any, { provider })
}

async function waitFor(check: () => boolean, timeoutMs = 1500) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error("Timed out waiting for condition")
}

function makeOpenAiJwt(claims: { chatgptId?: string; sub?: string; openaiEmail?: string; email?: string }): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url")
  const payload: Record<string, unknown> = { iat: 1234567890 }
  if (claims.chatgptId) {
    payload["https://api.openai.com/auth"] = { chatgpt_account_user_id: claims.chatgptId }
  }
  if (claims.sub) {
    payload.sub = claims.sub
  }
  if (claims.openaiEmail) {
    payload["https://api.openai.com/profile"] = { email: claims.openaiEmail }
  }
  if (claims.email) {
    payload.email = claims.email
  }
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url")
  return `${header}.${payloadB64}.fake-signature`
}

const oauthA: storage.OAuthAccount = {
  id: "user_a",
  label: "openai",
  type: "oauth",
  access: "access-a",
  refresh: "refresh-a",
  expires: Date.now() + 3600_000,
  accountId: "acct_a",
}

const oauthB: storage.OAuthAccount = {
  id: "user_b",
  label: "openai",
  type: "oauth",
  access: "access-b",
  refresh: "refresh-b",
  expires: Date.now() + 3600_000,
  accountId: "acct_b",
}

function chatParamsInput(sessionID: string, providerID: string) {
  return {
    sessionID,
    model: { providerID } as any,
    agent: {} as any,
    provider: {} as any,
    message: {} as any,
  }
}

async function runChatParams(hooks: Awaited<ReturnType<typeof createHooks>>, sessionID: string, providerID: string) {
  await hooks["chat.params"]!(chatParamsInput(sessionID, providerID), {
    temperature: 0,
    topP: 1,
    topK: 0,
    maxOutputTokens: undefined,
    options: {},
  })
}

// ── Plugin identity ──

describe("plugin module", () => {
  test("has correct id", () => {
    expect(plugin.id).toBe("opencode-multi-account-providers")
  })

  test("server returns hooks", async () => {
    const hooks = await createHooks("openai")
    expect(hooks["chat.params"]).toBeDefined()
    expect(hooks.event).toBeDefined()
  })

  test("server throws when provider option is missing", async () => {
    await expect(plugin.server!({ client: mockClient } as any, undefined)).rejects.toThrow(/provider/)
  })
})

// ── chat.params: auto-detection ──

describe("chat.params — auto-detection", () => {
  test("extracts id and label from ChatGPT-specific claims", async () => {
    const jwt = makeOpenAiJwt({ chatgptId: "user_abc", openaiEmail: "alice@example.com" })
    writeFileSync(
      join(testDir, "auth.json"),
      JSON.stringify({
        openai: {
          type: "oauth",
          refresh: "r1",
          access: jwt,
          expires: 9999999999999,
        },
      }),
    )

    const hooks = await createHooks("openai")
    await runChatParams(hooks, "s1", "openai")

    const data = storage.read("openai")
    expect(data!.accounts).toHaveLength(1)
    const account = data!.accounts[0] as storage.OAuthAccount
    expect(account.id).toBe("user_abc")
    expect(account.label).toBe("alice@example.com")
  })

  test("falls back to JWT sub and email claims when ChatGPT claims missing", async () => {
    const jwt = makeOpenAiJwt({ sub: "auth0|xyz", email: "bob@example.com" })
    writeFileSync(
      join(testDir, "auth.json"),
      JSON.stringify({
        openai: {
          type: "oauth",
          refresh: "r1",
          access: jwt,
          expires: 9999999999999,
        },
      }),
    )

    const hooks = await createHooks("openai")
    await runChatParams(hooks, "s1", "openai")

    const account = storage.read("openai")!.accounts[0] as storage.OAuthAccount
    expect(account.id).toBe("auth0|xyz")
    expect(account.label).toBe("bob@example.com")
  })

  test("uses provider id as label when no email claim is present", async () => {
    const jwt = makeOpenAiJwt({ chatgptId: "user_no_email" })
    writeFileSync(
      join(testDir, "auth.json"),
      JSON.stringify({
        openai: {
          type: "oauth",
          refresh: "r1",
          access: jwt,
          expires: 9999999999999,
        },
      }),
    )

    const hooks = await createHooks("openai")
    await runChatParams(hooks, "s1", "openai")

    const account = storage.read("openai")!.accounts[0] as storage.OAuthAccount
    expect(account.label).toBe("openai")
  })

  test("refuses to add account when access token is not a JWT", async () => {
    writeFileSync(
      join(testDir, "auth.json"),
      JSON.stringify({
        openai: {
          type: "oauth",
          refresh: "r1",
          access: "not-a-jwt",
          expires: 9999999999999,
          accountId: "acct_fallback",
        },
      }),
    )

    const hooks = await createHooks("openai")
    await runChatParams(hooks, "s1", "openai")

    expect(storage.read("openai")).toBeUndefined()
  })

  test("refuses to add account when JWT has no usable identity claims", async () => {
    const jwt = makeOpenAiJwt({}) // no chatgptId, no sub
    writeFileSync(
      join(testDir, "auth.json"),
      JSON.stringify({
        openai: {
          type: "oauth",
          refresh: "r1",
          access: jwt,
          expires: 9999999999999,
        },
      }),
    )

    const hooks = await createHooks("openai")
    await runChatParams(hooks, "s1", "openai")

    expect(storage.read("openai")).toBeUndefined()
  })

  test("ignores api key accounts from auth.json", async () => {
    writeFileSync(
      join(testDir, "auth.json"),
      JSON.stringify({
        openai: { type: "api", key: "sk-test" },
      }),
    )

    const hooks = await createHooks("openai")
    await runChatParams(hooks, "s1", "openai")

    // Should not store API key accounts
    expect(storage.read("openai")).toBeUndefined()
  })

  test("ignores unmanaged providers", async () => {
    writeFileSync(
      join(testDir, "auth.json"),
      JSON.stringify({
        anthropic: {
          type: "oauth",
          refresh: "r",
          access: "a",
          expires: 9999999999999,
        },
      }),
    )

    const hooks = await createHooks("openai")
    await runChatParams(hooks, "s1", "anthropic")

    expect(storage.read("anthropic")).toBeUndefined()
  })

})

describe("auth.json watcher", () => {
  test("multiple plugin instances can watch the same auth.json", async () => {
    await createHooks("openai")
    await createHooks("fake")
    await new Promise((resolve) => setTimeout(resolve, 50))

    const jwt = makeOpenAiJwt({ chatgptId: "user_multi", openaiEmail: "multi@example.com" })
    writeFileSync(
      join(testDir, "auth.json"),
      JSON.stringify({
        openai: {
          type: "oauth",
          refresh: "r-openai",
          access: jwt,
          expires: 9999999999999,
        },
        fake: {
          type: "oauth",
          refresh: "r-fake",
          access: "fake-access-token",
          expires: 9999999999999,
        },
      }),
    )

    await waitFor(() => {
      const openai = storage.read("openai")
      const fake = storage.read("fake")
      return openai?.accounts.length === 1 && fake?.accounts.length === 1
    })

    expect((storage.read("openai")!.accounts[0] as storage.OAuthAccount).id).toBe("user_multi")
    const fakeAccount = storage.read("fake")!.accounts[0] as storage.OAuthAccount
    expect(fakeAccount.id).toBe("fake-access-token")
    expect(fakeAccount.label).toBe("fake-access-token")
  })

  test("watcher retries until auth directory exists", async () => {
    const delayedDir = join(testDir, "missing-parent", "opencode")
    storage.configure(delayedDir)

    await createHooks("openai")

    await new Promise((resolve) => setTimeout(resolve, 50))
    mkdirSync(delayedDir, { recursive: true })

    const jwt = makeOpenAiJwt({ chatgptId: "user_delayed", openaiEmail: "delayed@example.com" })
    writeFileSync(
      join(delayedDir, "auth.json"),
      JSON.stringify({
        openai: {
          type: "oauth",
          refresh: "r-delayed",
          access: jwt,
          expires: 9999999999999,
        },
      }),
    )

    await waitFor(() => storage.read("openai")?.accounts.length === 1)

    const account = storage.read("openai")!.accounts[0] as storage.OAuthAccount
    expect(account.id).toBe("user_delayed")
    expect(account.label).toBe("delayed@example.com")
  })
})

// ── chat.params: rotation ──

describe("chat.params — rotation", () => {
  test("rotates to next account when flagged", async () => {
    storage.add("openai", oauthA)
    storage.add("openai", oauthB)
    storage.activate("openai", 0)

    const hooks = await createHooks("openai")

    rotation.track("s1", "openai")
    rotation.flag("s1")

    await runChatParams(hooks, "s1", "openai")

    expect(authSetCalls).toHaveLength(1)
    expect(authSetCalls[0].path.id).toBe("openai")
    expect(authSetCalls[0].body.type).toBe("oauth")
    expect(authSetCalls[0].body.refresh).toBe("refresh-b")
    expect(storage.read("openai")!.active).toBe(1)
  })

  test("no-op when all accounts exhausted", async () => {
    storage.add("openai", oauthA)
    storage.add("openai", oauthB)
    storage.exhaust("openai", 0)
    storage.exhaust("openai", 1)

    const hooks = await createHooks("openai")
    rotation.track("s3", "openai")
    rotation.flag("s3")

    await runChatParams(hooks, "s3", "openai")

    expect(authSetCalls).toHaveLength(0)
  })

  test("includes accountId and enterpriseUrl in rotation", async () => {
    const withEnterprise: storage.OAuthAccount = {
      ...oauthB,
      enterpriseUrl: "https://ent.example.com",
    }
    storage.add("openai", oauthA)
    storage.add("openai", withEnterprise)
    storage.activate("openai", 0)

    const hooks = await createHooks("openai")
    rotation.track("s4", "openai")
    rotation.flag("s4")

    await runChatParams(hooks, "s4", "openai")

    expect(authSetCalls[0].body.accountId).toBe("acct_b")
    expect(authSetCalls[0].body.enterpriseUrl).toBe("https://ent.example.com")
  })
})

// ── event: rate limit detection ──

describe("event — rate limit detection", () => {
  function retryEvent(sessionID: string, message: string) {
    return {
      event: {
        type: "session.status" as const,
        properties: {
          sessionID,
          status: { type: "retry" as const, attempt: 1, message, next: 2000 },
        },
      },
    }
  }

  test("flags rotation on 'Rate Limited'", async () => {
    storage.add("openai", oauthA)
    storage.add("openai", oauthB)
    storage.activate("openai", 0)

    const hooks = await createHooks("openai")
    rotation.track("s10", "openai")
    rotation.trackAccount("s10", 0)

    await hooks.event!(retryEvent("s10", "Rate Limited"))

    expect(storage.read("openai")!.exhausted).toContain(0)
    expect(rotation.consume("s10")).toBe(true)
  })

  test("flags rotation on 'Too Many Requests'", async () => {
    storage.add("openai", oauthA)
    storage.activate("openai", 0)

    const hooks = await createHooks("openai")
    rotation.track("s11", "openai")
    rotation.trackAccount("s11", 0)

    await hooks.event!(retryEvent("s11", "Too Many Requests"))
    expect(rotation.consume("s11")).toBe(true)
  })

  test("flags rotation on case-insensitive rate limit message", async () => {
    storage.add("openai", oauthA)
    storage.activate("openai", 0)

    const hooks = await createHooks("openai")
    rotation.track("s12", "openai")
    rotation.trackAccount("s12", 0)

    await hooks.event!(retryEvent("s12", "You have been rate limited"))
    expect(rotation.consume("s12")).toBe(true)
  })

  test("flags rotation on usage limit message", async () => {
    storage.add("openai", oauthA)
    storage.activate("openai", 0)

    const hooks = await createHooks("openai")
    rotation.track("s12b", "openai")
    rotation.trackAccount("s12b", 0)

    await hooks.event!(retryEvent("s12b", "The usage limit has been reached"))
    expect(rotation.consume("s12b")).toBe(true)
  })

  test("ignores non-rate-limit retry messages", async () => {
    storage.add("openai", oauthA)
    storage.activate("openai", 0)

    const hooks = await createHooks("openai")
    rotation.track("s13", "openai")
    rotation.trackAccount("s13", 0)

    await hooks.event!(retryEvent("s13", "Provider is overloaded"))
    expect(rotation.consume("s13")).toBe(false)
  })

  test("ignores unmanaged providers", async () => {
    storage.add("anthropic", oauthA)
    storage.activate("anthropic", 0)

    const hooks = await createHooks("openai")
    rotation.track("s14", "anthropic")
    rotation.trackAccount("s14", 0)

    await hooks.event!(retryEvent("s14", "Rate Limited"))
    expect(rotation.consume("s14")).toBe(false)
  })

  test("does not exhaust wrong account after rotation", async () => {
    storage.add("openai", oauthA)
    storage.add("openai", oauthB)
    storage.activate("openai", 1) // active is B

    const hooks = await createHooks("openai")
    rotation.track("s15", "openai")
    rotation.trackAccount("s15", 0) // but A was the account used

    await hooks.event!(retryEvent("s15", "Rate Limited"))

    expect(storage.read("openai")!.exhausted).toContain(0)
    expect(storage.read("openai")!.exhausted).not.toContain(1)
  })

  test("suppresses rate-limit warning toast when no next account exists", async () => {
    storage.add("openai", oauthA)
    storage.activate("openai", 0)

    const hooks = await createHooks("openai")
    rotation.track("s16", "openai")
    rotation.trackAccount("s16", 0)

    await hooks.event!(retryEvent("s16", "Rate Limited"))

    expect(toastCalls.some((toast) => toast.variant === "warning")).toBe(false)
    expect(rotation.consume("s16")).toBe(true)
  })
})

// ── Full rotation flow ──

describe("end-to-end rotation flow", () => {
  test("detect → rate limit → rotate → verify", async () => {
    storage.add("openai", oauthA)
    storage.add("openai", oauthB)
    storage.activate("openai", 0)

    const hooks = await createHooks("openai")

    // Normal path — tracks session and account
    await runChatParams(hooks, "flow-1", "openai")
    expect(rotation.provider("flow-1")).toBe("openai")
    expect(rotation.usedAccount("flow-1")).toBe(0)

    // Rate limit event fires
    await hooks.event!({
      event: {
        type: "session.status",
        properties: {
          sessionID: "flow-1",
          status: { type: "retry", attempt: 1, message: "The usage limit has been reached", next: 2000 },
        },
      },
    })

    // Account 0 should be exhausted, rotation flagged
    expect(storage.read("openai")!.exhausted).toContain(0)

    // Next chat.params call consumes flag and rotates
    await runChatParams(hooks, "flow-1", "openai")

    expect(authSetCalls).toHaveLength(1)
    expect(authSetCalls[0].body.refresh).toBe("refresh-b")
    expect(storage.read("openai")!.active).toBe(1)
  })

  test("shows terminal error toast when all accounts are exhausted", async () => {
    storage.add("openai", oauthA)
    storage.activate("openai", 0)

    const hooks = await createHooks("openai")
    await runChatParams(hooks, "flow-2", "openai")

    await hooks.event!({
      event: {
        type: "session.status",
        properties: {
          sessionID: "flow-2",
          status: { type: "retry", attempt: 1, message: "The usage limit has been reached", next: 2000 },
        },
      },
    })

    await runChatParams(hooks, "flow-2", "openai")

    expect(toastCalls.some((toast) => toast.variant === "warning")).toBe(false)
    expect(
      toastCalls.some(
        (toast) => toast.variant === "error" && toast.message === 'All accounts for "openai" are rate-limited',
      ),
    ).toBe(true)
  })
})
