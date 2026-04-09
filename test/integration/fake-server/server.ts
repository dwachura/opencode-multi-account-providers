import * as db from "./db"

const MODEL_ID = "fake-model-v1"
const CANNED_RESPONSE = "I'm a fake LLM server for testing multi-account rotation. Your request was processed successfully."

// ── Auth middleware ──

function authenticate(req: Request): db.User | Response {
  const auth = req.headers.get("authorization")
  if (!auth?.startsWith("Bearer ")) {
    return Response.json(
      { error: { message: "Missing API key", type: "auth", code: "invalid_api_key" } },
      { status: 401 },
    )
  }

  const token = auth.slice(7)

  // Try API key first, then access token
  const user = db.getByApiKey(token) ?? db.getByAccessToken(token)
  if (!user) {
    return Response.json(
      { error: { message: "Invalid credentials", type: "auth", code: "invalid_api_key" } },
      { status: 401 },
    )
  }

  // If authenticated via access token, check expiry
  if (user.access_token === token && user.token_expires < Date.now()) {
    return Response.json(
      { error: { message: "Access token expired", type: "auth", code: "token_expired" } },
      { status: 401 },
    )
  }

  return user
}

function checkRateLimit(user: db.User): Response | null {
  if (user.req_used >= user.req_limit) {
    return Response.json(
      {
        error: {
          message: `Rate limit reached for ${user.name}. Limit ${user.req_limit}, Used ${user.req_used}.`,
          type: "requests",
          param: null,
          code: "rate_limit_exceeded",
        },
      },
      {
        status: 429,
        headers: { "Retry-After": "2", "x-ratelimit-remaining-requests": "0" },
      },
    )
  }
  if (user.tok_used >= user.tok_limit) {
    return Response.json(
      {
        error: {
          message: `Token limit reached for ${user.name}. Limit ${user.tok_limit}, Used ${user.tok_used}.`,
          type: "tokens",
          param: null,
          code: "rate_limit_exceeded",
        },
      },
      {
        status: 429,
        headers: { "Retry-After": "2", "x-ratelimit-remaining-tokens": "0" },
      },
    )
  }
  return null
}

// ── Responses API helpers ──

function makeResponseId(): string {
  return `resp_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`
}

function makeMsgId(): string {
  return `msg_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`
}

function nonStreamingResponse(user: db.User): Response {
  const text = CANNED_RESPONSE
  const inputTokens = 20
  const outputTokens = text.split(/\s+/).length * 2 // rough estimate
  db.incrementUsage(user.id, inputTokens + outputTokens)

  return Response.json({
    id: makeResponseId(),
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status: "completed",
    model: MODEL_ID,
    output: [
      {
        type: "message",
        id: makeMsgId(),
        status: "completed",
        role: "assistant",
        content: [{ type: "output_text", text, annotations: [] }],
      },
    ],
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
    },
  })
}

function streamingResponse(user: db.User): Response {
  const text = CANNED_RESPONSE
  const words = text.split(/\s+/)
  const inputTokens = 20
  const outputTokens = words.length * 2
  db.incrementUsage(user.id, inputTokens + outputTokens)

  const respId = makeResponseId()
  const msgId = makeMsgId()
  const now = Math.floor(Date.now() / 1000)
  let seq = 0

  const baseResponse = {
    id: respId,
    object: "response",
    created_at: now,
    model: MODEL_ID,
    output: [],
    usage: null,
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      function send(event: string, data: unknown) {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }

      send("response.created", {
        type: "response.created",
        response: { ...baseResponse, status: "in_progress" },
        sequence_number: seq++,
      })

      send("response.in_progress", {
        type: "response.in_progress",
        response: { ...baseResponse, status: "in_progress" },
        sequence_number: seq++,
      })

      send("response.output_item.added", {
        type: "response.output_item.added",
        output_index: 0,
        item: {
          id: msgId,
          type: "message",
          status: "in_progress",
          role: "assistant",
          content: [],
        },
        sequence_number: seq++,
      })

      send("response.content_part.added", {
        type: "response.content_part.added",
        item_id: msgId,
        output_index: 0,
        content_index: 0,
        part: { type: "output_text", text: "", annotations: [] },
        sequence_number: seq++,
      })

      for (const word of words) {
        const delta = word + " "
        send("response.output_text.delta", {
          type: "response.output_text.delta",
          item_id: msgId,
          output_index: 0,
          content_index: 0,
          delta,
          sequence_number: seq++,
        })
      }

      send("response.output_text.done", {
        type: "response.output_text.done",
        item_id: msgId,
        output_index: 0,
        content_index: 0,
        text,
        sequence_number: seq++,
      })

      send("response.content_part.done", {
        type: "response.content_part.done",
        item_id: msgId,
        output_index: 0,
        content_index: 0,
        part: { type: "output_text", text, annotations: [] },
        sequence_number: seq++,
      })

      send("response.output_item.done", {
        type: "response.output_item.done",
        output_index: 0,
        item: {
          id: msgId,
          type: "message",
          status: "completed",
          role: "assistant",
          content: [{ type: "output_text", text, annotations: [] }],
        },
        sequence_number: seq++,
      })

      const usage = {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: inputTokens + outputTokens,
      }
      send("response.completed", {
        type: "response.completed",
        response: {
          ...baseResponse,
          status: "completed",
          output: [
            {
              type: "message",
              id: msgId,
              status: "completed",
              role: "assistant",
              content: [{ type: "output_text", text, annotations: [] }],
            },
          ],
          usage,
        },
        sequence_number: seq++,
      })

      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
}

// ── Route handlers ──

function handleModels(): Response {
  return Response.json({
    object: "list",
    data: [
      {
        id: MODEL_ID,
        object: "model",
        created: 1700000000,
        owned_by: "fake-llm-server",
      },
    ],
  })
}

function handleResponses(req: Request, body: any): Response {
  const userOrErr = authenticate(req)
  if (userOrErr instanceof Response) return userOrErr
  const user = userOrErr

  const limited = checkRateLimit(user)
  if (limited) return limited

  if (body.stream) {
    return streamingResponse(user)
  }
  return nonStreamingResponse(user)
}

// ── OAuth token endpoint ──

function handleTokenRefresh(body: any): Response {
  const refreshToken = body.refresh_token
  if (!refreshToken || typeof refreshToken !== "string") {
    return Response.json(
      { error: "invalid_request", error_description: "refresh_token is required" },
      { status: 400 },
    )
  }

  const user = db.getByRefreshToken(refreshToken)
  if (!user) {
    return Response.json(
      { error: "invalid_grant", error_description: "Invalid refresh token" },
      { status: 401 },
    )
  }

  const tokens = db.rotateTokens(user.id)
  if (!tokens) {
    return Response.json(
      { error: "server_error", error_description: "Failed to rotate tokens" },
      { status: 500 },
    )
  }

  return Response.json({
    access_token: tokens.access,
    refresh_token: tokens.refresh,
    token_type: "bearer",
    expires_in: Math.floor((tokens.expires - Date.now()) / 1000),
    account_id: user.account_id,
  })
}

// ── Admin API ──

function handleAdminGetUsers(): Response {
  return Response.json(db.listAll())
}

function handleAdminGetUser(id: string): Response {
  const user = db.getById(id)
  if (!user) return Response.json({ error: "not found" }, { status: 404 })
  return Response.json(user)
}

function handleAdminSetLimits(id: string, body: any): Response {
  const reqLimit = body.req_limit ?? body.reqLimit
  const tokLimit = body.tok_limit ?? body.tokLimit
  if (typeof reqLimit !== "number" || typeof tokLimit !== "number") {
    return Response.json({ error: "req_limit and tok_limit required" }, { status: 400 })
  }
  if (!db.setLimits(id, reqLimit, tokLimit)) {
    return Response.json({ error: "not found" }, { status: 404 })
  }
  return Response.json(db.getById(id))
}

function handleAdminResetUsage(id: string): Response {
  if (!db.resetUsage(id)) {
    return Response.json({ error: "not found" }, { status: 404 })
  }
  return Response.json(db.getById(id))
}

function handleAdminResetAll(): Response {
  db.resetAll()
  return Response.json({ ok: true })
}

function handleAdminSetTokens(id: string, body: any): Response {
  if (!body.access_token || !body.refresh_token || typeof body.expires !== "number") {
    return Response.json({ error: "access_token, refresh_token, and expires required" }, { status: 400 })
  }
  if (!db.setTokens(id, body.access_token, body.refresh_token, body.expires)) {
    return Response.json({ error: "not found" }, { status: 404 })
  }
  return Response.json(db.getById(id))
}

// ── Server ──

export function start(port = 18080) {
  db.init()
  db.seed()

  const server = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url)
      const path = url.pathname
      const method = req.method

      // OpenAI-compatible endpoints
      if (method === "GET" && path === "/v1/models") {
        return handleModels()
      }
      if (method === "POST" && path === "/v1/responses") {
        const body = await req.json()
        return handleResponses(req, body)
      }

      // OAuth token endpoint
      if (method === "POST" && path === "/oauth/token") {
        const body = await req.json()
        return handleTokenRefresh(body)
      }

      // Admin endpoints
      if (method === "GET" && path === "/admin/users") {
        return handleAdminGetUsers()
      }
      if (method === "GET" && path.startsWith("/admin/users/")) {
        return handleAdminGetUser(path.split("/")[3])
      }
      if (method === "PUT" && path.match(/^\/admin\/users\/[^/]+\/limits$/)) {
        const id = path.split("/")[3]
        const body = await req.json()
        return handleAdminSetLimits(id, body)
      }
      if (method === "PUT" && path.match(/^\/admin\/users\/[^/]+\/tokens$/)) {
        const id = path.split("/")[3]
        const body = await req.json()
        return handleAdminSetTokens(id, body)
      }
      if (method === "POST" && path.match(/^\/admin\/users\/[^/]+\/reset$/)) {
        return handleAdminResetUsage(path.split("/")[3])
      }
      if (method === "POST" && path === "/admin/reset") {
        return handleAdminResetAll()
      }

      return Response.json({ error: "not found" }, { status: 404 })
    },
  })

  console.log(`Fake LLM server listening on http://localhost:${server.port}`)
  console.log(`  POST /v1/responses   — OpenAI Responses API`)
  console.log(`  GET  /v1/models      — Model listing`)
  console.log(`  POST /oauth/token    — OAuth token refresh`)
  console.log(`  GET  /admin/users    — List all users`)
  console.log(`  GET  /admin/users/:id`)
  console.log(`  PUT  /admin/users/:id/limits   { req_limit, tok_limit }`)
  console.log(`  PUT  /admin/users/:id/tokens   { access_token, refresh_token, expires }`)
  console.log(`  POST /admin/users/:id/reset`)
  console.log(`  POST /admin/reset    — Reset all usage counters`)
  console.log()
  console.log(`Seeded users:`)
  for (const u of db.listAll()) {
    console.log(`  ${u.name} (${u.id}): key=${u.api_key}  oauth=${u.access_token}  account=${u.account_id}  limits=${u.req_limit}req/${u.tok_limit}tok`)
  }

  return server
}

// Run directly: bun run test/fake-llm-server/server.ts
if (import.meta.main) {
  start()
}
