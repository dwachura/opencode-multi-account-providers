import { Database } from "bun:sqlite"

let db: Database

export function init(path = ":memory:"): Database {
  db = new Database(path)
  db.run("PRAGMA journal_mode = WAL")

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      api_key       TEXT UNIQUE NOT NULL,
      name          TEXT NOT NULL,
      req_limit     INTEGER NOT NULL DEFAULT 100,
      req_used      INTEGER NOT NULL DEFAULT 0,
      tok_limit     INTEGER NOT NULL DEFAULT 100000,
      tok_used      INTEGER NOT NULL DEFAULT 0,
      access_token  TEXT UNIQUE,
      refresh_token TEXT UNIQUE,
      token_expires INTEGER NOT NULL DEFAULT 0,
      account_id    TEXT
    )
  `)

  return db
}

function generateToken(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`
}

export function seed(): void {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO users (id, api_key, name, req_limit, tok_limit, access_token, refresh_token, token_expires, account_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const expires = Date.now() + 3600_000 // 1 hour from now
  insert.run("user-a", "sk-test-user-a", "Alice", 100, 100_000, "access-a", "refresh-a", expires, "acct_alice")
  insert.run("user-b", "sk-test-user-b", "Bob", 100, 100_000, "access-b", "refresh-b", expires, "acct_bob")
  insert.run("user-c", "sk-test-user-c", "Carol", 5, 1_000, "access-c", "refresh-c", expires, "acct_carol")
}

export type User = {
  id: string
  api_key: string
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

export function getByApiKey(apiKey: string): User | null {
  return db.prepare("SELECT * FROM users WHERE api_key = ?").get(apiKey) as User | null
}

export function getByAccessToken(token: string): User | null {
  return db.prepare("SELECT * FROM users WHERE access_token = ?").get(token) as User | null
}

export function getByRefreshToken(token: string): User | null {
  return db.prepare("SELECT * FROM users WHERE refresh_token = ?").get(token) as User | null
}

export function getById(id: string): User | null {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as User | null
}

export function listAll(): User[] {
  return db.prepare("SELECT * FROM users").all() as User[]
}

export function incrementUsage(id: string, tokens: number): void {
  db.prepare("UPDATE users SET req_used = req_used + 1, tok_used = tok_used + ? WHERE id = ?")
    .run(tokens, id)
}

export function setLimits(id: string, reqLimit: number, tokLimit: number): boolean {
  const result = db.prepare("UPDATE users SET req_limit = ?, tok_limit = ? WHERE id = ?")
    .run(reqLimit, tokLimit, id)
  return result.changes > 0
}

export function resetUsage(id: string): boolean {
  const result = db.prepare("UPDATE users SET req_used = 0, tok_used = 0 WHERE id = ?").run(id)
  return result.changes > 0
}

export function resetAll(): void {
  db.prepare("UPDATE users SET req_used = 0, tok_used = 0").run()
}

/** Rotate tokens for a user (simulates refresh). Returns new access + refresh tokens. */
export function rotateTokens(id: string, expiresIn = 3600_000): { access: string; refresh: string; expires: number } | null {
  const user = getById(id)
  if (!user) return null
  const access = generateToken("access")
  const refresh = generateToken("refresh")
  const expires = Date.now() + expiresIn
  db.prepare("UPDATE users SET access_token = ?, refresh_token = ?, token_expires = ? WHERE id = ?")
    .run(access, refresh, expires, id)
  return { access, refresh, expires }
}

/** Set specific tokens for a user (useful for tests). */
export function setTokens(id: string, access: string, refresh: string, expires: number): boolean {
  const result = db.prepare("UPDATE users SET access_token = ?, refresh_token = ?, token_expires = ? WHERE id = ?")
    .run(access, refresh, expires, id)
  return result.changes > 0
}

export function close(): void {
  db.close()
}
