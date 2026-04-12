import { createWriteStream, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import * as storage from "../src/storage"

const PROJECT_ROOT = join(import.meta.dir, "..")
const AUTH_PLUGIN_DIR = join(PROJECT_ROOT, "test", "integration", "auth-plugin")
const E2E_ROOT = join(PROJECT_ROOT, ".test-env", "interactive")
const STATE_PATH = join(E2E_ROOT, "current.json")
const PROVIDER_ID = "fake"
const MODEL_ID = "fake-model-v1"

type User = {
  id: string
  name: string
  req_limit: number
  req_used: number
  tok_limit: number
  tok_used: number
  access_token: string | null
  refresh_token: string | null
  token_expires: number
  account_id: string | null
}

type CreateUserBody = {
  id: string
  name: string
  access_token: string
  refresh_token: string
  token_expires: number
  account_id: string
  req_limit?: number
}

type State = {
  envRoot: string
  dataDir: string
  configDir: string
  authJsonPath: string
  fakeLogPath: string
  fakeBase: string
  fakePort: number
}

function usage() {
  console.log(`Usage:
  bun run e2e:tui
  bun run e2e:account:list
  bun run e2e:account:add <label> [initialReqLimit]
  bun run e2e:account:remove <label|index>
  bun run e2e:limit <label> <reqLimit> [tokLimit]
  bun run e2e:reset

Generic form:
  bun run e2e <command> [...args]`)
}

function ensureRoot() {
  mkdirSync(E2E_ROOT, { recursive: true })
}

function saveState(state: State) {
  ensureRoot()
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2))
}

function clearState() {
  try {
    unlinkSync(STATE_PATH)
  } catch {}
}

function loadState(): State {
  return JSON.parse(readFileSync(STATE_PATH, "utf-8")) as State
}

function requireState(): State {
  try {
    return loadState()
  } catch {
    throw new Error("Interactive E2E env is not running. Start it with `bun run e2e:tui`.")
  }
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`${init?.method ?? "GET"} ${url} failed: ${res.status} ${body}`)
  }
  return res.json() as Promise<T>
}

async function waitForServer(base: string, timeoutMs = 10_000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${base}/v1/models`)
      if (res.ok) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out waiting for fake server at ${base}`)
}

function defaultEnvRoot() {
  return join(E2E_ROOT, `run-${Date.now()}`)
}

function writeConfig(configDir: string, fakeBase: string) {
  const plugin = [
    [AUTH_PLUGIN_DIR, {}],
    [PROJECT_ROOT, { provider: PROVIDER_ID }],
  ]

  const config = {
    $schema: "https://opencode.ai/config.json",
    provider: {
      [PROVIDER_ID]: {
        npm: "@ai-sdk/openai",
        name: "Fake LLM",
        options: {
          apiKey: "fake-oauth-dummy",
          baseURL: `${fakeBase}/v1`,
        },
        models: {
          [MODEL_ID]: {
            name: "Fake Model",
          },
        },
      },
    },
    plugin,
    agent: {
      title: {
        disable: true,
      },
    },
  }

  const tuiConfig = {
    $schema: "https://opencode.ai/tui.json",
    plugin,
  }

  mkdirSync(configDir, { recursive: true })
  writeFileSync(join(configDir, "opencode.json"), JSON.stringify(config, null, 2))
  writeFileSync(join(configDir, "tui.json"), JSON.stringify(tuiConfig, null, 2))
}

function writeAuthJson(authJsonPath: string, user: User) {
  if (!user.access_token || !user.refresh_token) {
    throw new Error(`User ${user.id} has no OAuth tokens configured`)
  }
  writeFileSync(
    authJsonPath,
    JSON.stringify(
      {
        [PROVIDER_ID]: {
          type: "oauth",
          access: user.access_token,
          refresh: user.refresh_token,
          expires: user.token_expires,
          ...(user.account_id && { accountId: user.account_id }),
        },
      },
      null,
      2,
    ),
    { mode: 0o600 },
  )
}

function writeBootstrapAuthJson(authJsonPath: string) {
  writeFileSync(
    authJsonPath,
    JSON.stringify({}, null, 2),
    { mode: 0o600 },
  )
}

async function listUsers(state: State): Promise<User[]> {
  return fetchJson<User[]>(`${state.fakeBase}/admin/users`)
}

function resolveUser(users: User[], input: string): User {
  const key = input.toLowerCase()
  const match = users.find(
    (user) =>
      user.id.toLowerCase() === key ||
      user.name.toLowerCase() === key ||
      user.name.toLowerCase().startsWith(key),
  )
  if (!match) {
    throw new Error(`Unknown fake user: ${input}. Known users: ${users.map((u) => u.id).join(", ") || "none"}`)
  }
  return match
}

function normalizeLabel(input: string): string {
  const label = input.trim()
  if (!label) throw new Error("Label cannot be empty")
  if (!/^[a-zA-Z0-9._-]+$/.test(label)) {
    throw new Error("Label must match [a-zA-Z0-9._-]+")
  }
  return label
}

async function createUser(state: State, label: string, initialReqLimit?: number): Promise<User> {
  const normalized = normalizeLabel(label)
  if (initialReqLimit !== undefined && (!Number.isFinite(initialReqLimit) || initialReqLimit < 0)) {
    throw new Error("initialReqLimit must be a non-negative number")
  }
  const body: CreateUserBody = {
    id: normalized,
    name: normalized,
    access_token: normalized,
    refresh_token: normalized,
    token_expires: Date.now() + 3600_000,
    account_id: normalized,
    ...(initialReqLimit !== undefined && { req_limit: initialReqLimit }),
  }
  return fetchJson<User>(`${state.fakeBase}/admin/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

async function ensureUser(state: State, label: string, initialReqLimit?: number): Promise<User> {
  const users = await listUsers(state)
  const normalized = normalizeLabel(label)
  const existing = users.find((user) => user.id === normalized)
  if (existing) return existing
  return createUser(state, normalized, initialReqLimit)
}

function configureStorage(state: State) {
  storage.configure(state.dataDir)
}

async function addAccount(input: string, initialReqLimitInput?: string) {
  const state = requireState()
  const initialReqLimit = initialReqLimitInput === undefined ? undefined : Number(initialReqLimitInput)
  if (initialReqLimitInput !== undefined && !Number.isFinite(initialReqLimit)) {
    throw new Error("initialReqLimit must be a number")
  }
  const user = await ensureUser(state, input, initialReqLimit)
  configureStorage(state)
  const before = storage.read(PROVIDER_ID)?.accounts.length ?? 0
  writeAuthJson(state.authJsonPath, user)
  await new Promise((resolve) => setTimeout(resolve, 300))
  const afterData = storage.read(PROVIDER_ID)
  const after = afterData?.accounts.length ?? 0
  console.log(`Wrote ${user.id} credentials to ${state.authJsonPath}`)
  if (after > before) {
    console.log(`Captured new account. Stored accounts: ${after}`)
    return
  }
  if (afterData) {
    console.log(`Account storage updated. Stored accounts: ${after}`)
    return
  }
  console.log("No stored account observed yet. Make sure the TUI/plugin is running.")
}

function accountDisplayName(account: storage.OAuthAccount, users: User[]) {
  const user = users.find((candidate) => candidate.access_token === account.access)
  return user ? user.id : account.label
}

async function listAccounts() {
  const state = requireState()
  configureStorage(state)
  const data = storage.read(PROVIDER_ID)
  const users = await listUsers(state).catch(() => [] as User[])

  console.log(`Env: ${state.envRoot}`)
  console.log(`auth.json: ${state.authJsonPath}`)
  if (!data || data.accounts.length === 0) {
    console.log("No stored accounts")
    return
  }

  data.accounts.forEach((account, index) => {
    const flags = [
      data.active === index ? "active" : undefined,
      data.exhausted.includes(index) ? "exhausted" : undefined,
    ].filter(Boolean)
    console.log(`${index}: ${accountDisplayName(account as storage.OAuthAccount, users)} [${flags.join(", ") || "idle"}]`)
  })
}

async function removeAccount(input: string) {
  const state = requireState()
  configureStorage(state)
  const data = storage.read(PROVIDER_ID)
  if (!data || data.accounts.length === 0) {
    throw new Error("No stored accounts to remove")
  }

  const users = await listUsers(state).catch(() => [] as User[])
  let index = Number.parseInt(input, 10)
  if (!Number.isInteger(index)) {
    const normalized = normalizeLabel(input)
    const resolvedUser = users.find((user) => user.id === normalized)
    index = data.accounts.findIndex((account) => {
      const oauth = account as storage.OAuthAccount
      if (resolvedUser) {
        return oauth.access === resolvedUser.access_token || oauth.accountId === resolvedUser.account_id
      }
      return oauth.id === input || oauth.accountId === input || oauth.label === input
    })
  }

  if (index < 0 || index >= data.accounts.length) {
    throw new Error(`Account not found: ${input}`)
  }

  const removed = data.accounts[index] as storage.OAuthAccount
  const accounts = data.accounts.filter((_, i) => i !== index)
  const exhausted = data.exhausted
    .filter((i) => i !== index)
    .map((i) => (i > index ? i - 1 : i))
  const active = accounts.length === 0 ? 0 : index < data.active ? data.active - 1 : Math.min(data.active, accounts.length - 1)

  storage.write(PROVIDER_ID, { active, accounts, exhausted })

  if (accounts.length > 0 && data.active === index) {
    const next = accounts[active] as storage.OAuthAccount
    writeFileSync(
      state.authJsonPath,
      JSON.stringify(
        {
          [PROVIDER_ID]: {
            type: "oauth",
            access: next.access,
            refresh: next.refresh,
            expires: next.expires,
            ...(next.accountId && { accountId: next.accountId }),
          },
        },
        null,
        2,
      ),
      { mode: 0o600 },
    )
  }

  console.log(`Removed account ${(removed as storage.OAuthAccount).id}`)
  await fetch(`${state.fakeBase}/admin/users/${encodeURIComponent((removed as storage.OAuthAccount).id)}`, {
    method: "DELETE",
  }).catch(() => undefined)
}

async function setLimit(userInput: string, reqLimitInput: string, tokLimitInput?: string) {
  const state = requireState()
  const users = await listUsers(state)
  const user = resolveUser(users, userInput)
  const reqLimit = Number(reqLimitInput)
  const tokLimit = tokLimitInput ? Number(tokLimitInput) : user.tok_limit
  if (!Number.isFinite(reqLimit) || !Number.isFinite(tokLimit)) {
    throw new Error("reqLimit and tokLimit must be numbers")
  }
  const updated = await fetchJson<User>(`${state.fakeBase}/admin/users/${user.id}/limits`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ req_limit: reqLimit, tok_limit: tokLimit }),
  })
  console.log(`Updated ${updated.name} limits to ${updated.req_limit} req / ${updated.tok_limit} tok`)
}

async function resetState() {
  const state = requireState()
  await fetchJson(`${state.fakeBase}/admin/reset`, { method: "POST" })
  configureStorage(state)
  storage.reset(PROVIDER_ID)
  console.log("Reset fake server usage and cleared exhausted accounts")
}

function printInstructions(state: State) {
  const authPath = state.authJsonPath.startsWith(homedir())
    ? state.authJsonPath.replace(homedir(), "~")
    : state.authJsonPath
  console.log(`Interactive E2E env ready
  env:       ${state.envRoot}
  fake:      ${state.fakeBase}
  auth.json: ${authPath}
  fake log:  ${state.fakeLogPath}
  storage:   ${join(state.dataDir, "multi-auth.db")}

Helpers from another terminal:
  bun run e2e:account:add alpha 1
  bun run e2e:account:add beta 100
  bun run e2e:account:list
  bun run e2e:limit alpha 1
  bun run e2e:reset

Optional log tail:
  tail -f ${state.fakeLogPath}

Suggested demo:
  1. In TUI, use provider \`${PROVIDER_ID}\` / model \`${MODEL_ID}\`
  2. In another shell: bun run e2e:account:add alpha 1
  3. In another shell: bun run e2e:account:add beta 100
  4. In another shell: bun run e2e:limit alpha 1
  5. Send prompts until rotation occurs
`)
}

async function launchTui() {
  const envRoot = defaultEnvRoot()
  const homeDir = join(envRoot, "home")
  const dataDir = join(envRoot, "data", "opencode")
  const configDir = join(envRoot, "config")
  const xdgConfigHome = join(envRoot, "xdg", "config")
  const xdgCacheHome = join(envRoot, "xdg", "cache")
  const xdgStateHome = join(envRoot, "xdg", "state")
  const authJsonPath = join(dataDir, "auth.json")
  const fakeLogPath = join(envRoot, "fake-server.log")
  const fakePort = Number(process.env.E2E_FAKE_PORT ?? 18080)
  const fakeBase = `http://localhost:${fakePort}`

  rmSync(envRoot, { recursive: true, force: true })
  mkdirSync(homeDir, { recursive: true })
  mkdirSync(dataDir, { recursive: true })
  mkdirSync(configDir, { recursive: true })
  mkdirSync(xdgConfigHome, { recursive: true })
  mkdirSync(xdgCacheHome, { recursive: true })
  mkdirSync(xdgStateHome, { recursive: true })

  const fakeLog = createWriteStream(fakeLogPath, { flags: "a" })
  const fakeServer = Bun.spawn({
    cmd: ["bun", "run", "test/integration/fake-server/server.ts", String(fakePort)],
    cwd: PROJECT_ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      FAKE_SERVER_SEED: "0",
    },
  })

  fakeServer.stdout.pipeTo(
    new WritableStream({
      write(chunk) {
        fakeLog.write(Buffer.from(chunk))
      },
    }),
  )
  fakeServer.stderr.pipeTo(
    new WritableStream({
      write(chunk) {
        fakeLog.write(Buffer.from(chunk))
      },
    }),
  )

  const cleanup = () => {
    fakeServer.kill()
    fakeLog.end()
    clearState()
  }
  process.on("SIGINT", () => {
    cleanup()
    process.exit(130)
  })
  process.on("SIGTERM", () => {
    cleanup()
    process.exit(143)
  })

  await waitForServer(fakeBase)
  writeConfig(configDir, fakeBase)
  writeBootstrapAuthJson(authJsonPath)

  const state: State = {
    envRoot,
    dataDir,
    configDir,
    authJsonPath,
    fakeLogPath,
    fakeBase,
    fakePort,
  }
  saveState(state)
  printInstructions(state)

  const opencode = Bun.spawn({
    cmd: ["opencode"],
    cwd: PROJECT_ROOT,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    env: {
      ...process.env,
      OPENCODE_CONFIG_DIR: configDir,
      OPENCODE_DISABLE_PROJECT_CONFIG: "1",
      OPENCODE_TEST_HOME: homeDir,
      FAKE_OAUTH_BASE_URL: fakeBase,
      HOME: homeDir,
      XDG_DATA_HOME: join(envRoot, "data"),
      XDG_CONFIG_HOME: xdgConfigHome,
      XDG_CACHE_HOME: xdgCacheHome,
      XDG_STATE_HOME: xdgStateHome,
    },
  })

  const code = await opencode.exited
  cleanup()
  process.exit(code)
}

async function main() {
  const [command, ...args] = process.argv.slice(2)
  switch (command) {
    case undefined:
    case "help":
      usage()
      return
    case "tui":
      await launchTui()
      return
    case "list":
    case "account:list":
      await listAccounts()
      return
    case "add":
    case "account:add":
      if (!args[0]) throw new Error("Missing label")
      await addAccount(args[0], args[1])
      return
    case "remove":
    case "account:remove":
      if (!args[0]) throw new Error("Missing label or index")
      await removeAccount(args[0])
      return
    case "limit":
      if (!args[0] || !args[1]) throw new Error("Usage: bun run e2e:limit <user> <reqLimit> [tokLimit]")
      await setLimit(args[0], args[1], args[2])
      return
    case "reset":
      await resetState()
      return
    default:
      throw new Error(`Unknown command: ${command}`)
  }
}

await main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exit(1)
})
