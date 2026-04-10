import { describe, test, expect, beforeAll, afterAll, beforeEach, setDefaultTimeout } from "bun:test"
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { start } from "./fake-server/server"
import type { Server } from "bun"
import { createOpencodeClient, createOpencodeServer } from "@opencode-ai/sdk/v2"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import * as storage from "../../src/storage"

// Real opencode + fake server round-trips need generous timeouts
setDefaultTimeout(60_000)

// ── Paths ──

const PROJECT_ROOT = join(import.meta.dir, "..", "..")
const AUTH_PLUGIN_DIR = join(import.meta.dir, "auth-plugin")
const TEST_ENV = join(PROJECT_ROOT, ".test-env")
const DATA_DIR = join(TEST_ENV, "data", "opencode")
const CONFIG_DIR = join(TEST_ENV, "config")
const AUTH_JSON = join(DATA_DIR, "auth.json")

const PROVIDER_ID = "fake"
const MODEL_ID = "fake-model-v1"

// ── Infrastructure ──

let fakeServer: Server
let fakeBase: string
let opencode: Awaited<ReturnType<typeof createOpencodeServer>>
let client: OpencodeClient

beforeAll(async () => {
  rmSync(TEST_ENV, { recursive: true, force: true })
  mkdirSync(DATA_DIR, { recursive: true })
  mkdirSync(CONFIG_DIR, { recursive: true })

  // Start fake LLM server
  fakeServer = start(0)
  fakeBase = `http://localhost:${fakeServer.port}`

  // Configure opencode with:
  //   - "fake" custom provider pointing at our fake server
  //   - auth-plugin: test auth hook that re-reads auth.json per request (like Codex)
  //   - multi-account plugin: the plugin under test
  const config = {
    $schema: "https://opencode.ai/config.json",
    provider: {
      [PROVIDER_ID]: {
        npm: "@ai-sdk/openai",
        name: "Fake LLM",
        options: {
          baseURL: `${fakeBase}/v1`,
        },
        models: {
          [MODEL_ID]: {
            name: "Fake Model",
          },
        },
      },
    },
    plugin: [
      [AUTH_PLUGIN_DIR, {}],
      [PROJECT_ROOT, { provider: PROVIDER_ID }],
    ],
  }

  writeFileSync(join(CONFIG_DIR, "opencode.json"), JSON.stringify(config, null, 2))

  // Write initial OAuth auth.json
  const expires = Date.now() + 3600_000
  writeFileSync(AUTH_JSON, JSON.stringify({
    [PROVIDER_ID]: {
      type: "oauth",
      access: "access-a",
      refresh: "refresh-a",
      expires,
      accountId: "acct_alice",
    },
  }, null, 2), { mode: 0o600 })

  // Start opencode server
  process.env.XDG_DATA_HOME = join(TEST_ENV, "data")
  process.env.OPENCODE_CONFIG_DIR = CONFIG_DIR

  // Point the storage module at the test data dir so test helpers
  // share the same SQLite database the plugin will use
  storage.configure(DATA_DIR)

  opencode = await createOpencodeServer({
    port: 0,
    timeout: 15_000,
    config: {
      logLevel: "DEBUG",
    },
  })

  client = createOpencodeClient({ baseUrl: opencode.url })
}, 30_000)

afterAll(() => {
  opencode?.close()
  fakeServer?.stop(true)
  delete process.env.XDG_DATA_HOME
  delete process.env.OPENCODE_CONFIG_DIR
})

beforeEach(async () => {
  await fetch(`${fakeBase}/admin/reset`, { method: "POST" })
  await setServerLimits("user-a", 100)
  await setServerLimits("user-b", 100)
  await setServerLimits("user-c", 100)
})

// ── Helpers ──

function readAuthJsonEntry(): Record<string, unknown> | undefined {
  try {
    return JSON.parse(readFileSync(AUTH_JSON, "utf-8"))[PROVIDER_ID]
  } catch {
    return undefined
  }
}

function readMultiAuth(): storage.ProviderData | undefined {
  return storage.read(PROVIDER_ID)
}

async function setServerLimits(userId: string, reqLimit: number, tokLimit = 100_000) {
  await fetch(`${fakeBase}/admin/users/${userId}/limits`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ req_limit: reqLimit, tok_limit: tokLimit }),
  })
}

async function setServerTokens(userId: string, access: string, refresh: string, expires: number) {
  await fetch(`${fakeBase}/admin/users/${userId}/tokens`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ access_token: access, refresh_token: refresh, expires }),
  })
}

async function getServerUser(userId: string) {
  return (await fetch(`${fakeBase}/admin/users/${userId}`)).json() as Promise<Record<string, any>>
}

function writeOAuthAuth(access: string, refresh: string, expires: number, accountId?: string) {
  writeFileSync(AUTH_JSON, JSON.stringify({
    [PROVIDER_ID]: {
      type: "oauth",
      access, refresh, expires,
      ...(accountId && { accountId }),
    },
  }, null, 2), { mode: 0o600 })
}

function writeMultiAuth(accounts: storage.OAuthAccount[], active = 0, exhausted: number[] = []) {
  storage.write(PROVIDER_ID, { active, accounts, exhausted })
}

async function sendPrompt(sessionID: string, text: string) {
  return client.session.prompt({
    sessionID,
    parts: [{ type: "text", text }],
    model: { providerID: PROVIDER_ID, modelID: MODEL_ID },
  })
}

// ── Tests ──

describe("environment", () => {
  test("opencode server is reachable", async () => {
    const sessions = await client.session.list()
    expect(sessions.data).toBeDefined()
  })

  test("fake LLM server is reachable", async () => {
    const res = await fetch(`${fakeBase}/v1/models`)
    expect(res.status).toBe(200)
  })
})

describe("account auto-detection", () => {
  test("plugin detects oauth account from auth.json after first prompt", async () => {
    const expires = Date.now() + 3600_000
    await setServerTokens("user-a", "access-a", "refresh-a", expires)
    writeOAuthAuth("access-a", "refresh-a", expires, "acct_alice")

    // Clear any prior accounts for this provider
    storage.write(PROVIDER_ID, { active: 0, accounts: [], exhausted: [] })

    const session = await client.session.create()
    await sendPrompt(session.data!.id, "hello")

    const data = readMultiAuth()
    expect(data).toBeDefined()
    expect(data!.accounts.length).toBeGreaterThanOrEqual(1)
    expect(data!.accounts[0].type).toBe("oauth")
  })
})

describe("oauth rotation on rate limit", () => {
  test("rotates to second oauth account after rate limit", async () => {
    const expires = Date.now() + 3600_000

    await setServerTokens("user-a", "oa-alice", "or-alice", expires)
    await setServerTokens("user-b", "oa-bob", "or-bob", expires)

    writeMultiAuth([
      {
        id: "oa-alice",
        label: PROVIDER_ID,
        type: "oauth",
        access: "oa-alice",
        refresh: "or-alice",
        expires,
        accountId: "acct_alice",
      },
      {
        id: "oa-bob",
        label: PROVIDER_ID,
        type: "oauth",
        access: "oa-bob",
        refresh: "or-bob",
        expires,
        accountId: "acct_bob",
      },
    ])

    writeOAuthAuth("oa-alice", "or-alice", expires, "acct_alice")

    // Alice gets small limit
    await setServerLimits("user-a", 2)

    const session = await client.session.create()
    const sessionID = session.data!.id

    // First prompt — should succeed with Alice
    await sendPrompt(sessionID, "first message")

    // Second prompt — should hit rate limit on Alice, rotate to Bob
    await sendPrompt(sessionID, "second message")

    // Verify Bob was used
    const bob = await getServerUser("user-b")
    expect(bob.req_used).toBeGreaterThanOrEqual(1)

    // Verify auth.json was updated to Bob
    const entry = readAuthJsonEntry()
    expect(entry?.type).toBe("oauth")
    expect(entry?.access).toBe("oa-bob")

    // Verify multi-auth shows rotation
    const multiAuth = readMultiAuth()!
    expect(multiAuth.exhausted).toContain(0)
    expect(multiAuth.active).toBe(1)
  })
})

describe("single account passthrough", () => {
  test("works with single oauth account, no rotation", async () => {
    const expires = Date.now() + 3600_000
    await setServerTokens("user-a", "oa-single", "or-single", expires)

    writeMultiAuth([
      {
        id: "oa-single",
        label: PROVIDER_ID,
        type: "oauth",
        access: "oa-single",
        refresh: "or-single",
        expires,
        accountId: "acct_a",
      },
    ])

    writeOAuthAuth("oa-single", "or-single", expires, "acct_a")

    const session = await client.session.create()
    await sendPrompt(session.data!.id, "single account test")

    const userA = await getServerUser("user-a")
    expect(userA.req_used).toBeGreaterThanOrEqual(1)

    const entry = readAuthJsonEntry()
    expect(entry?.access).toBe("oa-single")
  })
})

describe("auth.json file watcher", () => {
  test("captures a new account when auth.json is rewritten", async () => {
    // Start with no accounts in storage
    storage.write(PROVIDER_ID, { active: 0, accounts: [], exhausted: [] })

    const expires = Date.now() + 3600_000
    await setServerTokens("user-a", "watcher-token-1", "watcher-refresh-1", expires)

    // Simulate `opencode auth login` writing fresh credentials to auth.json
    writeOAuthAuth("watcher-token-1", "watcher-refresh-1", expires, "acct_watcher")

    // Wait for the watcher to debounce + fire (50ms debounce + filesystem latency)
    await new Promise((r) => setTimeout(r, 300))

    const data = readMultiAuth()
    expect(data).toBeDefined()
    expect(data!.accounts).toHaveLength(1)
    const account = data!.accounts[0] as storage.OAuthAccount
    expect(account.access).toBe("watcher-token-1")
    expect(account.id).toBe("watcher-token-1") // default extractor uses access token
  })

  test("does not duplicate when same account is written again", async () => {
    storage.write(PROVIDER_ID, { active: 0, accounts: [], exhausted: [] })

    const expires = Date.now() + 3600_000
    writeOAuthAuth("dup-token", "dup-refresh", expires, "acct_dup")
    await new Promise((r) => setTimeout(r, 200))

    // Second write with the same access token should dedupe by id
    writeOAuthAuth("dup-token", "dup-refresh", expires, "acct_dup")
    await new Promise((r) => setTimeout(r, 200))

    const data = readMultiAuth()
    expect(data!.accounts).toHaveLength(1)
  })
})
