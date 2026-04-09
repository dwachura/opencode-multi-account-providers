import { describe, test, expect, beforeEach } from "bun:test"
import * as rotation from "../src/rotation"

// rotation module uses module-level state, so we need to be careful with test isolation.
// Since there's no reset/clear function, tests must use unique session IDs.

let n = 0
function sid(): string {
  return `session-${++n}`
}

describe("track + provider", () => {
  test("returns undefined for unknown session", () => {
    expect(rotation.provider(sid())).toBeUndefined()
  })

  test("stores and retrieves provider", () => {
    const s = sid()
    rotation.track(s, "openai")
    expect(rotation.provider(s)).toBe("openai")
  })

  test("overwrites previous provider", () => {
    const s = sid()
    rotation.track(s, "openai")
    rotation.track(s, "anthropic")
    expect(rotation.provider(s)).toBe("anthropic")
  })
})

describe("flag + consume", () => {
  test("consume returns false when not flagged", () => {
    expect(rotation.consume(sid())).toBe(false)
  })

  test("consume returns true after flag", () => {
    const s = sid()
    rotation.flag(s)
    expect(rotation.consume(s)).toBe(true)
  })

  test("consume clears the flag (single use)", () => {
    const s = sid()
    rotation.flag(s)
    rotation.consume(s)
    expect(rotation.consume(s)).toBe(false)
  })

  test("flag is per-session", () => {
    const s1 = sid()
    const s2 = sid()
    rotation.flag(s1)
    expect(rotation.consume(s2)).toBe(false)
    expect(rotation.consume(s1)).toBe(true)
  })
})

describe("trackAccount + usedAccount", () => {
  test("returns undefined for unknown session", () => {
    expect(rotation.usedAccount(sid())).toBeUndefined()
  })

  test("stores and retrieves account index", () => {
    const s = sid()
    rotation.trackAccount(s, 2)
    expect(rotation.usedAccount(s)).toBe(2)
  })

  test("overwrites previous account index", () => {
    const s = sid()
    rotation.trackAccount(s, 0)
    rotation.trackAccount(s, 1)
    expect(rotation.usedAccount(s)).toBe(1)
  })

  test("is per-session", () => {
    const s1 = sid()
    const s2 = sid()
    rotation.trackAccount(s1, 0)
    rotation.trackAccount(s2, 3)
    expect(rotation.usedAccount(s1)).toBe(0)
    expect(rotation.usedAccount(s2)).toBe(3)
  })
})
