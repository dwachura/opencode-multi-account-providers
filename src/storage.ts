import { Database } from "bun:sqlite"
import { createHash } from "node:crypto"
import { readFileSync, statSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"

// ── Types ──

export type OAuthAccount = {
  id: string
  label: string
  type: "oauth"
  access: string
  refresh: string
  expires: number
  accountId?: string
  enterpriseUrl?: string
}

export type Account = OAuthAccount

export type ProviderData = {
  active: number | null
  accounts: Account[]
  exhausted: number[]
}

export type AccountSelector = number | string

export type ResolveResult =
  | {
      status: "match"
      index: number
      account: OAuthAccount
      by: "index" | "label" | "id" | "accountId"
    }
  | {
      status: "ambiguous"
      matches: number[]
    }
  | {
      status: "not_found"
    }

export type RemoveResult =
  | {
      status: "removed"
      removedIndex: number
      removed: OAuthAccount
      removedWasActive: boolean
      remainingCount: number
      nextActiveIndex?: number
      nextActive?: OAuthAccount
    }
  | {
      status: "ambiguous"
      matches: number[]
    }
  | {
      status: "not_found"
    }

export type OAuthAuthEntry = {
  type: "oauth"
  refresh: string
  access: string
  expires: number
  accountId?: string
  enterpriseUrl?: string
}

// ── Paths ──

function defaultDataDir(): string {
  return join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "opencode")
}

let dataDir = defaultDataDir()
let dbPath = join(dataDir, "multi-auth.db")
let authJsonPath = join(dataDir, "auth.json")
let logPath = join(dataDir, "log", "multi-account.log")
let db: Database | undefined

/** Override the data directory. Used by tests. */
export function configure(dir: string): void {
  if (db) {
    db.close()
    db = undefined
  }
  dataDir = dir
  dbPath = join(dir, "multi-auth.db")
  authJsonPath = join(dir, "auth.json")
  logPath = join(dir, "log", "multi-account.log")
  authJsonMtime = 0
  authJsonCache = {}
}

/** Path to opencode's auth.json. Used by the plugin's file watcher. */
export function getAuthJsonPath(): string {
  return authJsonPath
}

export function getLogPath(): string {
  return logPath
}

// ── Database ──

function getDb(): Database {
  if (db) return db
  mkdirSync(dataDir, { recursive: true })
  db = new Database(dbPath, { create: true })
  db.exec("PRAGMA journal_mode = WAL;")
  db.exec("PRAGMA busy_timeout = 5000;")
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      provider TEXT NOT NULL,
      position INTEGER NOT NULL,
      fingerprint TEXT NOT NULL,
      id TEXT NOT NULL,
      label TEXT NOT NULL,
      access TEXT NOT NULL,
      refresh TEXT NOT NULL,
      expires INTEGER NOT NULL,
      account_id TEXT,
      enterprise_url TEXT,
      is_active INTEGER NOT NULL DEFAULT 0,
      is_exhausted INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (provider, position)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_fingerprint ON accounts(provider, fingerprint);
  `)
  return db
}

type Row = {
  provider: string
  position: number
  fingerprint: string
  id: string
  label: string
  access: string
  refresh: string
  expires: number
  account_id: string | null
  enterprise_url: string | null
  is_active: number
  is_exhausted: number
}

function rowToAccount(row: Row): OAuthAccount {
  return {
    id: row.id,
    type: "oauth",
    label: row.label,
    access: row.access,
    refresh: row.refresh,
    expires: row.expires,
    ...(row.account_id !== null && { accountId: row.account_id }),
    ...(row.enterprise_url !== null && { enterpriseUrl: row.enterprise_url }),
  }
}

function accountToParams(
  provider: string,
  position: number,
  account: OAuthAccount,
  isActive: number,
  isExhausted: number,
): Record<string, string | number | null> {
  return {
    $provider: provider,
    $position: position,
    $fingerprint: fingerprint(account),
    $id: account.id,
    $label: account.label,
    $access: account.access,
    $refresh: account.refresh,
    $expires: account.expires,
    $account_id: account.accountId ?? null,
    $enterprise_url: account.enterpriseUrl ?? null,
    $is_active: isActive,
    $is_exhausted: isExhausted,
  }
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

export function fingerprint(account: OAuthAccount): string {
  return createHash("sha256").update(`oauth:id:${account.id}`).digest("hex")
}

export function read(provider: string): ProviderData | undefined {
  const rows = getDb()
    .prepare("SELECT * FROM accounts WHERE provider = $provider ORDER BY position")
    .all({ $provider: provider }) as Row[]

  if (rows.length === 0) return undefined

  const accounts = rows.map(rowToAccount)
  const activeIdx = rows.findIndex((r) => r.is_active === 1)
  const exhausted: number[] = []
  rows.forEach((r, i) => {
    if (r.is_exhausted === 1) exhausted.push(i)
  })

  return {
    active: activeIdx === -1 ? null : activeIdx,
    accounts,
    exhausted,
  }
}

export function listProviders(): string[] {
  const rows = getDb()
    .prepare("SELECT DISTINCT provider FROM accounts ORDER BY provider")
    .all() as Array<{ provider: string }>
  return rows.map((row) => row.provider)
}

export function write(provider: string, data: ProviderData): void {
  const d = getDb()
  const tx = d.transaction((value: ProviderData) => {
    d.prepare("DELETE FROM accounts WHERE provider = $provider").run({ $provider: provider })
    const insert = d.prepare(`
      INSERT INTO accounts (
        provider, position, fingerprint, id, label,
        access, refresh, expires, account_id, enterprise_url,
        is_active, is_exhausted
      ) VALUES (
        $provider, $position, $fingerprint, $id, $label,
        $access, $refresh, $expires, $account_id, $enterprise_url,
        $is_active, $is_exhausted
      )
    `)
    const exhaustedSet = new Set(value.exhausted)
    value.accounts.forEach((account, i) => {
      insert.run(
        accountToParams(provider, i, account, i === value.active ? 1 : 0, exhaustedSet.has(i) ? 1 : 0),
      )
    })
  })
  tx(data)
}

export function add(provider: string, account: OAuthAccount): number {
  const data = read(provider) ?? { active: null, accounts: [], exhausted: [] }
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
  return data.active as number
}

export function resolve(provider: string, selector: AccountSelector): ResolveResult {
  const data = read(provider)
  if (!data) return { status: "not_found" }

  if (typeof selector === "number") {
    const account = data.accounts[selector] as OAuthAccount | undefined
    if (!account) return { status: "not_found" }
    return { status: "match", index: selector, account, by: "index" }
  }

  const trimmed = selector.trim()
  if (!trimmed) return { status: "not_found" }

  if (/^\d+$/.test(trimmed)) {
    const index = Number.parseInt(trimmed, 10)
    const account = data.accounts[index] as OAuthAccount | undefined
    if (account) return { status: "match", index, account, by: "index" }
  }

  const matches = new Map<number, ResolveResult & { status: "match" }>()
  data.accounts.forEach((account, index) => {
    const oauth = account as OAuthAccount
    if (oauth.label === trimmed) {
      matches.set(index, { status: "match", index, account: oauth, by: "label" })
      return
    }
    if (oauth.id === trimmed) {
      matches.set(index, { status: "match", index, account: oauth, by: "id" })
      return
    }
    if (oauth.accountId === trimmed) {
      matches.set(index, { status: "match", index, account: oauth, by: "accountId" })
    }
  })

  if (matches.size === 0) return { status: "not_found" }
  if (matches.size > 1) return { status: "ambiguous", matches: [...matches.keys()] }
  return [...matches.values()][0]
}

export function findByFingerprint(provider: string, value: string): { index: number, account: OAuthAccount } | undefined {
  const data = read(provider)
  if (!data) return undefined
  const index = data.accounts.findIndex(
    (account) => fingerprint(account as OAuthAccount) === value,
  )
  if (index === -1) return undefined
  return { index, account: data.accounts[index] as OAuthAccount }
}

export function remove(provider: string, selector: AccountSelector): RemoveResult {
  const resolved = resolve(provider, selector)
  if (resolved.status !== "match") return resolved

  const data = read(provider)
  if (!data) return { status: "not_found" }

  const removedIndex = resolved.index
  const removedWasActive = data.active === removedIndex
  const removed = data.accounts[removedIndex] as OAuthAccount
  const accounts = data.accounts.filter((_, index) => index !== removedIndex)
  const exhausted = data.exhausted
    .filter((index) => index !== removedIndex)
    .map((index) => (index > removedIndex ? index - 1 : index))

  if (accounts.length === 0) {
    write(provider, { active: null, accounts, exhausted })
    return {
      status: "removed",
      removedIndex,
      removed,
      removedWasActive,
      remainingCount: 0,
    }
  }

  const nextActiveIndex = data.active === null
    ? undefined
    : removedIndex < data.active
      ? data.active - 1
      : Math.min(data.active, accounts.length - 1)
  const nextActive = nextActiveIndex === undefined
    ? undefined
    : accounts[nextActiveIndex] as OAuthAccount
  write(provider, { active: nextActiveIndex ?? null, accounts, exhausted })

  return {
    status: "removed",
    removedIndex,
    removed,
    removedWasActive,
    remainingCount: accounts.length,
    nextActiveIndex,
    nextActive,
  }
}

export function activate(provider: string, index: number | null): void {
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

export function reset(provider: string, indices?: number[]): void {
  const data = read(provider)
  if (!data) return
  if (!indices || indices.length === 0) {
    data.exhausted = []
    write(provider, data)
    return
  }

  const selected = new Set(indices)
  data.exhausted = data.exhausted.filter((index) => !selected.has(index))
  write(provider, data)
}

export function next(provider: string): number | undefined {
  const data = read(provider)
  if (!data || data.accounts.length <= 1) return undefined
  const exhaustedSet = new Set(data.exhausted)
  if (data.active === null) {
    for (let i = 0; i < data.accounts.length; i++) {
      if (!exhaustedSet.has(i)) return i
    }
    return undefined
  }
  for (let i = 1; i <= data.accounts.length; i++) {
    const candidate = (data.active + i) % data.accounts.length
    if (!exhaustedSet.has(candidate)) return candidate
  }
  return undefined
}

export function readAuthJson(provider: string): OAuthAuthEntry | undefined {
  const all = readAuthJsonAll()
  const entry = all[provider]
  if (!entry || typeof entry !== "object") return undefined
  const e = entry as Record<string, unknown>
  if (e.type !== "oauth") return undefined
  if (typeof e.refresh !== "string" || typeof e.access !== "string" || typeof e.expires !== "number") {
    return undefined
  }
  return entry as OAuthAuthEntry
}

export function readAllAuthJson(): Record<string, OAuthAuthEntry> {
  const all = readAuthJsonAll()
  const result: Record<string, OAuthAuthEntry> = {}
  for (const [provider, entry] of Object.entries(all)) {
    if (!entry || typeof entry !== "object") continue
    const e = entry as Record<string, unknown>
    if (e.type !== "oauth") continue
    if (typeof e.refresh !== "string" || typeof e.access !== "string" || typeof e.expires !== "number") {
      continue
    }
    result[provider] = entry as OAuthAuthEntry
  }
  return result
}
