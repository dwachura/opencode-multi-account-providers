import type { TuiPluginApi } from "@opencode-ai/plugin/tui"

export function openProviderAccountsDialog(api: TuiPluginApi) {
  api.ui.dialog.replace(() =>
    api.ui.DialogAlert({
      title: "Provider Accounts",
      message: "Multi-account management is not implemented yet.",
      onConfirm() {
        api.ui.dialog.clear()
      },
    }),
  )
}
