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
        methods: [],
      },
    }
  },
}

export default plugin
