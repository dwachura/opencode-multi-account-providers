import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui";
import { PLUGIN_ID } from "../shared/constants.js";
import { PluginContext } from "../shared/context.js";
import { COMMAND_PROVIDER_ACCOUNTS } from "./constants.js";
import { openProviderAccountsDialog } from "./provider-accounts.js";
import { createPluginApiClient } from "./api-client.js";
import { Logger, LogLevel } from "../shared/logger.js";

const tui: TuiPlugin = async (api, options) => {
  const context = await PluginContext.init({
    ...options,
    ...process.env,
  });
  LOGGER = Logger.init(api.client.app, "server", context.logLevel);
  const apiClient = createPluginApiClient(await context.env.getRequired("apiUrl"));
  const dispose = api.keymap.registerLayer({
    commands: [
      {
        name: COMMAND_PROVIDER_ACCOUNTS,
        namespace: "palette",
        title: "Provider Accounts",
        desc: "Manage provider accounts",
        category: "Providers",
        slashName: COMMAND_PROVIDER_ACCOUNTS,
        run() {
          openProviderAccountsDialog(api, apiClient);
        },
      },
    ],
  });

  api.lifecycle.onDispose(dispose);
};

export default {
  id: PLUGIN_ID,
  tui,
} satisfies TuiPluginModule & { id: string };

export let LOGGER!: Logger;
