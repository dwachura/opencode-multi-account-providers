import { LOG_LEVELS, LogLevel } from "./logger.js"

export type PluginConfig = {
  logLevel: LogLevel
}

export const DEFAULT_CONFIG: PluginConfig = {
  logLevel: "info",
}

export function readConfig(options: unknown): PluginConfig {
  if (options === undefined) return { ...DEFAULT_CONFIG }
  if (!isRecord(options)) throw new TypeError("Plugin options must be an object")

  return {
    logLevel: readLogLevel(options.logLevel),
  }
}

function readLogLevel(value: unknown): LogLevel {
  if (value === undefined) return DEFAULT_CONFIG.logLevel
  if (typeof value !== "string" || !LOG_LEVELS.includes(value as LogLevel)) {
    throw new TypeError(`Invalid logLevel: ${String(value)}`)
  }
  return value as LogLevel
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
