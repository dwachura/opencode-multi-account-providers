import { describe, test, expect, beforeEach } from "bun:test"
import * as rotation from "../src/rotation"

beforeEach(() => {
  rotation.reset()
})

describe("request tracking", () => {
  test("returns undefined for unknown session", () => {
    expect(rotation.request("missing")).toBeUndefined()
  })

  test("stores latest request context", () => {
    rotation.trackRequest("s1", "openai", 123)
    expect(rotation.request("s1")).toEqual({
      sessionID: "s1",
      providerID: "openai",
      startedAt: 123,
    })
  })
})

describe("flag + consume", () => {
  test("consume returns false when not flagged", () => {
    expect(rotation.consume("s1")).toBe(false)
  })

  test("consume returns true once after flag", () => {
    rotation.flag("s1")
    expect(rotation.consume("s1")).toBe(true)
    expect(rotation.consume("s1")).toBe(false)
  })
})

describe("auth timeline", () => {
  test("opens first interval", () => {
    rotation.openAuth("openai", "acct-a", "fp-a", 100)
    expect(rotation.intervals("openai")).toEqual([
      {
        providerID: "openai",
        accountID: "acct-a",
        fingerprint: "fp-a",
        startAt: 100,
        endAt: null,
      },
    ])
  })

  test("does not duplicate unchanged active auth", () => {
    rotation.openAuth("openai", "acct-a", "fp-a", 100)
    rotation.openAuth("openai", "acct-a", "fp-a", 200)
    expect(rotation.intervals("openai")).toHaveLength(1)
    expect(rotation.currentAuth("openai")?.endAt).toBeNull()
  })

  test("switch closes old interval and opens new one", () => {
    rotation.openAuth("openai", "acct-a", "fp-a", 100)
    rotation.openAuth("openai", "acct-b", "fp-b", 200)
    expect(rotation.intervals("openai")).toEqual([
      {
        providerID: "openai",
        accountID: "acct-a",
        fingerprint: "fp-a",
        startAt: 100,
        endAt: 200,
      },
      {
        providerID: "openai",
        accountID: "acct-b",
        fingerprint: "fp-b",
        startAt: 200,
        endAt: null,
      },
    ])
  })

  test("closeAuth closes current interval", () => {
    rotation.openAuth("openai", "acct-a", "fp-a", 100)
    rotation.closeAuth("openai", 150)
    expect(rotation.currentAuth("openai")).toBeUndefined()
    expect(rotation.intervals("openai")[0]?.endAt).toBe(150)
  })

  test("authAt resolves interval active at request time", () => {
    rotation.openAuth("openai", "acct-a", "fp-a", 100)
    rotation.openAuth("openai", "acct-b", "fp-b", 200)
    expect(rotation.authAt("openai", 150)?.fingerprint).toBe("fp-a")
    expect(rotation.authAt("openai", 250)?.fingerprint).toBe("fp-b")
    expect(rotation.authAt("openai", 50)).toBeUndefined()
  })
})
