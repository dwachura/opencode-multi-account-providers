import type { TuiDialogSelectOption, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import * as storage from "./storage"

const PLUGIN_ID = "opencode-multi-account-providers"
const SERVICE = "plugin.multi-account"
const PROVIDER_ACCOUNTS_COMMAND = "provider-accounts"
const PROVIDER_ACCOUNTS_DESCRIPTION = "Manage stored provider accounts"

type RootDialogValue =
  | { kind: "action"; action: "connect" | "reset" }
  | { kind: "account"; index: number }
  | { kind: "empty" }

type AccountDialogValue =
  | { kind: "action"; action: "switch" | "remove" }
  | { kind: "back" }

type ResetDialogValue =
  | { kind: "toggle"; index: number }
  | { kind: "action"; action: "apply" | "all" }
  | { kind: "back" }

type ConnectDialogValue =
  | { kind: "mode"; mode: "preserve" | "activate" }
  | { kind: "back" }

type ConnectedAccount = {
  data: storage.ProviderData
  index: number
  account: storage.OAuthAccount
}

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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function findAccountIndexByFingerprint(data: storage.ProviderData, fingerprint: string) {
  return data.accounts.findIndex((account) => storage.fingerprint(account as storage.OAuthAccount) === fingerprint)
}

function matchesAuthEntry(account: storage.OAuthAccount, entry: storage.OAuthAuthEntry) {
  return account.access === entry.access && account.refresh === entry.refresh
}

function findConnectedAccount(provider: string): ConnectedAccount | undefined {
  const data = storage.read(provider)
  const entry = storage.readAuthJson(provider)
  if (!data || !entry) return undefined

  const index = data.accounts.findIndex((account) => matchesAuthEntry(account as storage.OAuthAccount, entry))
  if (index === -1) return undefined
  return {
    data,
    index,
    account: data.accounts[index] as storage.OAuthAccount,
  }
}

async function waitForConnectedAccount(provider: string, timeoutMs = 5_000, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const connected = findConnectedAccount(provider)
    if (connected) return connected
    await sleep(intervalMs)
  }
  return undefined
}

function showProviderAccountsDialog(api: TuiPluginApi, provider: string) {
  const connectHint = provider === "fake"
    ? "Fake codes: <label> or <label>:<usage> (usage = request limit)"
    : undefined

  const renderConnectActions = () => api.ui.DialogSelect({
    title: "Connect Account",
    placeholder: connectHint ? `Provider: ${provider} | ${connectHint}` : `Provider: ${provider}`,
    options: [
      {
        title: "Connect account",
        value: { kind: "mode", mode: "preserve" },
        category: "Actions",
        description: provider === "fake"
          ? "Connect fake code <label> or <label>:<usage>, then restore the previously active account"
          : "Connect a new account, then restore the previously active account",
      },
      {
        title: "Connect and activate",
        value: { kind: "mode", mode: "activate" },
        category: "Actions",
        description: provider === "fake"
          ? "Connect fake code <label> or <label>:<usage> and keep the new account active"
          : "Connect a new account and keep it active",
      },
      {
        title: "Back",
        value: { kind: "back" },
        category: "Navigation",
        description: "Return to the account list",
      },
    ] as TuiDialogSelectOption<ConnectDialogValue>[],
    skipFilter: true,
    async onSelect(option) {
      const value = option.value
      if (value.kind === "back") {
        api.ui.dialog.replace(renderRoot)
        return
      }

      const before = storage.read(provider)
      const beforeSnapshot = before ? cloneProviderData(before) : undefined
      const previousActive = beforeSnapshot?.accounts[beforeSnapshot.active] as storage.OAuthAccount | undefined
      const previousFingerprint = previousActive ? storage.fingerprint(previousActive) : undefined

      const methodsResult = await api.client.provider.auth({}) as any
      const methods = (methodsResult.data?.[provider] ?? []) as Array<{ type: string, label: string, prompts?: unknown[] }>
      const oauthIndex = methods.findIndex((method) => method.type === "oauth")
      if (oauthIndex === -1) {
        api.ui.toast({
          variant: "error",
          message: `No OAuth login method is available for ${provider}`,
        })
        return
      }

      const oauthMethod = methods[oauthIndex]
      if (oauthMethod?.prompts && oauthMethod.prompts.length > 0) {
        api.ui.toast({
          variant: "error",
          message: `Provider login prompts are not supported yet for ${provider}`,
        })
        return
      }

      const authorizeResult = await api.client.provider.oauth.authorize({
        providerID: provider,
        method: oauthIndex,
      }) as any
      if (authorizeResult.error || !authorizeResult.data) {
        api.ui.toast({
          variant: "error",
          message: `Failed to start account connection for ${provider}`,
        })
        return
      }

      const completeConnect = async (code?: string) => {
        const callbackResult = await api.client.provider.oauth.callback({
          providerID: provider,
          method: oauthIndex,
          ...(code ? { code } : {}),
        }) as any
        if (callbackResult.error) {
          api.ui.toast({
            variant: "error",
            message: `Failed to complete account connection for ${provider}`,
          })
          return
        }

        const connected = await waitForConnectedAccount(provider)
        if (!connected) {
          api.ui.toast({
            variant: "error",
            message: `Timed out waiting for ${provider} account capture`,
          })
          api.ui.dialog.replace(renderRoot)
          return
        }

        if (value.mode === "preserve" && previousFingerprint) {
          const previousIndex = findAccountIndexByFingerprint(connected.data, previousFingerprint)
          if (previousIndex !== -1 && previousIndex !== connected.index) {
            storage.activate(provider, previousIndex)
            try {
              await syncProviderAuth(api, provider, connected.data.accounts[previousIndex] as storage.OAuthAccount)
            } catch {
              storage.activate(provider, connected.index)
              api.ui.toast({
                variant: "error",
                message: `Connected ${connected.account.label} but failed to restore the previous active account`,
              })
              api.ui.dialog.replace(renderRoot)
              return
            }
          }

          api.ui.toast({
            variant: "success",
            message: `Connected account ${connected.account.label}`,
          })
          api.ui.dialog.replace(renderRoot)
          return
        }

        storage.activate(provider, connected.index)
        api.ui.toast({
          variant: "success",
          message: value.mode === "activate"
            ? `Connected and activated ${connected.account.label}`
            : `Connected account ${connected.account.label}`,
        })
        api.ui.dialog.replace(renderRoot)
      }

      if (authorizeResult.data.method === "auto") {
        api.ui.dialog.replace(() => api.ui.DialogAlert({
          title: "Connect Account",
          message: `${authorizeResult.data.instructions}\n${authorizeResult.data.url}\n\nPress Enter after finishing login in your browser.`,
          async onConfirm() {
            await completeConnect()
          },
        }))
        return
      }

      api.ui.dialog.replace(() => api.ui.DialogPrompt({
        title: "Connect Account",
        placeholder: provider === "fake"
          ? "Authorization code (alpha or alpha:2, where 2 is the request limit)"
          : "Authorization code",
        async onConfirm(code) {
          await completeConnect(code)
        },
        onCancel() {
          api.ui.dialog.replace(renderRoot)
        },
      }))
    },
  })

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
        title: "Connect account",
        value: { kind: "action", action: "connect" },
        category: "Actions",
        description: "Connect a new account through the provider login flow",
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
          if (value.action === "connect") {
            api.ui.dialog.replace(renderConnectActions)
            return
          }

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
