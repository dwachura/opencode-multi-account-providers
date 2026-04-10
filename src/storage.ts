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
  active: number
  accounts: Account[]
  exhausted: number[]
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
  authJsonMtime = 0
  authJsonCache = {}
}

/** Path to opencode's auth.json. Used by the plugin's file watcher. */
export function getAuthJsonPath(): string {
  return authJsonPath
}

// ── Database ──

function getDb(): Database {
  if (db) return db
  mkdirSync(dataDir, { recursive: true })
  db = new Database(dbPath, { create: true })
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
    active: activeIdx === -1 ? 0 : activeIdx,
    accounts,
    exhausted,
  }
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
