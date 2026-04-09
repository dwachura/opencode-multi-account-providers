import { createHash } from "node:crypto"
import { readFileSync, writeFileSync, statSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"

// ── Types ──

export type OAuthAccount = {
  label: string
  type: "oauth"
  access: string
  refresh: string
  expires: number
  accountId?: string
  enterpriseUrl?: string
}

export type ApiAccount = {
  label: string
  type: "api"
  key: string
  metadata?: Record<string, string>
}

export type Account = OAuthAccount | ApiAccount

export type ProviderData = {
  active: number
  accounts: Account[]
  exhausted: number[]
}

type MultiAuthStore = Record<string, ProviderData>

export type OAuthAuthEntry = { type: "oauth"; refresh: string; access: string; expires: number; accountId?: string; enterpriseUrl?: string }

export type AuthEntry =
  | OAuthAuthEntry
  | { type: "api"; key: string; metadata?: Record<string, string> }

// ── Paths ──

function defaultDataDir(): string {
  return join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "opencode")
}

let dataDir = defaultDataDir()
let multiAuthPath = join(dataDir, "multi-auth.json")
let authJsonPath = join(dataDir, "auth.json")

/** Override the data directory. Used by tests. */
export function configure(dir: string): void {
  dataDir = dir
  multiAuthPath = join(dir, "multi-auth.json")
  authJsonPath = join(dir, "auth.json")
  authJsonMtime = 0
  authJsonCache = {}
}

// ── Internal helpers ──

function readStore(): MultiAuthStore {
  try {
    return JSON.parse(readFileSync(multiAuthPath, "utf-8"))
  } catch {
    return {}
  }
}

function writeStore(store: MultiAuthStore): void {
  try {
    mkdirSync(dataDir, { recursive: true })
    writeFileSync(multiAuthPath, JSON.stringify(store, null, 2), { mode: 0o600 })
  } catch {}
}

// ── auth.json mtime cache ──

let authJsonMtime = 0
let authJsonCache: Record<string, unknown> = {}

function readAuthJsonAll(): Record<string, unknown> {
  try {
    const mtime = statSync(authJsonPath).mtimeMs
    if (mtime === authJsonMtime) return authJsonCache
    authJsonMtime = mtime
    authJsonCache = JSON.parse(readFileSync(authJsonPath, "utf-8"))
    return authJsonCache
  } catch {
    return {}
  }
}

// ── Public API ──

export function fingerprint(account: Account): string {
  let input: string
  if (account.type === "oauth") {
    // Prefer accountId (stable across token refreshes). Fall back to refresh
    // token only when accountId is unavailable.
    input = account.accountId ? `oauth:accountId:${account.accountId}` : `oauth:refresh:${account.refresh}`
  } else {
    input = `api:${account.key}`
  }
  return createHash("sha256").update(input).digest("hex")
}

export function read(provider: string): ProviderData | undefined {
  return readStore()[provider]
}

export function write(provider: string, data: ProviderData): void {
  const store = readStore()
  store[provider] = data
  writeStore(store)
}

export function add(provider: string, account: Account): number {
  const data = read(provider) ?? { active: 0, accounts: [], exhausted: [] }
  const fp = fingerprint(account)
  const existingIdx = data.accounts.findIndex((a) => fingerprint(a) === fp)
  if (existingIdx !== -1) {
    data.accounts[existingIdx] = account
    write(provider, data)
    return existingIdx
  }
  data.accounts.push(account)
  data.active = data.accounts.length - 1
  write(provider, data)
  return data.active
}

export function activate(provider: string, index: number): void {
  const data = read(provider)
  if (!data) return
  data.active = index
  write(provider, data)
}

export function exhaust(provider: string, index: number): void {
  const data = read(provider)
  if (!data) return
  if (!data.exhausted.includes(index)) {
    data.exhausted.push(index)
    write(provider, data)
  }
}

export function reset(provider: string): void {
  const data = read(provider)
  if (!data) return
  data.exhausted = []
  write(provider, data)
}

export function next(provider: string): number | undefined {
  const data = read(provider)
  if (!data || data.accounts.length <= 1) return undefined
  const exhaustedSet = new Set(data.exhausted)
  for (let i = 1; i <= data.accounts.length; i++) {
    const candidate = (data.active + i) % data.accounts.length
    if (!exhaustedSet.has(candidate)) return candidate
  }
  return undefined
}

export function readAuthJson(provider: string): AuthEntry | undefined {
  const all = readAuthJsonAll()
  const entry = all[provider]
  if (!entry || typeof entry !== "object") return undefined
  const e = entry as Record<string, unknown>
  if (e.type === "oauth" && typeof e.refresh === "string" && typeof e.access === "string" && typeof e.expires === "number") {
    return entry as AuthEntry
  }
  if (e.type === "api" && typeof e.key === "string") {
    return entry as AuthEntry
  }
  return undefined
}
