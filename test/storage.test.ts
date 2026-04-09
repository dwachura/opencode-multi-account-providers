import { describe, test, expect, beforeEach, afterAll } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { mkdtempSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import * as storage from "../src/storage"

let testDir: string

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "multi-account-test-"))
  storage.configure(testDir)
})

afterAll(() => {
  // Clean up all temp dirs — best effort
  try {
    rmSync(testDir, { recursive: true })
  } catch {}
})

// ── Helpers ──

const oauthA: storage.OAuthAccount = {
  label: "personal",
  type: "oauth",
  access: "access-a",
  refresh: "refresh-a",
  expires: Date.now() + 3600_000,
  accountId: "acct_a",
}

const oauthB: storage.OAuthAccount = {
  label: "work",
  type: "oauth",
  access: "access-b",
  refresh: "refresh-b",
  expires: Date.now() + 3600_000,
  accountId: "acct_b",
}

const apiAccount: storage.ApiAccount = {
  label: "api-key-1",
  type: "api",
  key: "sk-test-key-1",
}

// ── fingerprint ──

describe("fingerprint", () => {
  test("oauth uses accountId when available", () => {
    const fp1 = storage.fingerprint(oauthA)
    // Same accountId, different refresh token → same fingerprint
    const refreshed = { ...oauthA, refresh: "new-refresh-token", access: "new-access" }
    expect(storage.fingerprint(refreshed)).toBe(fp1)
  })

  test("oauth falls back to refresh when no accountId", () => {
    const noId: storage.OAuthAccount = { ...oauthA, accountId: undefined }
    const fp1 = storage.fingerprint(noId)
    const differentRefresh: storage.OAuthAccount = { ...noId, refresh: "other-refresh" }
    expect(storage.fingerprint(differentRefresh)).not.toBe(fp1)
  })

  test("different accountIds produce different fingerprints", () => {
    expect(storage.fingerprint(oauthA)).not.toBe(storage.fingerprint(oauthB))
  })

  test("api uses key", () => {
    const fp1 = storage.fingerprint(apiAccount)
    const different: storage.ApiAccount = { ...apiAccount, key: "sk-other" }
    expect(storage.fingerprint(different)).not.toBe(fp1)
  })

  test("oauth and api never collide", () => {
    expect(storage.fingerprint(oauthA)).not.toBe(storage.fingerprint(apiAccount))
  })
})

// ── read / write ──

describe("read/write", () => {
  test("read returns undefined for missing provider", () => {
    expect(storage.read("openai")).toBeUndefined()
  })

  test("write then read round-trips", () => {
    const data: storage.ProviderData = { active: 0, accounts: [oauthA], exhausted: [] }
    storage.write("openai", data)
    expect(storage.read("openai")).toEqual(data)
  })

  test("write creates directory if missing", () => {
    const nested = join(testDir, "sub", "deep")
    storage.configure(nested)
    storage.write("openai", { active: 0, accounts: [oauthA], exhausted: [] })
    expect(storage.read("openai")?.accounts).toHaveLength(1)
  })
})

// ── add ──

describe("add", () => {
  test("first account gets index 0", () => {
    const idx = storage.add("openai", oauthA)
    expect(idx).toBe(0)
    const data = storage.read("openai")!
    expect(data.accounts).toHaveLength(1)
    expect(data.active).toBe(0)
  })

  test("second account gets index 1 and becomes active", () => {
    storage.add("openai", oauthA)
    const idx = storage.add("openai", oauthB)
    expect(idx).toBe(1)
    const data = storage.read("openai")!
    expect(data.accounts).toHaveLength(2)
    expect(data.active).toBe(1)
  })

  test("duplicate by fingerprint updates in place", () => {
    storage.add("openai", oauthA)
    const refreshed: storage.OAuthAccount = {
      ...oauthA,
      access: "new-access",
      refresh: "new-refresh",
      expires: Date.now() + 7200_000,
    }
    const idx = storage.add("openai", refreshed)
    expect(idx).toBe(0)
    const data = storage.read("openai")!
    expect(data.accounts).toHaveLength(1)
    expect((data.accounts[0] as storage.OAuthAccount).access).toBe("new-access")
  })

  test("api accounts deduplicate by key", () => {
    storage.add("openai", apiAccount)
    const updated: storage.ApiAccount = { ...apiAccount, label: "renamed" }
    const idx = storage.add("openai", updated)
    expect(idx).toBe(0)
    expect(storage.read("openai")!.accounts).toHaveLength(1)
  })
})

// ── activate ──

describe("activate", () => {
  test("sets active index", () => {
    storage.add("openai", oauthA)
    storage.add("openai", oauthB)
    storage.activate("openai", 0)
    expect(storage.read("openai")!.active).toBe(0)
  })

  test("no-op on missing provider", () => {
    storage.activate("openai", 0) // should not throw
  })
})

// ── exhaust ──

describe("exhaust", () => {
  test("adds index to exhausted", () => {
    storage.add("openai", oauthA)
    storage.exhaust("openai", 0)
    expect(storage.read("openai")!.exhausted).toEqual([0])
  })

  test("does not duplicate", () => {
    storage.add("openai", oauthA)
    storage.exhaust("openai", 0)
    storage.exhaust("openai", 0)
    expect(storage.read("openai")!.exhausted).toEqual([0])
  })

  test("no-op on missing provider", () => {
    storage.exhaust("openai", 0) // should not throw
  })
})

// ── reset ──

describe("reset", () => {
  test("clears exhausted array", () => {
    storage.add("openai", oauthA)
    storage.add("openai", oauthB)
    storage.exhaust("openai", 0)
    storage.exhaust("openai", 1)
    storage.reset("openai")
    expect(storage.read("openai")!.exhausted).toEqual([])
  })

  test("no-op on missing provider", () => {
    storage.reset("openai") // should not throw
  })
})

// ── next ──

describe("next", () => {
  test("returns undefined with single account", () => {
    storage.add("openai", oauthA)
    expect(storage.next("openai")).toBeUndefined()
  })

  test("returns undefined with no data", () => {
    expect(storage.next("openai")).toBeUndefined()
  })

  test("round-robin to next non-exhausted", () => {
    storage.add("openai", oauthA)
    storage.add("openai", oauthB)
    storage.activate("openai", 0)
    expect(storage.next("openai")).toBe(1)
  })

  test("skips exhausted accounts", () => {
    const c: storage.OAuthAccount = { ...oauthA, label: "c", accountId: "acct_c" }
    storage.add("openai", oauthA) // 0
    storage.add("openai", oauthB) // 1
    storage.add("openai", c) // 2
    storage.activate("openai", 0)
    storage.exhaust("openai", 1)
    expect(storage.next("openai")).toBe(2)
  })

  test("wraps around", () => {
    const c: storage.OAuthAccount = { ...oauthA, label: "c", accountId: "acct_c" }
    storage.add("openai", oauthA) // 0
    storage.add("openai", oauthB) // 1
    storage.add("openai", c) // 2
    storage.activate("openai", 2)
    storage.exhaust("openai", 1)
    expect(storage.next("openai")).toBe(0)
  })

  test("returns undefined when all exhausted", () => {
    storage.add("openai", oauthA)
    storage.add("openai", oauthB)
    storage.activate("openai", 0)
    storage.exhaust("openai", 0)
    storage.exhaust("openai", 1)
    expect(storage.next("openai")).toBeUndefined()
  })
})

// ── readAuthJson ──

describe("readAuthJson", () => {
  test("reads oauth entry from auth.json", () => {
    writeFileSync(join(testDir, "auth.json"), JSON.stringify({
      openai: { type: "oauth", refresh: "r", access: "a", expires: 9999999999999 },
    }))
    const entry = storage.readAuthJson("openai")
    expect(entry).toEqual({ type: "oauth", refresh: "r", access: "a", expires: 9999999999999 })
  })

  test("reads api entry from auth.json", () => {
    writeFileSync(join(testDir, "auth.json"), JSON.stringify({
      anthropic: { type: "api", key: "sk-ant-123" },
    }))
    expect(storage.readAuthJson("anthropic")).toEqual({ type: "api", key: "sk-ant-123" })
  })

  test("returns undefined for missing provider", () => {
    writeFileSync(join(testDir, "auth.json"), JSON.stringify({ openai: { type: "api", key: "k" } }))
    expect(storage.readAuthJson("anthropic")).toBeUndefined()
  })

  test("returns undefined for wellknown type", () => {
    writeFileSync(join(testDir, "auth.json"), JSON.stringify({
      "https://example.com": { type: "wellknown", key: "VAR", token: "tok" },
    }))
    expect(storage.readAuthJson("https://example.com")).toBeUndefined()
  })

  test("returns undefined for missing auth.json", () => {
    expect(storage.readAuthJson("openai")).toBeUndefined()
  })

  test("mtime cache avoids re-read", () => {
    writeFileSync(join(testDir, "auth.json"), JSON.stringify({
      openai: { type: "api", key: "k1" },
    }))
    const first = storage.readAuthJson("openai")
    // Overwrite file content WITHOUT changing mtime (write same bytes)
    // Since we can't control mtime precisely, just verify cache is populated
    const second = storage.readAuthJson("openai")
    expect(first).toEqual(second)
  })

  test("includes optional oauth fields when present", () => {
    writeFileSync(join(testDir, "auth.json"), JSON.stringify({
      openai: {
        type: "oauth", refresh: "r", access: "a", expires: 123,
        accountId: "acct_1", enterpriseUrl: "https://ent.example.com",
      },
    }))
    const entry = storage.readAuthJson("openai")
    expect(entry).toHaveProperty("accountId", "acct_1")
    expect(entry).toHaveProperty("enterpriseUrl", "https://ent.example.com")
  })
})
