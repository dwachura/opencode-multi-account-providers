import type { PluginModule } from "@opencode-ai/plugin"
import * as storage from "./storage"
import * as rotation from "./rotation"

const SERVICE = "plugin.multi-account"

function isRateLimitMessage(msg: string): boolean {
  if (msg === "Rate Limited" || msg === "Too Many Requests") return true
  const lower = msg.toLowerCase()
  return (
    lower.includes("rate limit") ||
    lower.includes("too many requests") ||
    lower.includes("rate increased too quickly")
  )
}

function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
  try {
    const parts = token.split(".")
    if (parts.length !== 3) return undefined
    const payload = Buffer.from(parts[1], "base64url").toString("utf-8")
    return JSON.parse(payload)
  } catch {
    return undefined
  }
}

function extractChatGptClaims(accessToken: string): { userId?: string; email?: string } {
  const claims = decodeJwtPayload(accessToken)
  if (!claims) return {}
  const authClaim = claims["https://api.openai.com/auth"] as Record<string, unknown> | undefined
  const profileClaim = claims["https://api.openai.com/profile"] as Record<string, unknown> | undefined
  return {
    userId: typeof authClaim?.chatgpt_account_user_id === "string" ? authClaim.chatgpt_account_user_id : undefined,
    email: typeof profileClaim?.email === "string" ? profileClaim.email : undefined,
  }
}

function toOAuthAccount(
  providerID: string,
  entry: storage.OAuthAuthEntry,
): storage.OAuthAccount {
  const { userId, email } = extractChatGptClaims(entry.access)
  return {
    userId: userId ?? entry.accountId,
    label: email ?? providerID,
    type: "oauth",
    access: entry.access,
    refresh: entry.refresh,
    expires: entry.expires,
    accountId: entry.accountId,
    enterpriseUrl: entry.enterpriseUrl,
  }
}

const plugin: PluginModule = {
  id: "opencode-multi-account-providers",
  server: async (input, options) => {
    const opts = (options ?? {}) as Record<string, unknown>
    const managedProviders: string[] = Array.isArray(opts.providers)
      ? (opts.providers as string[])
      : ["openai"]

    const log = (level: "debug" | "info" | "warn" | "error", message: string, extra?: Record<string, unknown>) =>
      input.client.app.log({ body: { service: SERVICE, level, message, extra } })

    log("info", "initialized", { providers: managedProviders })

    return {
      "chat.params": async (hookInput) => {
        const providerID = hookInput.model.providerID
        if (!managedProviders.includes(providerID)) return

        const sessionID = hookInput.sessionID
        rotation.track(sessionID, providerID)

        if (rotation.consume(sessionID)) {
          const nextIdx = storage.next(providerID)
          if (nextIdx === undefined) {
            await log("warn", "all accounts exhausted, cannot rotate", { provider: providerID })
            return
          }

          storage.activate(providerID, nextIdx)
          // Don't trackAccount here — the rotated credentials won't take effect
          // until the NEXT streamText() call. The current retry may still use
          // the old account's cached credentials. We update trackAccount only
          // on the normal path where the account is actually being used.
          const data = storage.read(providerID)
          if (!data) return
          const account = data.accounts[nextIdx] as storage.OAuthAccount

          await log("info", "rotating account", {
            provider: providerID,
            index: nextIdx,
            label: account.label,
          })

          await input.client.auth.set({
            path: { id: providerID },
            body: {
              type: "oauth",
              refresh: account.refresh,
              access: account.access,
              expires: account.expires,
              ...(account.enterpriseUrl && {
                enterpriseUrl: account.enterpriseUrl,
              }),
              ...(account.accountId && { accountId: account.accountId }),
            } as any,
          })
        } else {
          const authEntry = storage.readAuthJson(providerID)
          if (authEntry && authEntry.type === "oauth") {
            const idx = storage.add(providerID, toOAuthAccount(providerID, authEntry))
            const data = storage.read(providerID)
            await log("debug", "detected account", {
              provider: providerID,
              index: idx,
              total: data?.accounts.length,
            })
          }
          // Track which account is being used for this request
          const data = storage.read(providerID)
          if (data) {
            rotation.trackAccount(sessionID, data.active)
          }
        }
      },

      event: async ({ event }) => {
        if (
          event.type === "session.status" &&
          event.properties.status.type === "retry"
        ) {
          const { sessionID, status } = event.properties
          if (isRateLimitMessage(status.message)) {
            const providerID = rotation.provider(sessionID)
            if (providerID && managedProviders.includes(providerID)) {
              const accountIdx = rotation.usedAccount(sessionID)
              if (accountIdx !== undefined) {
                log("info", "rate limit detected, exhausting account", {
                  provider: providerID,
                  index: accountIdx,
                  message: status.message,
                })
                storage.exhaust(providerID, accountIdx)
              }
              rotation.flag(sessionID)
            }
          }
        }

        if (event.type === "session.created") {
          log("info", "new session, resetting exhaustion", {
            providers: managedProviders,
          })
          for (const providerID of managedProviders) {
            storage.reset(providerID)
          }
        }
      },
    }
  },
}

export default plugin
