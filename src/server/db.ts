import { mkdirSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { Database } from "bun:sqlite"
import { PLUGIN_ID } from "../shared/constants.js"

const DB_FILENAME = "db.sqlite"
// TODO: consider central internal config for plugin parameters like DB path/name.

type AccountRow = {
  id: string
  provider: string
  account_id: string
  access_token: string
  refresh_token: string
  access_token_expires_at: string | null
  refresh_token_expires_at: string | null
  active: 0 | 1
  exhausted: 0 | 1
  exhausted_at: string | null
  created_at: string
  updated_at: string
}

export type Account = {
  id: string
  provider: string
  accountID: string
  accessToken: string
  refreshToken: string
  accessTokenExpiresAt: string | null
  refreshTokenExpiresAt: string | null
  active: boolean
  exhausted: boolean
  exhaustedAt: string | null
  createdAt: string
  updatedAt: string
}

export type UpsertAccountInput = {
  provider: string
  accountID: string
  accessToken: string
  refreshToken: string
  accessTokenExpiresAt?: string | null
  refreshTokenExpiresAt?: string | null
}

export type DbOptions = {
  path?: string
}

export type AccountsDb = {
  path: string
  close(): void
  listAccounts(provider?: string): Account[]
  upsertAccount(input: UpsertAccountInput): Account
  setAccountActive(id: string, active: boolean): void
  setAccountExhausted(id: string, exhausted: boolean): void
  deleteAccount(id: string): void
}

export function openDb(options: DbOptions = {}): AccountsDb {
  const dbPath = options.path ?? defaultDbPath()
  mkdirSync(path.dirname(dbPath), { recursive: true })

  const db = new Database(dbPath)
  initDb(db)

  const api: AccountsDb = {
    path: dbPath,
    close() {
      db.close()
    },
    listAccounts(provider) {
      const rows = provider
        ? db.query(`${selectAccountsSql} WHERE provider = ? ORDER BY created_at ASC, id ASC`).all(provider)
        : db.query(`${selectAccountsSql} ORDER BY provider ASC, created_at ASC, id ASC`).all()

      return rows.map((row) => mapAccountRow(row as AccountRow))
    },
    upsertAccount(input) {
      const now = new Date().toISOString()
      const existing = db
        .query(`${selectAccountsSql} WHERE provider = ? AND account_id = ?`)
        .get(input.provider, input.accountID) as AccountRow | undefined

      if (existing) {
        db.query(
          `UPDATE accounts
           SET access_token = ?,
               refresh_token = ?,
               access_token_expires_at = ?,
               refresh_token_expires_at = ?,
               updated_at = ?
           WHERE id = ?`,
        ).run(
          input.accessToken,
          input.refreshToken,
          input.accessTokenExpiresAt ?? null,
          input.refreshTokenExpiresAt ?? null,
          now,
          existing.id,
        )
      } else {
        db.query(
          `INSERT INTO accounts (
             id,
             provider,
             account_id,
             access_token,
             refresh_token,
             access_token_expires_at,
             refresh_token_expires_at,
             created_at,
             updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          randomUUID(),
          input.provider,
          input.accountID,
          input.accessToken,
          input.refreshToken,
          input.accessTokenExpiresAt ?? null,
          input.refreshTokenExpiresAt ?? null,
          now,
          now,
        )
      }

      const row = db
        .query(`${selectAccountsSql} WHERE provider = ? AND account_id = ?`)
        .get(input.provider, input.accountID) as AccountRow
      return mapAccountRow(row)
    },
    setAccountActive(id, active) {
      db.query("UPDATE accounts SET active = ?, updated_at = ? WHERE id = ?").run(
        active ? 1 : 0,
        new Date().toISOString(),
        id,
      )
    },
    setAccountExhausted(id, exhausted) {
      const now = new Date().toISOString()
      db.query("UPDATE accounts SET exhausted = ?, exhausted_at = ?, updated_at = ? WHERE id = ?").run(
        exhausted ? 1 : 0,
        exhausted ? now : null,
        now,
        id,
      )
    },
    deleteAccount(id) {
      db.query("DELETE FROM accounts WHERE id = ?").run(id)
    },
  }

  return api
}

export function defaultDbPath() {
  const dataRoot = process.env.XDG_DATA_HOME ?? path.join(homedir(), ".local", "share")
  return path.join(dataRoot, "opencode", "plugins", PLUGIN_ID, DB_FILENAME)
}

function initDb(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      account_id TEXT NOT NULL,
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      access_token_expires_at TEXT,
      refresh_token_expires_at TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      exhausted INTEGER NOT NULL DEFAULT 0,
      exhausted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(provider, account_id)
    )
  `)
}

const selectAccountsSql = `SELECT
  id,
  provider,
  account_id,
  access_token,
  refresh_token,
  access_token_expires_at,
  refresh_token_expires_at,
  active,
  exhausted,
  exhausted_at,
  created_at,
  updated_at
FROM accounts`

function mapAccountRow(row: AccountRow): Account {
  return {
    id: row.id,
    provider: row.provider,
    accountID: row.account_id,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    accessTokenExpiresAt: row.access_token_expires_at,
    refreshTokenExpiresAt: row.refresh_token_expires_at,
    active: row.active === 1,
    exhausted: row.exhausted === 1,
    exhaustedAt: row.exhausted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
