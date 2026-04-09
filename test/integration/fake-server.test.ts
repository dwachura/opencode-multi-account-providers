import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test"
import { start } from "./fake-server/server"
import type { Server } from "bun"

let server: Server
let base: string

beforeAll(() => {
  server = start(0) // random port
  base = `http://localhost:${server.port}`
})

afterAll(() => {
  server.stop(true)
})

beforeEach(async () => {
  // Reset all usage counters between tests
  await fetch(`${base}/admin/reset`, { method: "POST" })
})

// ── Helpers ──

function llm(apiKey: string, body: Record<string, unknown> = {}) {
  return fetch(`${base}/v1/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "fake-model-v1", input: "hello", ...body }),
  })
}

async function setLimits(userId: string, reqLimit: number, tokLimit: number) {
  return fetch(`${base}/admin/users/${userId}/limits`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ req_limit: reqLimit, tok_limit: tokLimit }),
  })
}

// ── Models ──

describe("GET /v1/models", () => {
  test("returns model list", async () => {
    const res = await fetch(`${base}/v1/models`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.object).toBe("list")
    expect(body.data).toHaveLength(1)
    expect(body.data[0].id).toBe("fake-model-v1")
  })
})

// ── Auth ──

describe("authentication", () => {
  test("rejects missing auth header", async () => {
    const res = await fetch(`${base}/v1/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "fake-model-v1", input: "hi" }),
    })
    expect(res.status).toBe(401)
  })

  test("rejects invalid api key", async () => {
    const res = await llm("sk-invalid")
    expect(res.status).toBe(401)
  })

  test("accepts valid api key", async () => {
    const res = await llm("sk-test-user-a")
    expect(res.status).toBe(200)
  })
})

// ── Non-streaming responses ──

describe("POST /v1/responses (non-streaming)", () => {
  test("returns complete response", async () => {
    const res = await llm("sk-test-user-a")
    const body = await res.json()
    expect(body.object).toBe("response")
    expect(body.status).toBe("completed")
    expect(body.output).toHaveLength(1)
    expect(body.output[0].type).toBe("message")
    expect(body.output[0].role).toBe("assistant")
    expect(body.output[0].content[0].type).toBe("output_text")
    expect(body.output[0].content[0].text).toBeString()
    expect(body.usage.input_tokens).toBeGreaterThan(0)
    expect(body.usage.output_tokens).toBeGreaterThan(0)
  })

  test("increments usage", async () => {
    await llm("sk-test-user-a")
    const user = await (await fetch(`${base}/admin/users/user-a`)).json()
    expect(user.req_used).toBe(1)
    expect(user.tok_used).toBeGreaterThan(0)
  })
})

// ── Streaming responses ──

describe("POST /v1/responses (streaming)", () => {
  test("returns SSE stream with correct event sequence", async () => {
    const res = await llm("sk-test-user-a", { stream: true })
    expect(res.headers.get("content-type")).toBe("text/event-stream")

    const text = await res.text()
    const events = text
      .split("\n\n")
      .filter(Boolean)
      .map((chunk) => {
        const lines = chunk.split("\n")
        const event = lines.find((l) => l.startsWith("event: "))?.slice(7)
        const data = lines.find((l) => l.startsWith("data: "))?.slice(6)
        return { event, data: data ? JSON.parse(data) : null }
      })

    const eventTypes = events.map((e) => e.event)
    expect(eventTypes[0]).toBe("response.created")
    expect(eventTypes[1]).toBe("response.in_progress")
    expect(eventTypes[2]).toBe("response.output_item.added")
    expect(eventTypes[3]).toBe("response.content_part.added")
    // Middle events are text deltas
    expect(eventTypes).toContain("response.output_text.delta")
    // End events
    expect(eventTypes.at(-4)).toBe("response.output_text.done")
    expect(eventTypes.at(-3)).toBe("response.content_part.done")
    expect(eventTypes.at(-2)).toBe("response.output_item.done")
    expect(eventTypes.at(-1)).toBe("response.completed")
  })

  test("delta events contain text fragments", async () => {
    const res = await llm("sk-test-user-a", { stream: true })
    const text = await res.text()
    const deltas = text
      .split("\n\n")
      .filter((c) => c.includes("response.output_text.delta"))
      .map((chunk) => {
        const data = chunk.split("\n").find((l) => l.startsWith("data: "))?.slice(6)
        return data ? JSON.parse(data) : null
      })

    expect(deltas.length).toBeGreaterThan(0)
    const combined = deltas.map((d) => d.delta).join("")
    expect(combined.trim()).toBeString()
  })

  test("completed event has usage", async () => {
    const res = await llm("sk-test-user-a", { stream: true })
    const text = await res.text()
    const completed = text
      .split("\n\n")
      .find((c) => c.includes("response.completed"))
    const data = JSON.parse(completed!.split("\n").find((l) => l.startsWith("data: "))!.slice(6))
    expect(data.response.usage.total_tokens).toBeGreaterThan(0)
  })
})

// ── Rate limiting ──

describe("rate limiting", () => {
  test("returns 429 when request limit exceeded", async () => {
    await setLimits("user-c", 1, 100_000)
    const res1 = await llm("sk-test-user-c")
    expect(res1.status).toBe(200)
    const res2 = await llm("sk-test-user-c")
    expect(res2.status).toBe(429)
    const body = await res2.json()
    expect(body.error.code).toBe("rate_limit_exceeded")
    expect(res2.headers.get("retry-after")).toBe("2")
  })

  test("returns 429 when token limit exceeded", async () => {
    await setLimits("user-c", 1000, 1) // 1 token limit
    const res1 = await llm("sk-test-user-c")
    expect(res1.status).toBe(200) // first request uses tokens
    const res2 = await llm("sk-test-user-c")
    expect(res2.status).toBe(429)
  })

  test("429 applies to streaming too", async () => {
    await setLimits("user-c", 1, 100_000)
    await llm("sk-test-user-c")
    const res = await llm("sk-test-user-c", { stream: true })
    expect(res.status).toBe(429)
  })
})

// ── Admin API ──

describe("admin API", () => {
  test("GET /admin/users lists all users", async () => {
    const res = await fetch(`${base}/admin/users`)
    const users = await res.json()
    expect(users.length).toBeGreaterThanOrEqual(3)
  })

  test("GET /admin/users/:id returns user", async () => {
    const res = await fetch(`${base}/admin/users/user-a`)
    const user = await res.json()
    expect(user.name).toBe("Alice")
  })

  test("GET /admin/users/:id returns 404 for unknown", async () => {
    const res = await fetch(`${base}/admin/users/nonexistent`)
    expect(res.status).toBe(404)
  })

  test("PUT /admin/users/:id/limits updates limits", async () => {
    await setLimits("user-a", 50, 50000)
    const user = await (await fetch(`${base}/admin/users/user-a`)).json()
    expect(user.req_limit).toBe(50)
    expect(user.tok_limit).toBe(50000)
  })

  test("POST /admin/users/:id/reset clears usage", async () => {
    await llm("sk-test-user-a")
    await fetch(`${base}/admin/users/user-a/reset`, { method: "POST" })
    const user = await (await fetch(`${base}/admin/users/user-a`)).json()
    expect(user.req_used).toBe(0)
    expect(user.tok_used).toBe(0)
  })

  test("POST /admin/reset clears all usage", async () => {
    await llm("sk-test-user-a")
    await llm("sk-test-user-b")
    await fetch(`${base}/admin/reset`, { method: "POST" })
    const users = await (await fetch(`${base}/admin/users`)).json()
    expect(users.every((u: any) => u.req_used === 0 && u.tok_used === 0)).toBe(true)
  })
})
