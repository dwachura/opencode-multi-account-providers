const PROVIDER_ID = "auth-pool-mock"
const MODEL_ID = "mock-model"

const server = async (_input, options = {}) => {
  const baseURL = readBaseURL(options)

  return {
    async config(config) {
      config.provider ??= {}
      config.provider[PROVIDER_ID] ??= {
        id: PROVIDER_ID,
        name: "Auth Pool Mock",
        api: "openai-compatible",
        npm: "@ai-sdk/openai-compatible",
        options: {
          baseURL,
          apiKey: "mock-api-key",
        },
        models: {
          [MODEL_ID]: {
            name: "Mock Model",
            release_date: "2026-01-01",
            modalities: {
              input: ["text"],
              output: ["text"],
            },
            cost: {
              input: 0,
              output: 0,
            },
            limit: {
              context: 1024,
              output: 1024,
            },
          },
        },
      }
    },
    auth: {
      provider: PROVIDER_ID,
      methods: [
        {
          type: "oauth",
          label: "Mock OAuth",
          prompts: [
            {
              type: "text",
              key: "accountId",
              message: "Mock account ID",
              placeholder: "alice",
            },
          ],
          async authorize(inputs = {}) {
            const accountId = readAccountID(inputs)
            const authorization = await postJson(`${baseURL}/authorize`, { accountId })

            return {
              method: "code",
              url: authorization.url,
              instructions: `Open the mock OAuth URL and paste the shown code for ${accountId}.`,
              async callback(code) {
                const token = await postJson(`${baseURL}/token`, { code }).catch(() => undefined)
                if (!token) return { type: "failed" }
                return {
                  type: "success",
                  refresh: token.refresh,
                  access: token.access,
                  expires: token.expires,
                  accountId: token.accountId,
                }
              },
            }
          },
        },
      ],
    },
  }
}

export default {
  id: "auth-pool-mock-oauth-provider-plugin",
  server,
}

function readBaseURL(options) {
  if (typeof options.baseURL !== "string" || options.baseURL.length === 0) {
    throw new Error("mock OAuth provider plugin requires baseURL")
  }
  return options.baseURL.replace(/\/$/, "")
}

function readAccountID(inputs) {
  const accountId = inputs.accountId?.trim()
  if (!accountId) throw new Error("accountId is required")
  return accountId
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) throw new Error(`mock OAuth request failed: ${response.status}`)
  return response.json()
}
