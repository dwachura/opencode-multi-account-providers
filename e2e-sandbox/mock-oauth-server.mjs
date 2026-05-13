import { randomUUID } from "node:crypto"
import http from "node:http"

export const MOCK_PROVIDER_ID = "auth-pool-mock"

export async function startMockOAuthServer(options = {}) {
  const accounts = new Map()
  const codes = new Map()

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1")

      if (request.method === "GET" && url.pathname === "/health") {
        return sendJson(response, 200, { ok: true })
      }

      if (request.method === "GET" && url.pathname === "/accounts") {
        return sendJson(response, 200, { accounts: [...accounts.values()].map(publicAccount) })
      }

      if (request.method === "POST" && url.pathname === "/accounts") {
        const account = registerAccount(accounts, await readJson(request))
        return sendJson(response, 201, publicAccount(account))
      }

      if (request.method === "POST" && url.pathname === "/authorize") {
        const body = await readJson(request)
        const accountID = readString(body.accountId ?? body.accountID, "accountId")
        const account = accounts.get(accountID)
        if (!account) return sendJson(response, 404, { error: "unknown_account" })

        const code = randomUUID()
        codes.set(code, accountID)
        const authorizeUrl = new URL("/authorize", baseUrl(server))
        authorizeUrl.searchParams.set("code", code)
        authorizeUrl.searchParams.set("accountId", accountID)
        return sendJson(response, 200, { code, url: authorizeUrl.href, accountId: accountID })
      }

      if (request.method === "GET" && url.pathname === "/authorize") {
        const code = url.searchParams.get("code") ?? ""
        const accountID = url.searchParams.get("accountId") ?? ""
        response.writeHead(200, { "content-type": "text/plain; charset=utf-8" })
        response.end(`Mock OAuth account: ${accountID}\nCode: ${code}\n`)
        return
      }

      if (request.method === "POST" && url.pathname === "/token") {
        const body = await readJson(request)
        const code = readString(body.code, "code")
        const accountID = codes.get(code)
        if (!accountID) return sendJson(response, 404, { error: "unknown_code" })

        codes.delete(code)
        const account = accounts.get(accountID)
        if (!account) return sendJson(response, 404, { error: "unknown_account" })
        return sendJson(response, 200, {
          type: "oauth",
          refresh: account.refresh,
          access: account.access,
          expires: account.expires,
          accountId: account.accountId,
        })
      }

      sendJson(response, 404, { error: "not_found" })
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) })
    }
  })

  for (const account of options.accounts ?? []) registerAccount(accounts, account)

  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject)
      resolve()
    })
  })

  return {
    url: baseUrl(server),
    registerAccount(account) {
      return publicAccount(registerAccount(accounts, account))
    },
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    },
  }
}

function registerAccount(accounts, input) {
  const accountId = readString(input.accountId ?? input.accountID, "accountId")
  const access = readString(input.access ?? input.accessToken, "access")
  const refresh = readString(input.refresh ?? input.refreshToken, "refresh")
  const expires = readExpires(input.expires)
  const account = {
    accountId,
    label: typeof input.label === "string" ? input.label : accountId,
    access,
    refresh,
    expires,
  }
  accounts.set(accountId, account)
  return account
}

function publicAccount(account) {
  return {
    accountId: account.accountId,
    label: account.label,
    expires: account.expires,
  }
}

function readExpires(value) {
  if (value === undefined) return Date.now() + 60 * 60 * 1000
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("expires must be a number")
  return value
}

function readString(value, name) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${name} must be a non-empty string`)
  return value
}

function baseUrl(server) {
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("server is not listening")
  return `http://127.0.0.1:${address.port}`
}

async function readJson(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString("utf8"))
}

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" })
  response.end(`${JSON.stringify(body)}\n`)
}
