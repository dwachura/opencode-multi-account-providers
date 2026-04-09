import { describe, test, expect, beforeEach, mock } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import * as storage from "../src/storage"
import * as rotation from "../src/rotation"
import plugin from "../src/index"

// ── Test setup ──

let testDir: string
let authSetCalls: Array<{ path: { id: string }; body: any }>
let mockClient: any

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "multi-account-plugin-test-"))
  storage.configure(testDir)
  authSetCalls = []
  mockClient = {
    auth: {
      set: mock(async (args: any) => {
        authSetCalls.push(args)
      }),
    },
    app: {
      log: mock(async () => {}),
    },
  }
})

// ── Helpers ──

async function createHooks(providers?: string[]) {
  const opts = providers ? { providers } : undefined
  return plugin.server!({ client: mockClient } as any, opts)
}

const oauthA: storage.OAuthAccount = {
  label: "openai",
  type: "oauth",
  access: "access-a",
  refresh: "refresh-a",
  expires: Date.now() + 3600_000,
  accountId: "acct_a",
}

const oauthB: storage.OAuthAccount = {
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

// ── Plugin identity ──

describe("plugin module", () => {
  test("has correct id", () => {
    expect(plugin.id).toBe("opencode-multi-account-providers")
  })

  test("server returns hooks", async () => {
    const hooks = await createHooks()
    expect(hooks["chat.params"]).toBeDefined()
    expect(hooks.event).toBeDefined()
  })
})

// ── chat.params: auto-detection ──

describe("chat.params — auto-detection", () => {
  test("detects oauth account from auth.json", async () => {
    writeFileSync(
      join(testDir, "auth.json"),
      JSON.stringify({
        openai: {
          type: "oauth",
          refresh: "r1",
          access: "a1",
          expires: 9999999999999,
          accountId: "acct_1",
        },
      }),
    )

    const hooks = await createHooks(["openai"])
    await hooks["chat.params"]!(chatParamsInput("s1", "openai"))

    const data = storage.read("openai")
    expect(data).toBeDefined()
    expect(data!.accounts).toHaveLength(1)
    expect(data!.accounts[0].type).toBe("oauth")
  })

  test("ignores api key accounts from auth.json", async () => {
    writeFileSync(
      join(testDir, "auth.json"),
      JSON.stringify({
        openai: { type: "api", key: "sk-test" },
      }),
    )

    const hooks = await createHooks(["openai"])
    await hooks["chat.params"]!(chatParamsInput("s1", "openai"))

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

    const hooks = await createHooks(["openai"])
    await hooks["chat.params"]!(chatParamsInput("s1", "anthropic"))

    expect(storage.read("anthropic")).toBeUndefined()
  })

  test("defaults to openai when no providers configured", async () => {
    writeFileSync(
      join(testDir, "auth.json"),
      JSON.stringify({
        openai: {
          type: "oauth",
          refresh: "r",
          access: "a",
          expires: 9999999999999,
        },
      }),
    )

    const hooks = await createHooks() // no providers option
    await hooks["chat.params"]!(chatParamsInput("s1", "openai"))

    expect(storage.read("openai")).toBeDefined()
  })
})

// ── chat.params: rotation ──

describe("chat.params — rotation", () => {
  test("rotates to next account when flagged", async () => {
    storage.add("openai", oauthA)
    storage.add("openai", oauthB)
    storage.activate("openai", 0)

    const hooks = await createHooks(["openai"])

    rotation.track("s1", "openai")
    rotation.flag("s1")

    await hooks["chat.params"]!(chatParamsInput("s1", "openai"))

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

    const hooks = await createHooks(["openai"])
    rotation.track("s3", "openai")
    rotation.flag("s3")

    await hooks["chat.params"]!(chatParamsInput("s3", "openai"))

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

    const hooks = await createHooks(["openai"])
    rotation.track("s4", "openai")
    rotation.flag("s4")

    await hooks["chat.params"]!(chatParamsInput("s4", "openai"))

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

    const hooks = await createHooks(["openai"])
    rotation.track("s10", "openai")
    rotation.trackAccount("s10", 0)

    await hooks.event!(retryEvent("s10", "Rate Limited"))

    expect(storage.read("openai")!.exhausted).toContain(0)
    expect(rotation.consume("s10")).toBe(true)
  })

  test("flags rotation on 'Too Many Requests'", async () => {
    storage.add("openai", oauthA)
    storage.activate("openai", 0)

    const hooks = await createHooks(["openai"])
    rotation.track("s11", "openai")
    rotation.trackAccount("s11", 0)

    await hooks.event!(retryEvent("s11", "Too Many Requests"))
    expect(rotation.consume("s11")).toBe(true)
  })

  test("flags rotation on case-insensitive rate limit message", async () => {
    storage.add("openai", oauthA)
    storage.activate("openai", 0)

    const hooks = await createHooks(["openai"])
    rotation.track("s12", "openai")
    rotation.trackAccount("s12", 0)

    await hooks.event!(retryEvent("s12", "You have been rate limited"))
    expect(rotation.consume("s12")).toBe(true)
  })

  test("ignores non-rate-limit retry messages", async () => {
    storage.add("openai", oauthA)
    storage.activate("openai", 0)

    const hooks = await createHooks(["openai"])
    rotation.track("s13", "openai")
    rotation.trackAccount("s13", 0)

    await hooks.event!(retryEvent("s13", "Provider is overloaded"))
    expect(rotation.consume("s13")).toBe(false)
  })

  test("ignores unmanaged providers", async () => {
    storage.add("anthropic", oauthA)
    storage.activate("anthropic", 0)

    const hooks = await createHooks(["openai"])
    rotation.track("s14", "anthropic")
    rotation.trackAccount("s14", 0)

    await hooks.event!(retryEvent("s14", "Rate Limited"))
    expect(rotation.consume("s14")).toBe(false)
  })

  test("does not exhaust wrong account after rotation", async () => {
    storage.add("openai", oauthA)
    storage.add("openai", oauthB)
    storage.activate("openai", 1) // active is B

    const hooks = await createHooks(["openai"])
    rotation.track("s15", "openai")
    rotation.trackAccount("s15", 0) // but A was the account used

    await hooks.event!(retryEvent("s15", "Rate Limited"))

    expect(storage.read("openai")!.exhausted).toContain(0)
    expect(storage.read("openai")!.exhausted).not.toContain(1)
  })
})

// ── event: session.created ──

describe("event — session.created", () => {
  test("resets exhaustion on new session", async () => {
    storage.add("openai", oauthA)
    storage.add("openai", oauthB)
    storage.exhaust("openai", 0)
    storage.exhaust("openai", 1)

    const hooks = await createHooks(["openai"])

    await hooks.event!({
      event: {
        type: "session.created" as const,
        properties: { info: {} as any },
      },
    })

    expect(storage.read("openai")!.exhausted).toEqual([])
  })
})

// ── Full rotation flow ──

describe("end-to-end rotation flow", () => {
  test("detect → rate limit → rotate → verify", async () => {
    storage.add("openai", oauthA)
    storage.add("openai", oauthB)
    storage.activate("openai", 0)

    const hooks = await createHooks(["openai"])

    // Normal path — tracks session and account
    await hooks["chat.params"]!(chatParamsInput("flow-1", "openai"))
    expect(rotation.provider("flow-1")).toBe("openai")
    expect(rotation.usedAccount("flow-1")).toBe(0)

    // Rate limit event fires
    await hooks.event!({
      event: {
        type: "session.status",
        properties: {
          sessionID: "flow-1",
          status: { type: "retry", attempt: 1, message: "Rate Limited", next: 2000 },
        },
      },
    })

    // Account 0 should be exhausted, rotation flagged
    expect(storage.read("openai")!.exhausted).toContain(0)

    // Next chat.params call consumes flag and rotates
    await hooks["chat.params"]!(chatParamsInput("flow-1", "openai"))

    expect(authSetCalls).toHaveLength(1)
    expect(authSetCalls[0].body.refresh).toBe("refresh-b")
    expect(storage.read("openai")!.active).toBe(1)
  })
})
