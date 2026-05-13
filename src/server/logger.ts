import { PLUGIN_ID } from "../shared/constants.js"

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const

export type LogLevel = (typeof LOG_LEVELS)[number]

type LogInput = {
  body: {
    service: string
    level: LogLevel
    message: string
    extra?: Record<string, unknown>
  }
}

type LogClient = {
  app?: {
    log?: (input: LogInput) => Promise<unknown>
  }
}

export async function logPluginEvent(
  client: unknown,
  level: LogLevel,
  message: string,
  extra?: Record<string, unknown>,
) {
  const app = (client as LogClient | undefined)?.app
  if (!app?.log) return

  await app.log({
    body: {
      service: PLUGIN_ID,
      level,
      message,
      extra,
    },
  }).catch(() => {})
}
