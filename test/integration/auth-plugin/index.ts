/**
 * Test-only auth plugin that mimics the Codex plugin's fetch wrapper behavior
 * for the "fake" provider.
 *
 * The Codex plugin (codex.ts) is hardcoded to provider: "openai" and rewrites
 * URLs to chatgpt.com. For integration testing with our fake server, we need
 * an auth plugin that:
 *   1. Attaches to provider: "fake"
 *   2. Re-reads auth.json on every fetch call (like Codex does)
 *   3. Passes the access token as a Bearer header
 *   4. Does NOT rewrite URLs
 *
 * This ensures the side-channel auth.json rotation works — when our plugin
 * writes new credentials to auth.json, this fetch wrapper picks them up
 * on the next request.
 */
import type { PluginModule } from "@opencode-ai/plugin"

const FAKE_OAUTH_BASE_URL = process.env.FAKE_OAUTH_BASE_URL

const plugin: PluginModule = {
  id: "fake-auth-plugin",
  server: async (input) => {
    return {
      auth: {
        provider: "fake",
        async loader(getAuth) {
          return {
            // Dummy key — the fetch wrapper overrides the Authorization header
            // when OAuth credentials exist. Keeping this present avoids the
            // OpenAI provider rejecting requests before the interactive harness
            // has written the first auth.json entry.
            apiKey: "fake-oauth-dummy",
            async fetch(requestInput: RequestInfo | URL, init?: RequestInit) {
              const currentAuth = await getAuth()
              if (currentAuth.type !== "oauth") return fetch(requestInput, init)

              const headers = new Headers()
              if (init?.headers) {
                if (init.headers instanceof Headers) {
                  init.headers.forEach((value, key) => headers.set(key, value))
                } else if (Array.isArray(init.headers)) {
                  for (const [key, value] of init.headers) {
                    if (value !== undefined) headers.set(key, String(value))
                  }
                } else {
                  for (const [key, value] of Object.entries(init.headers)) {
                    if (value !== undefined) headers.set(key, String(value))
                  }
                }
              }

              // Set authorization with fresh access token from auth.json
              headers.set("authorization", `Bearer ${currentAuth.access}`)

              // Don't rewrite URL — pass through to fake server as-is
              return fetch(requestInput, { ...init, headers })
            },
          }
        },
        methods: [
          {
            type: "oauth",
            label: "Fake OAuth",
            authorize: async () => {
              if (!FAKE_OAUTH_BASE_URL) {
                throw new Error("FAKE_OAUTH_BASE_URL is required for fake OAuth")
              }

              return {
                method: "code" as const,
                url: `${FAKE_OAUTH_BASE_URL}/oauth/fake`,
                instructions: "Enter a fake user id or label as the authorization code. Use <label>:<usage> to create a new fake user, where usage is the initial request limit.",
                async callback(code: string) {
                  const response = await fetch(`${FAKE_OAUTH_BASE_URL}/oauth/fake/callback`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ code }),
                  })

                  if (!response.ok) {
                    return { type: "failed" as const }
                  }

                  const body = await response.json() as {
                    access_token: string
                    refresh_token: string
                    expires_in: number
                    account_id?: string
                  }

                  return {
                    type: "success" as const,
                    access: body.access_token,
                    refresh: body.refresh_token,
                    expires: Date.now() + body.expires_in * 1000,
                    ...(body.account_id && { accountId: body.account_id }),
                  }
                },
              }
            },
          },
        ],
      },
    }
  },
}

export default plugin
