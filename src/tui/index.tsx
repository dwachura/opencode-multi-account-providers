import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { PLUGIN_ID } from "../shared/constants.js"
import { COMMAND_PROVIDER_ACCOUNTS } from "./constants.js"
import { openProviderAccountsDialog } from "./provider-accounts.js"

const tui: TuiPlugin = async (api) => {
  const dispose = api.command.register(() => [
    {
      title: "Provider Accounts",
      value: COMMAND_PROVIDER_ACCOUNTS,
      description: "Manage provider accounts",
      category: "Providers",
      slash: {
        name: COMMAND_PROVIDER_ACCOUNTS,
      },
      onSelect() {
        openProviderAccountsDialog(api)
      },
    },
  ])

  api.lifecycle.onDispose(dispose)
}

export default {
  id: PLUGIN_ID,
  tui,
} satisfies TuiPluginModule & { id: string }
