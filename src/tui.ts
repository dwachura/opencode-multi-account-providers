import type { TuiDialogSelectOption, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import * as storage from "./storage"

const PLUGIN_ID = "opencode-multi-account-providers"
const SERVICE = "plugin.multi-account"
const PROVIDER_ACCOUNTS_COMMAND = "provider-accounts"
const PROVIDER_ACCOUNTS_DESCRIPTION = "Manage stored provider accounts"

type RootDialogValue =
  | { kind: "action"; action: "add" | "reset" }
  | { kind: "account"; index: number }
  | { kind: "empty" }

type AccountDialogValue =
  | { kind: "action"; action: "switch" | "remove" }
  | { kind: "back" }

type ResetDialogValue =
  | { kind: "toggle"; index: number }
  | { kind: "action"; action: "apply" | "all" }
  | { kind: "back" }

function providerSummary(provider: string, data: storage.ProviderData | undefined): string {
  return `Provider: ${provider} | Accounts: ${data?.accounts.length ?? 0}`
}

function accountDescription(account: storage.OAuthAccount): string {
  const details = [`id: ${account.id}`]
  if (account.accountId) details.push(`accountId: ${account.accountId}`)
  return details.join(" | ")
}

function accountFooter(data: storage.ProviderData, index: number): string {
  const states: string[] = []
  if (index === data.active) states.push("active")
  if (data.exhausted.includes(index)) states.push("exhausted")
  return states.length > 0 ? states.join(" | ") : "stored"
}

function showNotImplementedToast(api: TuiPluginApi, message: string) {
  api.ui.toast({
    variant: "info",
    message,
  })
}

function toggleIndex(selected: number[], index: number) {
  return selected.includes(index)
    ? selected.filter((value) => value !== index)
    : [...selected, index].sort((a, b) => a - b)
}

function cloneProviderData(data: storage.ProviderData): storage.ProviderData {
  return {
    active: data.active,
    exhausted: [...data.exhausted],
    accounts: data.accounts.map((account) => ({ ...account })),
  }
}

async function syncProviderAuth(api: TuiPluginApi, provider: string, account: storage.OAuthAccount) {
  await api.client.auth.set({
    providerID: provider,
    auth: {
      type: "oauth",
      refresh: account.refresh,
      access: account.access,
      expires: account.expires,
      ...(account.enterpriseUrl && { enterpriseUrl: account.enterpriseUrl }),
      ...(account.accountId && { accountId: account.accountId }),
    } as any,
  })
}

async function removeProviderAuth(api: TuiPluginApi, provider: string) {
  await api.client.auth.remove({ providerID: provider })
}

function showProviderAccountsDialog(api: TuiPluginApi, provider: string) {
  const renderResetActions = (selected: number[] = []) => {
    const data = storage.read(provider)
    const exhausted = data?.exhausted.filter((index) => data.accounts[index]) ?? []
    const current = selected.filter((index) => exhausted.includes(index))

    return api.ui.DialogSelect({
      title: "Reset Exhausted Accounts",
      placeholder: `Exhausted accounts: ${exhausted.length} | Selected: ${current.length}`,
      options: [
        {
          title: "Apply selected",
          value: { kind: "action", action: "apply" },
          category: "Actions",
          description: "Clear exhausted markers for the selected accounts",
        },
        {
          title: "Reset all exhausted",
          value: { kind: "action", action: "all" },
          category: "Actions",
          description: "Clear exhausted markers for every exhausted account",
        },
        {
          title: "Back",
          value: { kind: "back" },
          category: "Navigation",
          description: "Return to the account list",
        },
        ...exhausted.map((index) => {
          const account = data!.accounts[index] as storage.OAuthAccount
          const selectedLabel = current.includes(index) ? "[x]" : "[ ]"
          return {
            title: `${selectedLabel} ${account.label}`,
            value: { kind: "toggle", index },
            category: "Exhausted",
            description: accountDescription(account),
            footer: index === data!.active ? "active | exhausted" : "exhausted",
          }
        }),
      ] as TuiDialogSelectOption<ResetDialogValue>[],
      skipFilter: true,
      onSelect(option) {
        const value = option.value
        if (value.kind === "back") {
          api.ui.dialog.replace(renderRoot)
          return
        }

        if (value.kind === "toggle") {
          api.ui.dialog.replace(() => renderResetActions(toggleIndex(current, value.index)))
          return
        }

        if (value.action === "apply") {
          if (current.length === 0) {
            api.ui.toast({
              variant: "info",
              message: "No exhausted accounts selected",
            })
            return
          }

          storage.reset(provider, current)
          api.ui.toast({
            variant: "success",
            message: `Reset ${current.length} exhausted account${current.length === 1 ? "" : "s"}`,
          })
          api.ui.dialog.replace(renderRoot)
          return
        }

        storage.reset(provider)
        api.ui.toast({
          variant: "success",
          message: "Reset all exhausted accounts",
        })
        api.ui.dialog.replace(renderRoot)
      },
    })
  }

  const renderRoot = () => {
    const data = storage.read(provider)
    const options: TuiDialogSelectOption<RootDialogValue>[] = [
      {
        title: "Add account",
        value: { kind: "action", action: "add" },
        category: "Actions",
        description: "Capture a new account through the normal auth flow",
      },
      {
        title: "Reset exhausted accounts",
        value: { kind: "action", action: "reset" },
        category: "Actions",
        description: "Clear exhausted markers for all stored accounts",
      },
    ]

    if (!data || data.accounts.length === 0) {
      options.push({
        title: "No stored accounts",
        value: { kind: "empty" },
        category: "Accounts",
        description: `Provider: ${provider}`,
        footer: "Accounts: 0",
      })
    } else {
      data.accounts.forEach((account, index) => {
        options.push({
          title: account.label,
          value: { kind: "account", index },
          category: "Accounts",
          description: accountDescription(account),
          footer: accountFooter(data, index),
        })
      })
    }

    return api.ui.DialogSelect({
      title: "Provider Accounts",
      placeholder: providerSummary(provider, data),
      options,
      skipFilter: true,
      onSelect(option) {
        const value = option.value
        if (value.kind === "account") {
          api.ui.dialog.replace(() => renderAccountActions(value.index))
          return
        }

        if (value.kind === "action") {
          if (value.action === "reset") {
            const exhausted = storage.read(provider)?.exhausted ?? []
            if (exhausted.length === 0) {
              api.ui.toast({
                variant: "info",
                message: "No exhausted accounts",
              })
              return
            }

            api.ui.dialog.replace(() => renderResetActions())
            return
          }

          showNotImplementedToast(api, `${option.title} is not implemented yet`)
        }
      },
    })
  }

  const renderAccountActions = (index: number) => {
    const data = storage.read(provider)
    const account = data?.accounts[index]
    if (!data || !account) {
      api.ui.toast({
        variant: "warning",
        message: "That account no longer exists",
      })
      return renderRoot()
    }

    const options: TuiDialogSelectOption<AccountDialogValue>[] = [
      {
        title: "Set active",
        value: { kind: "action", action: "switch" },
        category: "Actions",
        description: "Make this the active account for the next request",
      },
      {
        title: "Disconnect account",
        value: { kind: "action", action: "remove" },
        category: "Actions",
        description: "Remove this stored account and log out if it is the last one",
      },
      {
        title: "Back",
        value: { kind: "back" },
        category: "Navigation",
        description: "Return to the account list",
      },
    ]

    return api.ui.DialogSelect({
      title: `Provider Account: ${account.label}`,
      placeholder: `${accountDescription(account)} | ${accountFooter(data, index)}`,
      options,
      skipFilter: true,
      async onSelect(option) {
        const value = option.value
        if (value.kind === "back") {
          api.ui.dialog.replace(renderRoot)
          return
        }

        if (value.action === "switch") {
          const current = storage.read(provider)
          const next = current?.accounts[index]
          if (!current || !next || storage.fingerprint(next as storage.OAuthAccount) !== storage.fingerprint(account)) {
            api.ui.toast({
              variant: "warning",
              message: "That account no longer exists",
            })
            api.ui.dialog.replace(renderRoot)
            return
          }

          const previousActive = current.active
          storage.activate(provider, index)

          try {
            await syncProviderAuth(api, provider, next as storage.OAuthAccount)
          } catch {
            storage.activate(provider, previousActive)
            api.ui.toast({
              variant: "error",
              message: `Failed to set active account to ${next.label}`,
            })
            return
          }

          api.ui.toast({
            variant: "success",
            message: `Active account set to ${next.label}`,
          })
          api.ui.dialog.replace(renderRoot)
          return
        }

        if (value.action === "remove") {
          const current = storage.read(provider)
          const next = current?.accounts[index]
          if (!current || !next || storage.fingerprint(next as storage.OAuthAccount) !== storage.fingerprint(account)) {
            api.ui.toast({
              variant: "warning",
              message: "That account no longer exists",
            })
            api.ui.dialog.replace(renderRoot)
            return
          }

          const snapshot = cloneProviderData(current)
          const result = storage.remove(provider, index)
          if (result.status !== "removed") {
            api.ui.toast({
              variant: "warning",
              message: "That account no longer exists",
            })
            api.ui.dialog.replace(renderRoot)
            return
          }

          try {
            if (result.remainingCount === 0) {
              await removeProviderAuth(api, provider)
            } else if (result.removedWasActive && result.nextActive) {
              await syncProviderAuth(api, provider, result.nextActive)
            }
          } catch {
            storage.write(provider, snapshot)
            api.ui.toast({
              variant: "error",
              message: `Failed to remove account ${result.removed.label}`,
            })
            return
          }

          api.ui.toast({
            variant: "success",
            message: `Removed account ${result.removed.label}`,
          })
          api.ui.dialog.replace(renderRoot)
          return
        }

        showNotImplementedToast(api, `${option.title} is not implemented yet`)
      },
    })
  }

  api.ui.dialog.replace(renderRoot)
}

const plugin: TuiPluginModule = {
  id: PLUGIN_ID,
  tui: async (api, options) => {
    const opts = (options ?? {}) as Record<string, unknown>
    if (typeof opts.provider !== "string" || !opts.provider) {
      throw new Error(`${SERVICE}: "provider" option is required`)
    }

    storage.configure(api.state.path.state)

    api.command.register(() => [
      {
        title: "Provider Accounts",
        value: `/${PROVIDER_ACCOUNTS_COMMAND}`,
        description: PROVIDER_ACCOUNTS_DESCRIPTION,
        slash: { name: PROVIDER_ACCOUNTS_COMMAND },
        onSelect() {
          showProviderAccountsDialog(api, opts.provider as string)
        },
      },
    ])
  },
}

export default plugin
