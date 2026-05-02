import type { Plugin, PluginModule } from "@opencode-ai/plugin"
import { PLUGIN_ID } from "../shared/constants.js"
import { readConfig } from "./config.js"
import { logPluginEvent } from "./logger.js"

const server: Plugin = async ({ client }, options) => {
  const config = readConfig(options)

  await logPluginEvent(client, config.logLevel, "server plugin initialized", {
    runtime: "server",
  })

  return {}
}

export default {
  id: PLUGIN_ID,
  server,
} satisfies PluginModule & { id: string }
