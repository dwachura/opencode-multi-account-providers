import assert from "node:assert/strict"
import { test } from "node:test"
import mockProviderPlugin from "../mock-oauth-provider-plugin/index.mjs"
import { MOCK_PROVIDER_ID, startMockOAuthServer } from "../mock-oauth-server.mjs"

test("mock OAuth server registers accounts and exchanges codes for credentials", async () => {
  const server = await startMockOAuthServer()
  try {
    await postJson(`${server.url}/accounts`, {
      accountId: "account-a",
      label: "Account A",
      access: "access-a",
      refresh: "refresh-a",
      expires: 123,
    })
    await postJson(`${server.url}/accounts`, {
      accountId: "account-b",
      access: "access-b",
      refresh: "refresh-b",
      expires: 456,
    })

    const first = await postJson(`${server.url}/authorize`, { accountId: "account-a" })
    const second = await postJson(`${server.url}/authorize`, { accountId: "account-b" })

    assert.equal(first.accountId, "account-a")
    assert.equal(second.accountId, "account-b")
    assert.notEqual(first.code, second.code)

    const token = await postJson(`${server.url}/token`, { code: first.code })
    assert.deepEqual(token, {
      type: "oauth",
      refresh: "refresh-a",
      access: "access-a",
      expires: 123,
      accountId: "account-a",
    })

    const reused = await fetch(`${server.url}/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: first.code }),
    })
    assert.equal(reused.status, 404)
  } finally {
    await server.close()
  }
})

test("mock OpenCode provider plugin exposes OAuth auth for registered accounts", async () => {
  const server = await startMockOAuthServer({
    accounts: [
      {
        accountId: "alice",
        access: "access-alice",
        refresh: "refresh-alice",
        expires: 789,
      },
    ],
  })

  try {
    const hooks = await mockProviderPlugin.server({}, { baseURL: server.url })
    const config = {}
    await hooks.config(config)

    assert.equal(mockProviderPlugin.id, "auth-pool-mock-oauth-provider-plugin")
    assert.equal(config.provider[MOCK_PROVIDER_ID].name, "Auth Pool Mock")
    assert.equal(hooks.auth.provider, MOCK_PROVIDER_ID)

    const method = hooks.auth.methods[0]
    const authorization = await method.authorize({ accountId: "alice" })
    const code = new URL(authorization.url).searchParams.get("code")
    const result = await authorization.callback(code)

    assert.equal(authorization.method, "code")
    assert.equal(result.type, "success")
    assert.equal(result.accountId, "alice")
    assert.equal(result.access, "access-alice")
    assert.equal(result.refresh, "refresh-alice")

    assert.deepEqual(await authorization.callback("unknown-code"), { type: "failed" })
  } finally {
    await server.close()
  }
})

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  assert.equal(response.ok, true, `${url} returned ${response.status}`)
  return response.json()
}
