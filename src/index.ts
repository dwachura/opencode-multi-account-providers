import type { PluginModule } from "@opencode-ai/plugin"
import { existsSync, watch, type FSWatcher } from "node:fs"
import { dirname, basename } from "node:path"
import * as storage from "./storage"
import * as rotation from "./rotation"
import * as identity from "./identity"
import openaiExtractor from "./identity-openai"
import fakeExtractor from "./identity-fake"

const PLUGIN_ID = "opencode-multi-account-providers"
const SERVICE = "plugin.multi-account"

// Register built-in identity extractors
identity.register("openai", openaiExtractor)
identity.register("fake", fakeExtractor)

function isRateLimitMessage(msg: string): boolean {
  if (msg === "Rate Limited" || msg === "Too Many Requests") return true
  const lower = msg.toLowerCase()
  return (
    lower.includes("rate limit") ||
    lower.includes("too many requests") ||
    lower.includes("rate increased too quickly")
  )
}

function toOAuthAccount(
  providerID: string,
  entry: storage.OAuthAuthEntry,
  extractor: identity.IdentityExtractor,
): storage.OAuthAccount | undefined {
  const id = extractor.extract(entry.access)
  if (!id) return undefined
  return {
    id: id.id,
    label: id.label ?? providerID,
    type: "oauth",
    access: entry.access,
    refresh: entry.refresh,
    expires: entry.expires,
    accountId: entry.accountId,
    enterpriseUrl: entry.enterpriseUrl,
  }
}

// ── auth.json file watcher ──
//
// Captures every change to auth.json and registers the new account in
// multi-auth storage. This catches every successful `opencode auth login`
// without depending on plugin auth-hook composition.

type WatcherController = {
  stop(): void
}

const watcherControllers = new Map<string, WatcherController>()

function createAuthJsonWatcher(input: {
  authJsonPath: string
  watcherKey: string
  onChange: () => void
  log: (level: "debug" | "info" | "warn" | "error", message: string, extra?: Record<string, unknown>) => void
}): WatcherController {
  const dir = dirname(input.authJsonPath)
  const filename = basename(input.authJsonPath)
  let watcher: FSWatcher | undefined
  let debounceTimer: ReturnType<typeof setTimeout> | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let retryLogged = false
  let needsInitialScan = false
  let stopped = false

  const clearRetry = () => {
    if (retryTimer) {
      clearTimeout(retryTimer)
      retryTimer = undefined
    }
  }

  const clearDebounce = () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = undefined
    }
  }

  const closeWatcher = () => {
    if (!watcher) return
    watcher.close()
    watcher = undefined
  }

  const scheduleRetry = (reason: "missing-dir" | "watch-error") => {
    if (stopped || retryTimer || watcher) return
    if (!retryLogged) {
      retryLogged = true
      needsInitialScan = true
      input.log(
        reason === "missing-dir" ? "info" : "warn",
        "auth.json watcher deferred; retrying",
        { dir, reason },
      )
    }
    retryTimer = setTimeout(() => {
      retryTimer = undefined
      start()
    }, 500)
  }

  const start = () => {
    if (stopped || watcher) return
    if (!existsSync(dir)) {
      scheduleRetry("missing-dir")
      return
    }

    clearRetry()

    try {
      watcher = watch(dir, { persistent: false }, (eventType, changedFile) => {
        if (changedFile !== filename) return
        if (eventType !== "change" && eventType !== "rename") return
        clearDebounce()
        debounceTimer = setTimeout(input.onChange, 50)
      })
      retryLogged = false
      input.log("debug", "auth.json watcher started", { dir, filename })
      if (needsInitialScan && existsSync(input.authJsonPath)) {
        clearDebounce()
        debounceTimer = setTimeout(input.onChange, 0)
        needsInitialScan = false
      }
      watcher.on("error", () => {
        closeWatcher()
        scheduleRetry("watch-error")
      })
    } catch {
      scheduleRetry("watch-error")
    }
  }

  start()

  return {
    stop() {
      stopped = true
      clearRetry()
      clearDebounce()
      closeWatcher()
    },
  }
}

const plugin: PluginModule = {
  id: PLUGIN_ID,
  server: async (input, options) => {
    const opts = (options ?? {}) as Record<string, unknown>
    if (typeof opts.provider !== "string" || !opts.provider) {
      throw new Error(`${SERVICE}: "provider" option is required`)
    }
    const managedProvider: string = opts.provider

    const extractor = identity.get(managedProvider)

    const log = (
      level: "debug" | "info" | "warn" | "error",
      message: string,
      extra?: Record<string, unknown>,
    ) => input.client.app.log({ body: { service: SERVICE, level, message, extra } })

    const toast = (
      variant: "info" | "success" | "warning" | "error",
      message: string,
      title?: string,
    ) =>
      input.client.tui.showToast({
        body: { variant, message, ...(title && { title }) },
      })

    const detectAccount = (origin: "watcher" | "chat"): void => {
      const entry = storage.readAuthJson(managedProvider)
      if (!entry) return
      const account = toOAuthAccount(managedProvider, entry, extractor)
      if (!account) {
        log("warn", "could not derive account identity from access token; skipping", {
          provider: managedProvider,
          origin,
        })
        return
      }
      const beforeCount = storage.read(managedProvider)?.accounts.length ?? 0
      const idx = storage.add(managedProvider, account)
      const afterCount = storage.read(managedProvider)?.accounts.length ?? 0
      const isNew = afterCount > beforeCount

      log("info", "captured account", {
        provider: managedProvider,
        origin,
        index: idx,
        total: afterCount,
        label: account.label,
        new: isNew,
      })

      // Only toast for watcher-originated changes — the user explicitly ran
      // `opencode auth login` and wants feedback. Skip toasts for cold-start
      // detection (first chat after plugin start).
      if (origin === "watcher") {
        if (isNew) {
          toast("success", `Captured new account for ${managedProvider}: ${account.label}`, PLUGIN_ID)
        } else {
          toast("info", `Refreshing credentials for the account ${account.label}`, PLUGIN_ID)
        }
      }
    }

    // Start the file watcher. Captures every login to auth.json (including
    // additional accounts) without depending on plugin auth-hook composition.
    const authJsonPath = storage.getAuthJsonPath()
    const watcherKey = `${authJsonPath}:${managedProvider}`
    watcherControllers.get(watcherKey)?.stop()
    watcherControllers.set(
      watcherKey,
      createAuthJsonWatcher({
        authJsonPath,
        watcherKey,
        onChange: () => detectAccount("watcher"),
        log: (level, message, extra) => {
          void log(level, message, { provider: managedProvider, watcherKey, ...extra })
        },
      }),
    )

    log("info", "initialized", { provider: managedProvider })

    return {
      "chat.params": async (hookInput) => {
        const providerID = hookInput.model.providerID
        if (providerID !== managedProvider) return

        const sessionID = hookInput.sessionID
        rotation.track(sessionID, providerID)

        if (rotation.consume(sessionID)) {
          const nextIdx = storage.next(providerID)
          if (nextIdx === undefined) {
            await log("warn", "all accounts exhausted, cannot rotate", { provider: providerID })
            await toast(
              "error",
              `All accounts for "${providerID}" are rate-limited`,
              PLUGIN_ID,
            )
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
          await toast("info", `Rotated to ${account.label}`, PLUGIN_ID)

          await input.client.auth.set({
            path: { id: providerID },
            body: {
              type: "oauth",
              refresh: account.refresh,
              access: account.access,
              expires: account.expires,
              ...(account.enterpriseUrl && { enterpriseUrl: account.enterpriseUrl }),
              ...(account.accountId && { accountId: account.accountId }),
            } as any,
          })
        } else {
          // Cold-start fallback: when auth.json existed before the plugin
          // started, no change event ever fires for it. Detect on first chat.
          detectAccount("chat")
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
            if (providerID === managedProvider) {
              const accountIdx = rotation.usedAccount(sessionID)
              if (accountIdx !== undefined) {
                const data = storage.read(providerID)
                const label = data?.accounts[accountIdx]?.label ?? `#${accountIdx}`
                log("info", "rate limit detected, exhausting account", {
                  provider: providerID,
                  index: accountIdx,
                  label,
                  message: status.message,
                })
                storage.exhaust(providerID, accountIdx)
                if (storage.next(providerID) !== undefined) {
                  await toast("warning", `Account ${label} is rate-limited`, PLUGIN_ID)
                }
              }
              rotation.flag(sessionID)
            }
          }
        }
      },
    }
  },
}

export default plugin
