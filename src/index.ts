import type { PluginModule } from "@opencode-ai/plugin"
import { appendFileSync, existsSync, mkdirSync, watch, type FSWatcher } from "node:fs"
import { dirname, basename } from "node:path"
import * as storage from "./storage"
import * as rotation from "./rotation"
import * as identity from "./identity"
import openaiExtractor from "./identity-openai"

const PLUGIN_ID = "opencode-multi-account-providers"
const SERVICE = "plugin.multi-account"

type LogLevel = "debug" | "info" | "warn" | "error"

// Register built-in identity extractors
identity.register("openai", openaiExtractor)

type PluginOptions = {
  enableDefaultExtractor?: boolean
}

function isRateLimitMessage(msg: string): boolean {
  if (msg === "Rate Limited" || msg === "Too Many Requests") return true
  const lower = msg.toLowerCase()
  return (
    lower.includes("rate limit") ||
    lower.includes("too many requests") ||
    lower.includes("rate increased too quickly") ||
    lower.includes("usage limit") ||
    lower.includes("quota exceeded") ||
    lower.includes("insufficient_quota")
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

function mapAuthBody(account: storage.OAuthAccount) {
  return {
    type: "oauth",
    refresh: account.refresh,
    access: account.access,
    expires: account.expires,
    ...(account.enterpriseUrl && { enterpriseUrl: account.enterpriseUrl }),
    ...(account.accountId && { accountId: account.accountId }),
  } as any
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForActiveAccountFingerprint(
  providerID: string,
  fingerprint: string,
  timeoutMs = 5_000,
  intervalMs = 100,
) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const data = storage.read(providerID)
    if (data && data.active !== null) {
      const account = data.accounts[data.active] as storage.OAuthAccount | undefined
      if (account && storage.fingerprint(account) === fingerprint) {
        return { data, index: data.active, account }
      }
    }
    await sleep(intervalMs)
  }
  return undefined
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
  log: (level: LogLevel, message: string, extra?: Record<string, unknown>) => void
}): WatcherController {
  const dir = dirname(input.authJsonPath)
  const filename = basename(input.authJsonPath)
  let watcher: FSWatcher | undefined
  let debounceTimer: ReturnType<typeof setTimeout> | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let retryLogged = false
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

  const scheduleScan = (delayMs: number) => {
    clearDebounce()
    debounceTimer = setTimeout(input.onChange, delayMs)
  }

  const scheduleRetry = (reason: "missing-dir" | "watch-error") => {
    if (stopped || retryTimer || watcher) return
    if (!retryLogged) {
      retryLogged = true
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
        if (eventType !== "change" && eventType !== "rename") return
        const rawChangedFile = changedFile as string | Uint8Array | null | undefined
        const changedName = typeof rawChangedFile === "string"
          ? rawChangedFile
          : rawChangedFile != null
            ? String(rawChangedFile)
            : undefined
        if (changedName && changedName !== filename) return
        scheduleScan(50)
      })
      retryLogged = false
      input.log("debug", "auth.json watcher started", { dir, filename })
      if (existsSync(input.authJsonPath)) {
        scheduleScan(0)
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
    const pluginOptions = (options ?? {}) as PluginOptions
    const enableDefaultExtractor = pluginOptions.enableDefaultExtractor === true
    const pluginLogPath = storage.getLogPath()

    const log = (
      level: LogLevel,
      message: string,
      extra?: Record<string, unknown>,
    ) => input.client.app.log({ body: { service: SERVICE, level, message, extra } })

    const writeFileLog = (level: LogLevel, message: string, extra?: Record<string, unknown>) => {
      try {
        mkdirSync(dirname(pluginLogPath), { recursive: true })
        appendFileSync(
          pluginLogPath,
          `${JSON.stringify({
            ts: new Date().toISOString(),
            service: SERVICE,
            level,
            message,
            ...extra,
          })}\n`,
          "utf8",
        )
      } catch {}
    }

    const debugLog = async (level: LogLevel, message: string, extra?: Record<string, unknown>) => {
      writeFileLog(level, message, extra)
      await log(level, message, extra)
    }

    const toast = (
      variant: "info" | "success" | "warning" | "error",
      message: string,
      title?: string,
    ) =>
      input.client.tui.showToast({
        body: { variant, message, ...(title && { title }) },
      })

    const reconcileProvider = (
      providerID: string,
      entry: storage.OAuthAuthEntry,
      origin: "startup" | "watcher",
      at = Date.now(),
    ): void => {
      const extractor = identity.get(providerID, enableDefaultExtractor)
      if (!extractor) {
        void debugLog("warn", "no identity extractor registered for provider; skipping", {
          provider: providerID,
          origin,
          enableDefaultExtractor,
        })
        return
      }
      let account: storage.OAuthAccount | undefined
      try {
        account = toOAuthAccount(providerID, entry, extractor)
      } catch (error) {
        void debugLog("warn", "could not derive account identity from access token; skipping", {
          provider: providerID,
          origin,
          error: error instanceof Error ? error.message : String(error),
        })
        return
      }
      if (!account) {
        void debugLog("warn", "could not derive account identity from access token; skipping", {
          provider: providerID,
          origin,
        })
        return
      }
      const beforeCount = storage.read(providerID)?.accounts.length ?? 0
      const idx = storage.add(providerID, account)
      storage.activate(providerID, idx)
      const after = storage.read(providerID)
      const afterCount = after?.accounts.length ?? 0
      const isNew = afterCount > beforeCount
      const fp = storage.fingerprint(account)
      rotation.openAuth(providerID, account.id, fp, at)

      void debugLog("info", isNew ? "captured new account" : "captured existing account", {
        provider: providerID,
        origin,
        index: idx,
        total: afterCount,
        id: account.id,
        label: account.label,
        accountId: account.accountId,
        new: isNew,
      })

      if (origin === "watcher") {
        if (isNew) {
          toast("success", `Captured new account for ${providerID}: ${account.label}`, PLUGIN_ID)
        } else {
          toast("info", `Refreshing credentials for the account ${account.label}`, PLUGIN_ID)
        }
      }
    }

    const reconcileAllAuth = (origin: "startup" | "watcher"): void => {
      const at = Date.now()
      const entries = storage.readAllAuthJson()
      const activeProviders = new Set(Object.keys(entries))

      for (const [providerID, entry] of Object.entries(entries)) {
        reconcileProvider(providerID, entry, origin, at)
      }

      const knownProviders = new Set([
        ...storage.listProviders(),
        ...rotation.providers(),
      ])

      for (const providerID of knownProviders) {
        if (activeProviders.has(providerID)) continue
        const data = storage.read(providerID)
        if (data?.active !== null) storage.activate(providerID, null)
        rotation.closeAuth(providerID, at)
      }
    }

    // Start the file watcher. Captures every login to auth.json (including
    // additional accounts) without depending on plugin auth-hook composition.
    const authJsonPath = storage.getAuthJsonPath()
    const watcherKey = authJsonPath
    watcherControllers.get(watcherKey)?.stop()
    watcherControllers.set(
        watcherKey,
        createAuthJsonWatcher({
          authJsonPath,
          watcherKey,
          onChange: () => {
            reconcileAllAuth("watcher")
          },
          log: (level, message, extra) => {
            void log(level, message, { watcherKey, ...extra })
          },
      }),
    )

    void debugLog("info", "initialized", { logPath: pluginLogPath })

    return {
      "chat.params": async (hookInput) => {
        const providerID = hookInput.model.providerID

        const sessionID = hookInput.sessionID
        rotation.trackRequest(sessionID, providerID)
        await debugLog("debug", "chat.params provider matched", {
          sessionID,
          provider: providerID,
        })

        const consumed = rotation.consume(sessionID)
        const before = storage.read(providerID)
        await debugLog("debug", "rotation consume evaluated", {
          sessionID,
          provider: providerID,
          consumed,
          accountCount: before?.accounts.length ?? 0,
          activeIndex: before?.active,
          exhausted: before?.exhausted ?? [],
        })

        if (consumed) {
          const nextIdx = storage.next(providerID)
          await debugLog("info", "rotation candidate evaluated", {
            sessionID,
            provider: providerID,
            nextIdx,
          })
          if (nextIdx === undefined) {
            const message = `All accounts for "${providerID}" are rate-limited`
            await debugLog("warn", "all accounts exhausted, cannot rotate", {
              provider: providerID,
              sessionID,
            })
            await toast(
              "error",
              message,
              PLUGIN_ID,
            )
            throw new Error(message)
          }

          const data = storage.read(providerID)
          if (!data) return
          const account = data.accounts[nextIdx] as storage.OAuthAccount

          await debugLog("info", "rotating account", {
            provider: providerID,
            sessionID,
            index: nextIdx,
            label: account.label,
            accountId: account.accountId,
          })
          await toast("info", `Rotated to ${account.label}`, PLUGIN_ID)

          await debugLog("info", "rotation auth.set starting", {
            provider: providerID,
            sessionID,
            index: nextIdx,
            label: account.label,
          })
          await input.client.auth.set({
            path: { id: providerID },
            body: mapAuthBody(account),
          })
          const reconciled = await waitForActiveAccountFingerprint(
            providerID,
            storage.fingerprint(account),
          )
          await debugLog("info", "rotation auth.set completed", {
            provider: providerID,
            sessionID,
            index: nextIdx,
            label: account.label,
            reconciled: !!reconciled,
            reconciledIndex: reconciled?.index,
          })
          if (!reconciled) {
            await debugLog("warn", "rotation auth.set completed before storage reconciliation", {
              provider: providerID,
              sessionID,
              index: nextIdx,
              label: account.label,
            })
          }
        }
      },

      event: async ({ event }) => {
        if (
          event.type === "session.status" &&
          event.properties.status.type === "retry"
        ) {
          const { sessionID, status } = event.properties
          const request = rotation.request(sessionID)
          const matchesRateLimit = isRateLimitMessage(status.message)
          const timelineMatch = request ? rotation.authAt(request.providerID, request.startedAt) : undefined
          const resolved = timelineMatch
            ? storage.findByFingerprint(timelineMatch.providerID, timelineMatch.fingerprint)
            : undefined
          await debugLog("info", "retry event observed", {
            sessionID,
            trackedProvider: request?.providerID,
            requestStartedAt: request?.startedAt,
            timelineFingerprint: timelineMatch?.fingerprint,
            timelineAccountID: timelineMatch?.accountID,
            trackedAccountIndex: resolved?.index,
            retryMessage: status.message,
            matchesRateLimit,
          })
          if (!matchesRateLimit) {
            await debugLog("debug", "retry event ignored: message did not match rate-limit predicate", {
              sessionID,
              trackedProvider: request?.providerID,
              retryMessage: status.message,
            })
            return
          }
          if (!request) {
            await debugLog("debug", "retry event ignored: session request context missing", {
              sessionID,
            })
            return
          }
          if (!timelineMatch) {
            await debugLog("warn", "retry event ignored: no auth interval matched request time", {
              sessionID,
              provider: request.providerID,
              requestStartedAt: request.startedAt,
              retryMessage: status.message,
            })
            return
          }
          if (!resolved) {
            await debugLog("warn", "retry event skipped: historical account no longer maps to storage", {
              sessionID,
              provider: request.providerID,
              requestStartedAt: request.startedAt,
              fingerprint: timelineMatch.fingerprint,
              accountID: timelineMatch.accountID,
              retryMessage: status.message,
            })
            return
          }

          const data = storage.read(request.providerID)
          const label = data?.accounts[resolved.index]?.label ?? `#${resolved.index}`
          await debugLog("info", "rate limit detected, exhausting account", {
            provider: request.providerID,
            sessionID,
            index: resolved.index,
            label,
            message: status.message,
          })
          storage.exhaust(request.providerID, resolved.index)
          await debugLog("info", "account exhausted", {
            provider: request.providerID,
            sessionID,
            index: resolved.index,
            label,
            nextIdx: storage.next(request.providerID),
          })
          if (storage.next(request.providerID) !== undefined) {
            await toast("warning", `Account ${label} is rate-limited`, PLUGIN_ID)
          }
          rotation.flag(sessionID)
          await debugLog("info", "rotation flagged", {
            provider: request.providerID,
            sessionID,
            index: resolved.index,
            label,
          })
        }
      },
    }
  },
}

export default plugin
