import type { Plugin, PluginModule } from "@opencode-ai/plugin";
import { PLUGIN_ID } from "../shared/constants.js";
import { PluginContext } from "../shared/context.js";
import { Logger } from "../shared/logger.js";
import { PluginApiServer } from "./api-server.js";
import { openDb } from "./db.js";

const server: Plugin = async ({ client }, options) => {
  const context = await PluginContext.init({
    ...options,
    ...process.env,
  });
  LOGGER = Logger.init(client.app, "server", context.logLevel);
  const apiServer = await PluginApiServer.start();
  context.env.set("apiUrl", apiServer.url);
  LOGGER.log(`server plugin config loaded: ${JSON.stringify(context)}`);
  const db = openDb();
  LOGGER.log("server plugin initialized", undefined, { dbPath: db.path });
  return {
    async dispose() {
      await apiServer.stop();
      db.close();
    },
  };
};

export default {
  id: PLUGIN_ID,
  server,
} satisfies PluginModule & { id: string };

export let LOGGER!: Logger;
