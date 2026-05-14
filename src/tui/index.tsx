import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { PLUGIN_ID } from "../shared/constants.js"
import { COMMAND_PROVIDER_ACCOUNTS } from "./constants.js"
import { openProviderAccountsDialog } from "./provider-accounts.js"

const tui: TuiPlugin = async (api) => {
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
          openProviderAccountsDialog(api)
        },
      },
    ],
  })

  api.lifecycle.onDispose(dispose)
}

export default {
  id: PLUGIN_ID,
  tui,
} satisfies TuiPluginModule & { id: string }
