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
  id: "user_a",
  label: "personal",
  type: "oauth",
  access: "access-a",
  refresh: "refresh-a",
  expires: Date.now() + 3600_000,
  accountId: "acct_a",
}

const oauthB: storage.OAuthAccount = {
  id: "user_b",
  label: "work",
  type: "oauth",
  access: "access-b",
  refresh: "refresh-b",
  expires: Date.now() + 3600_000,
  accountId: "acct_b",
}

const oauthC: storage.OAuthAccount = {
  id: "user_c",
  label: "shared",
  type: "oauth",
  access: "access-c",
  refresh: "refresh-c",
  expires: Date.now() + 3600_000,
  accountId: "acct_c",
}

const oauthD: storage.OAuthAccount = {
  id: "user_d",
  label: "shared",
  type: "oauth",
  access: "access-d",
  refresh: "refresh-d",
  expires: Date.now() + 3600_000,
  accountId: "acct_d",
}

// ── fingerprint ──

describe("fingerprint", () => {
  test("identical id yields identical fingerprint regardless of other fields", () => {
    const fp1 = storage.fingerprint(oauthA)
    const refreshed: storage.OAuthAccount = {
      ...oauthA,
      refresh: "new-refresh",
      access: "new-access",
      accountId: "different",
    }
    expect(storage.fingerprint(refreshed)).toBe(fp1)
  })

  test("different ids produce different fingerprints", () => {
    expect(storage.fingerprint(oauthA)).not.toBe(storage.fingerprint(oauthB))
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

  test("write then read preserves null active", () => {
    const data: storage.ProviderData = { active: null, accounts: [oauthA], exhausted: [] }
    storage.write("openai", data)
    expect(storage.read("openai")).toEqual(data)
  })

  test("write creates directory if missing", () => {
    const nested = join(testDir, "sub", "deep")
    storage.configure(nested)
    storage.write("openai", { active: 0, accounts: [oauthA], exhausted: [] })
    expect(storage.read("openai")?.accounts).toHaveLength(1)
  })

  test("listProviders returns distinct stored providers", () => {
    storage.write("openai", { active: 0, accounts: [oauthA], exhausted: [] })
    storage.write("fake", { active: 0, accounts: [oauthB], exhausted: [] })

    expect(storage.listProviders()).toEqual(["fake", "openai"])
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

})

// ── resolve ──

describe("resolve", () => {
  test("matches by numeric index", () => {
    storage.add("openai", oauthA)
    storage.add("openai", oauthB)

    expect(storage.resolve("openai", 1)).toEqual({
      status: "match",
      index: 1,
      account: oauthB,
      by: "index",
    })
  })

  test("matches by string index", () => {
    storage.add("openai", oauthA)
    storage.add("openai", oauthB)

    expect(storage.resolve("openai", "0")).toEqual({
      status: "match",
      index: 0,
      account: oauthA,
      by: "index",
    })
  })

  test("matches by label", () => {
    storage.add("openai", oauthA)

    expect(storage.resolve("openai", "personal")).toEqual({
      status: "match",
      index: 0,
      account: oauthA,
      by: "label",
    })
  })

  test("matches by id", () => {
    storage.add("openai", oauthA)

    expect(storage.resolve("openai", "user_a")).toEqual({
      status: "match",
      index: 0,
      account: oauthA,
      by: "id",
    })
  })

  test("matches by accountId", () => {
    storage.add("openai", oauthA)

    expect(storage.resolve("openai", "acct_a")).toEqual({
      status: "match",
      index: 0,
      account: oauthA,
      by: "accountId",
    })
  })

  test("returns ambiguous for duplicate label", () => {
    storage.add("openai", oauthC)
    storage.add("openai", oauthD)

    expect(storage.resolve("openai", "shared")).toEqual({
      status: "ambiguous",
      matches: [0, 1],
    })
  })

  test("returns not_found for missing selector", () => {
    storage.add("openai", oauthA)

    expect(storage.resolve("openai", "missing")).toEqual({ status: "not_found" })
  })
})

// ── remove ──

describe("remove", () => {
  test("removes inactive account and keeps same logical active account", () => {
    storage.add("openai", oauthA) // 0
    storage.add("openai", oauthB) // 1 active
    const result = storage.remove("openai", 0)

    expect(result).toEqual({
      status: "removed",
      removedIndex: 0,
      removed: oauthA,
      removedWasActive: false,
      remainingCount: 1,
      nextActiveIndex: 0,
      nextActive: oauthB,
    })
    expect(storage.read("openai")).toEqual({
      active: 0,
      accounts: [oauthB],
      exhausted: [],
    })
  })

  test("removes active account and selects deterministic replacement", () => {
    storage.add("openai", oauthA) // 0
    storage.add("openai", oauthB) // 1 active
    storage.add("openai", oauthC) // 2 active
    storage.activate("openai", 1)
    const result = storage.remove("openai", 1)

    expect(result).toEqual({
      status: "removed",
      removedIndex: 1,
      removed: oauthB,
      removedWasActive: true,
      remainingCount: 2,
      nextActiveIndex: 1,
      nextActive: oauthC,
    })
    expect(storage.read("openai")).toEqual({
      active: 1,
      accounts: [oauthA, oauthC],
      exhausted: [],
    })
  })

  test("reindexes exhausted accounts after removal", () => {
    storage.add("openai", oauthA) // 0
    storage.add("openai", oauthB) // 1
    storage.add("openai", oauthC) // 2
    storage.activate("openai", 1)
    storage.exhaust("openai", 0)
    storage.exhaust("openai", 2)

    const result = storage.remove("openai", 1)

    expect(result).toEqual({
      status: "removed",
      removedIndex: 1,
      removed: oauthB,
      removedWasActive: true,
      remainingCount: 2,
      nextActiveIndex: 1,
      nextActive: oauthC,
    })
    expect(storage.read("openai")).toEqual({
      active: 1,
      accounts: [oauthA, oauthC],
      exhausted: [0, 1],
    })
  })

  test("drops exhausted flag for removed account", () => {
    storage.add("openai", oauthA)
    storage.add("openai", oauthB)
    storage.exhaust("openai", 1)

    storage.remove("openai", 1)

    expect(storage.read("openai")).toEqual({
      active: 0,
      accounts: [oauthA],
      exhausted: [],
    })
  })

  test("removes last account and leaves provider empty", () => {
    storage.add("openai", oauthA)

    expect(storage.remove("openai", 0)).toEqual({
      status: "removed",
      removedIndex: 0,
      removed: oauthA,
      removedWasActive: true,
      remainingCount: 0,
    })
    expect(storage.read("openai")).toBeUndefined()
  })

  test("returns ambiguous for duplicate label selector", () => {
    storage.add("openai", oauthC)
    storage.add("openai", oauthD)

    expect(storage.remove("openai", "shared")).toEqual({
      status: "ambiguous",
      matches: [0, 1],
    })
  })

  test("returns not_found for missing selector", () => {
    storage.add("openai", oauthA)

    expect(storage.remove("openai", "missing")).toEqual({ status: "not_found" })
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

  test("can clear active account", () => {
    storage.add("openai", oauthA)
    storage.activate("openai", null)
    expect(storage.read("openai")!.active).toBeNull()
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

  test("clears only selected exhausted indices", () => {
    storage.add("openai", oauthA)
    storage.add("openai", oauthB)
    storage.add("openai", oauthC)
    storage.activate("openai", 1)
    storage.exhaust("openai", 0)
    storage.exhaust("openai", 1)
    storage.exhaust("openai", 2)

    storage.reset("openai", [0, 2])

    expect(storage.read("openai")).toEqual({
      active: 1,
      accounts: [oauthA, oauthB, oauthC],
      exhausted: [1],
    })
  })

  test("ignores unknown selected exhausted indices", () => {
    storage.add("openai", oauthA)
    storage.exhaust("openai", 0)

    storage.reset("openai", [99])

    expect(storage.read("openai")!.exhausted).toEqual([0])
  })

  test("no-op on missing provider", () => {
    storage.reset("openai") // should not throw
    storage.reset("openai", [0]) // should not throw
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
    const c: storage.OAuthAccount = { ...oauthA, id: "user_c", label: "c", accountId: "acct_c" }
    storage.add("openai", oauthA) // 0
    storage.add("openai", oauthB) // 1
    storage.add("openai", c) // 2
    storage.activate("openai", 0)
    storage.exhaust("openai", 1)
    expect(storage.next("openai")).toBe(2)
  })

  test("wraps around", () => {
    const c: storage.OAuthAccount = { ...oauthA, id: "user_c", label: "c", accountId: "acct_c" }
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

  test("when active is null, returns first non-exhausted account", () => {
    const c: storage.OAuthAccount = { ...oauthA, id: "user_c", label: "c", accountId: "acct_c" }
    storage.add("openai", oauthA)
    storage.add("openai", oauthB)
    storage.add("openai", c)
    storage.activate("openai", null)
    storage.exhaust("openai", 0)
    expect(storage.next("openai")).toBe(1)
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

  test("returns undefined for api entry", () => {
    writeFileSync(join(testDir, "auth.json"), JSON.stringify({
      anthropic: { type: "api", key: "sk-ant-123" },
    }))
    expect(storage.readAuthJson("anthropic")).toBeUndefined()
  })

  test("returns undefined for missing provider", () => {
    writeFileSync(join(testDir, "auth.json"), JSON.stringify({
      openai: { type: "oauth", refresh: "r", access: "a", expires: 1 },
    }))
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
      openai: { type: "oauth", refresh: "r", access: "a", expires: 1 },
    }))
    const first = storage.readAuthJson("openai")
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

  test("readAllAuthJson returns all valid oauth entries", () => {
    writeFileSync(join(testDir, "auth.json"), JSON.stringify({
      openai: { type: "oauth", refresh: "r1", access: "a1", expires: 1 },
      fake: { type: "oauth", refresh: "r2", access: "a2", expires: 2, accountId: "acct_2" },
      anthropic: { type: "api", key: "sk-ant-123" },
      invalid: { type: "oauth", refresh: "r3", access: "a3" },
    }))

    expect(storage.readAllAuthJson()).toEqual({
      openai: { type: "oauth", refresh: "r1", access: "a1", expires: 1 },
      fake: { type: "oauth", refresh: "r2", access: "a2", expires: 2, accountId: "acct_2" },
    })
  })
})
