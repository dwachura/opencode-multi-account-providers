import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { PluginApi } from "../shared/api.js"

export function openProviderAccountsDialog(api: TuiPluginApi, pluginApi: PluginApi) {
  void test(api, pluginApi);
}

async function test(api: TuiPluginApi, pluginApi: PluginApi): Promise<void> {
  const response = await pluginApi.health();
  api.ui.dialog.replace(() => {
    return api.ui.DialogAlert({
      title: "Provider Accounts",
      message: `Multi-account management is not implemented yet. API status ${response.status}`,
      onConfirm() {
        api.ui.dialog.clear()
      },
    })},
  )
}
