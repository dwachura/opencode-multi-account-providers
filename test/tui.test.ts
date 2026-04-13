import { beforeEach, describe, expect, mock, test } from "bun:test"
import { join } from "node:path"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import * as storage from "../src/storage"
import plugin from "../src/tui"

let testDir: string
let registeredCommands: (() => any[]) | undefined
let renderedDialogs: any[]
let toasts: any[]
let authSetCalls: any[]
let authRemoveCalls: any[]
let providerAuthCalls: any[]
let providerAuthorizeCalls: any[]
let providerCallbackCalls: any[]

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "multi-account-plugin-tui-test-"))
  storage.configure(testDir)
  registeredCommands = undefined
  renderedDialogs = []
  toasts = []
  authSetCalls = []
  authRemoveCalls = []
  providerAuthCalls = []
  providerAuthorizeCalls = []
  providerCallbackCalls = []
})

function writeOAuthAuth(provider: string, account: storage.OAuthAccount) {
  writeFileSync(join(testDir, "auth.json"), JSON.stringify({
    [provider]: {
      type: "oauth",
      access: account.access,
      refresh: account.refresh,
      expires: account.expires,
      ...(account.accountId ? { accountId: account.accountId } : {}),
      ...(account.enterpriseUrl ? { enterpriseUrl: account.enterpriseUrl } : {}),
    },
  }))
}

function createApi(options: {
  authSetError?: Error,
  authRemoveError?: Error,
  providerMethods?: Array<{ type: string, label: string, prompts?: unknown[] }>,
  providerAuthData?: Record<string, Array<{ type: string, label: string, prompts?: unknown[] }>>,
  authorizeResult?: any,
  callbackError?: unknown,
  callbackHandler?: (input: any) => void | Promise<void>,
  statePath?: string,
} = {}) {
  return {
    state: {
      path: {
        state: options.statePath ?? testDir,
      },
    },
    command: {
      register: mock((cb: () => any[]) => {
        registeredCommands = cb
        return () => {}
      }),
    },
    client: {
      auth: {
        set: mock(async (input: any) => {
          authSetCalls.push(input)
          if (options.authSetError) throw options.authSetError
        }),
        remove: mock(async (input: any) => {
          authRemoveCalls.push(input)
          if (options.authRemoveError) throw options.authRemoveError
        }),
      },
      provider: {
        auth: mock(async (input: any) => {
          providerAuthCalls.push(input)
          return {
            data: options.providerAuthData ?? {
              openai: options.providerMethods ?? [{ type: "oauth", label: "Browser login" }],
            },
          }
        }),
        oauth: {
          authorize: mock(async (input: any) => {
            providerAuthorizeCalls.push(input)
            return options.authorizeResult ?? {
              data: {
                method: "code",
                url: "https://example.com/connect",
                instructions: "Open the browser login",
              },
            }
          }),
          callback: mock(async (input: any) => {
            providerCallbackCalls.push(input)
            await options.callbackHandler?.(input)
            return options.callbackError
              ? { error: options.callbackError }
              : { data: true }
          }),
        },
      },
    },
    ui: {
      DialogAlert: mock((props: any) => props),
      DialogPrompt: mock((props: any) => props),
      DialogSelect: mock((props: any) => props),
      toast: mock((input: any) => {
        toasts.push(input)
      }),
      dialog: {
        replace: mock((render: () => unknown) => {
          const value = render()
          if (value && typeof (value as Promise<unknown>).then === "function") {
            void (value as Promise<unknown>).then((resolved) => {
              renderedDialogs.push(resolved)
            })
            return
          }
          renderedDialogs.push(value)
        }),
      },
    },
  }
}

async function openProviderPicker() {
  await registeredCommands!()[0].onSelect()
  for (let i = 0; i < 10 && renderedDialogs.length === 0; i++) {
    await Promise.resolve()
  }
  return renderedDialogs[0]
}

async function openProviderAccounts(provider = "openai") {
  const picker = await openProviderPicker()
  const option = picker.options.find((entry: any) => entry.value.kind === "provider" && entry.value.provider === provider)
  await picker.onSelect(option)
  await Promise.resolve()
  const root = renderedDialogs[1]
  renderedDialogs = [root]
  return root
}

describe("tui plugin module", () => {
  test("has correct id", () => {
    expect(plugin.id).toBe("opencode-multi-account-providers")
  })

  test("registers local provider-accounts command", async () => {
    const api = createApi({
      providerAuthData: {
        fake: [{ type: "oauth", label: "Fake OAuth" }],
      },
    })
    await plugin.tui(api as any, { provider: "openai" } as any, {} as any)

    expect(api.command.register).toHaveBeenCalledTimes(1)
    expect(registeredCommands).toBeDefined()
    expect(registeredCommands!()).toEqual([
      {
        title: "Provider Accounts",
        value: "/provider-accounts",
        description: "Manage stored provider accounts",
        slash: { name: "provider-accounts" },
        onSelect: expect.any(Function),
      },
    ])
  })

  test("shows empty state in dialog", async () => {
    const api = createApi()
    await plugin.tui(api as any, { provider: "openai" } as any, {} as any)

    const picker = await openProviderPicker()
    await picker.onSelect(picker.options[0])

    expect(api.ui.dialog.replace).toHaveBeenCalledTimes(2)
    expect(renderedDialogs).toEqual([
      {
        title: "Provider Accounts",
        placeholder: "Providers: 1",
        options: [
          {
            title: "openai",
            value: { kind: "provider", provider: "openai" },
            category: "Providers",
            description: "Accounts: 0 | OAuth available",
            footer: undefined,
          },
        ],
        skipFilter: true,
        onSelect: expect.any(Function),
      },
      {
        title: "Provider Accounts",
        placeholder: "Provider: openai | Accounts: 0",
        options: [
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
          {
            title: "No stored accounts",
            value: { kind: "empty" },
            category: "Accounts",
            description: "Provider: openai",
            footer: "Accounts: 0",
          },
        ],
        skipFilter: true,
        onSelect: expect.any(Function),
      },
    ])
  })

  test("picker filters out providers without oauth unless accounts are already stored", async () => {
    storage.add("gitlab", {
      id: "user_gitlab",
      label: "gitlab-user",
      type: "oauth",
      access: "access-gitlab",
      refresh: "refresh-gitlab",
      expires: Date.now() + 3600_000,
    })

    const api = createApi({
      providerAuthData: {
        openai: [{ type: "oauth", label: "Browser login" }],
        "github-copilot": [{ type: "api", label: "API key" }],
        poe: [{ type: "api", label: "API key" }],
      },
    })
    await plugin.tui(api as any, {}, {} as any)

    const picker = await openProviderPicker()

    expect(picker.options).toEqual([
      {
        title: "gitlab",
        value: { kind: "provider", provider: "gitlab" },
        category: "Providers",
        description: "Accounts: 1 | Stored accounts only",
        footer: "Provider: gitlab | Accounts: 1",
      },
      {
        title: "openai",
        value: { kind: "provider", provider: "openai" },
        category: "Providers",
        description: "Accounts: 0 | OAuth available",
        footer: undefined,
      },
    ])
  })

  test("uses shared configured storage instead of api.state.path.state", async () => {
    const wrongPath = mkdtempSync(join(tmpdir(), "multi-account-plugin-tui-wrong-state-"))
    storage.add("openai", {
      id: "user_a",
      label: "personal",
      type: "oauth",
      access: "access-a",
      refresh: "refresh-a",
      expires: Date.now() + 3600_000,
      accountId: "acct_a",
    })

    const api = createApi({ statePath: wrongPath })
    await plugin.tui(api as any, { provider: "openai" } as any, {} as any)

    const picker = await openProviderPicker()
    await picker.onSelect(picker.options[0])

    expect(renderedDialogs[1]).toEqual({
      title: "Provider Accounts",
      placeholder: "Provider: openai | Accounts: 1",
      options: [
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
        {
          title: "personal",
          value: { kind: "account", index: 0 },
          category: "Accounts",
          description: "id: user_a | accountId: acct_a",
          footer: "active",
        },
      ],
      skipFilter: true,
      onSelect: expect.any(Function),
    })
  })

  test("lists stored accounts with active and exhausted markers", async () => {
    storage.add("openai", {
      id: "user_a",
      label: "personal",
      type: "oauth",
      access: "access-a",
      refresh: "refresh-a",
      expires: Date.now() + 3600_000,
      accountId: "acct_a",
    })
    storage.add("openai", {
      id: "user_b",
      label: "work",
      type: "oauth",
      access: "access-b",
      refresh: "refresh-b",
      expires: Date.now() + 3600_000,
      accountId: "acct_b",
    })
    storage.activate("openai", 0)
    storage.exhaust("openai", 1)

    const api = createApi()
    await plugin.tui(api as any, { provider: "openai" } as any, {} as any)

    const picker = await openProviderPicker()
    await picker.onSelect(picker.options[0])

    expect(renderedDialogs).toEqual([
      {
        title: "Provider Accounts",
        placeholder: "Providers: 1",
        options: [
          {
            title: "openai",
            value: { kind: "provider", provider: "openai" },
            category: "Providers",
            description: "Accounts: 2 | OAuth available",
            footer: "Provider: openai | Accounts: 2",
          },
        ],
        skipFilter: true,
        onSelect: expect.any(Function),
      },
      {
        title: "Provider Accounts",
        placeholder: "Provider: openai | Accounts: 2",
        options: [
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
          {
            title: "personal",
            value: { kind: "account", index: 0 },
            category: "Accounts",
            description: "id: user_a | accountId: acct_a",
            footer: "active",
          },
          {
            title: "work",
            value: { kind: "account", index: 1 },
            category: "Accounts",
            description: "id: user_b | accountId: acct_b",
            footer: "exhausted",
          },
        ],
        skipFilter: true,
        onSelect: expect.any(Function),
      },
    ])
  })

  test("selecting an account opens nested account actions dialog", async () => {
    storage.add("openai", {
      id: "user_a",
      label: "personal",
      type: "oauth",
      access: "access-a",
      refresh: "refresh-a",
      expires: Date.now() + 3600_000,
      accountId: "acct_a",
    })

    const api = createApi()
    await plugin.tui(api as any, { provider: "openai" } as any, {} as any)

    const root = await openProviderAccounts()
    root.onSelect(root.options[2])

    expect(renderedDialogs[1]).toEqual({
      title: "Provider Account: personal",
      placeholder: "id: user_a | accountId: acct_a | active",
      options: [
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
      ],
      skipFilter: true,
      onSelect: expect.any(Function),
    })
  })

  test("connect action opens mode dialog", async () => {
    const api = createApi()
    await plugin.tui(api as any, { provider: "openai" } as any, {} as any)

    const root = await openProviderAccounts()
    root.onSelect(root.options[0])

    expect(renderedDialogs[1]).toEqual({
      title: "Connect Account",
      placeholder: "Provider: openai",
      options: [
        {
          title: "Connect account",
          value: { kind: "mode", mode: "preserve" },
          category: "Actions",
          description: "Connect a new account, then restore the previously active account",
        },
        {
          title: "Connect and activate",
          value: { kind: "mode", mode: "activate" },
          category: "Actions",
          description: "Connect a new account and keep it active",
        },
        {
          title: "Back",
          value: { kind: "back" },
          category: "Navigation",
          description: "Return to the account list",
        },
      ],
      skipFilter: true,
      onSelect: expect.any(Function),
    })
  })

  test("fake provider connect dialog shows code format hint", async () => {
    const api = createApi({
      providerAuthData: {
        fake: [{ type: "oauth", label: "Fake OAuth" }],
      },
    })
    await plugin.tui(api as any, { provider: "fake" } as any, {} as any)

    const root = await openProviderAccounts("fake")
    await root.onSelect(root.options[0])

    expect(renderedDialogs[1]).toEqual({
      title: "Connect Account",
      placeholder: "Provider: fake | Fake codes: <label> or <label>:<usage> (usage = request limit)",
      options: [
        {
          title: "Connect account",
          value: { kind: "mode", mode: "preserve" },
          category: "Actions",
          description: "Connect fake code <label> or <label>:<usage>, then restore the previously active account",
        },
        {
          title: "Connect and activate",
          value: { kind: "mode", mode: "activate" },
          category: "Actions",
          description: "Connect fake code <label> or <label>:<usage> and keep the new account active",
        },
        {
          title: "Back",
          value: { kind: "back" },
          category: "Navigation",
          description: "Return to the account list",
        },
      ],
      skipFilter: true,
      onSelect: expect.any(Function),
    })

    const connect = renderedDialogs[1]
    await connect.onSelect(connect.options[0])
    expect(renderedDialogs[2]).toEqual({
      title: "Connect Account",
      placeholder: "Authorization code (alpha or alpha:2, where 2 is the request limit)",
      onConfirm: expect.any(Function),
      onCancel: expect.any(Function),
    })
  })

  test("connect account restores the previously active account by default", async () => {
    const personal: storage.OAuthAccount = {
      id: "user_a",
      label: "personal",
      type: "oauth",
      access: "access-a",
      refresh: "refresh-a",
      expires: Date.now() + 3600_000,
      accountId: "acct_a",
    }
    const work: storage.OAuthAccount = {
      id: "user_b",
      label: "work",
      type: "oauth",
      access: "access-b",
      refresh: "refresh-b",
      expires: Date.now() + 3600_000,
      accountId: "acct_b",
    }
    storage.add("openai", personal)
    storage.activate("openai", 0)

    const api = createApi({
      callbackHandler: async () => {
        writeOAuthAuth("openai", work)
        storage.add("openai", work)
      },
    })
    await plugin.tui(api as any, { provider: "openai" } as any, {} as any)

    const root = await openProviderAccounts()
    await root.onSelect(root.options[0])
    const connect = renderedDialogs[1]
    await connect.onSelect(connect.options[0])
    const prompt = renderedDialogs[2]
    await prompt.onConfirm("test-code")

    expect(providerAuthCalls).toEqual([{}, {}])
    expect(providerAuthorizeCalls).toEqual([{ providerID: "openai", method: 0 }])
    expect(providerCallbackCalls).toEqual([{ providerID: "openai", method: 0, code: "test-code" }])
    expect(storage.read("openai")?.active).toBe(0)
    expect(authSetCalls).toEqual([
      {
        providerID: "openai",
        auth: {
          type: "oauth",
          refresh: "refresh-a",
          access: "access-a",
          expires: expect.any(Number),
          accountId: "acct_a",
        },
      },
    ])
    expect(toasts).toContainEqual({
      variant: "success",
      message: "Connected account work",
    })
    expect(renderedDialogs[3]).toEqual({
      title: "Provider Accounts",
      placeholder: "Provider: openai | Accounts: 2",
      options: [
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
        {
          title: "personal",
          value: { kind: "account", index: 0 },
          category: "Accounts",
          description: "id: user_a | accountId: acct_a",
          footer: "active",
        },
        {
          title: "work",
          value: { kind: "account", index: 1 },
          category: "Accounts",
          description: "id: user_b | accountId: acct_b",
          footer: "stored",
        },
      ],
      skipFilter: true,
      onSelect: expect.any(Function),
    })
  })

  test("connect and activate keeps the newly connected account active", async () => {
    const personal: storage.OAuthAccount = {
      id: "user_a",
      label: "personal",
      type: "oauth",
      access: "access-a",
      refresh: "refresh-a",
      expires: Date.now() + 3600_000,
      accountId: "acct_a",
    }
    const work: storage.OAuthAccount = {
      id: "user_b",
      label: "work",
      type: "oauth",
      access: "access-b",
      refresh: "refresh-b",
      expires: Date.now() + 3600_000,
      accountId: "acct_b",
    }
    storage.add("openai", personal)
    storage.activate("openai", 0)

    const api = createApi({
      callbackHandler: async () => {
        writeOAuthAuth("openai", work)
        storage.add("openai", work)
      },
    })
    await plugin.tui(api as any, { provider: "openai" } as any, {} as any)

    const root = await openProviderAccounts()
    await root.onSelect(root.options[0])
    const connect = renderedDialogs[1]
    await connect.onSelect(connect.options[1])
    const prompt = renderedDialogs[2]
    await prompt.onConfirm("test-code")

    expect(storage.read("openai")?.active).toBe(1)
    expect(authSetCalls).toEqual([])
    expect(toasts).toContainEqual({
      variant: "success",
      message: "Connected and activated work",
    })
  })

  test("connect account falls back to active new account when there was no previous account", async () => {
    const work: storage.OAuthAccount = {
      id: "user_b",
      label: "work",
      type: "oauth",
      access: "access-b",
      refresh: "refresh-b",
      expires: Date.now() + 3600_000,
      accountId: "acct_b",
    }

    const api = createApi({
      callbackHandler: async () => {
        writeOAuthAuth("openai", work)
        storage.add("openai", work)
      },
    })
    await plugin.tui(api as any, { provider: "openai" } as any, {} as any)

    const root = await openProviderAccounts()
    await root.onSelect(root.options[0])
    const connect = renderedDialogs[1]
    await connect.onSelect(connect.options[0])
    const prompt = renderedDialogs[2]
    await prompt.onConfirm("test-code")

    expect(storage.read("openai")?.active).toBe(0)
    expect(authSetCalls).toEqual([])
    expect(toasts).toContainEqual({
      variant: "success",
      message: "Connected account work",
    })
  })

  test("connect account supports auto OAuth mode", async () => {
    const work: storage.OAuthAccount = {
      id: "user_b",
      label: "work",
      type: "oauth",
      access: "access-b",
      refresh: "refresh-b",
      expires: Date.now() + 3600_000,
      accountId: "acct_b",
    }

    const api = createApi({
      authorizeResult: {
        data: {
          method: "auto",
          url: "https://example.com/connect",
          instructions: "Open the browser login",
        },
      },
      callbackHandler: async () => {
        writeOAuthAuth("openai", work)
        storage.add("openai", work)
      },
    })
    await plugin.tui(api as any, { provider: "openai" } as any, {} as any)

    const root = await openProviderAccounts()
    await root.onSelect(root.options[0])
    const connect = renderedDialogs[1]
    await connect.onSelect(connect.options[1])
    const alert = renderedDialogs[2]
    alert.onConfirm()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(alert).toEqual({
      title: "Connect Account",
      message: "Open the browser login\nhttps://example.com/connect\n\nPress Enter after finishing login in your browser.",
      onConfirm: expect.any(Function),
    })
    expect(storage.read("openai")?.active).toBe(0)
    expect(toasts).toContainEqual({
      variant: "success",
      message: "Connected and activated work",
    })
  })

  test("connect account shows an error when OAuth methods are unavailable", async () => {
    storage.add("openai", {
      id: "user_a",
      label: "personal",
      type: "oauth",
      access: "access-a",
      refresh: "refresh-a",
      expires: Date.now() + 3600_000,
      accountId: "acct_a",
    })

    const api = createApi({ providerMethods: [] })
    await plugin.tui(api as any, { provider: "openai" } as any, {} as any)

    const root = await openProviderAccounts()
    await root.onSelect(root.options[0])
    const connect = renderedDialogs[1]
    await connect.onSelect(connect.options[0])

    expect(toasts).toContainEqual({
      variant: "error",
      message: "No OAuth login method is available for openai",
    })
  })

  test("reset action shows info toast when no exhausted accounts exist", async () => {
    storage.add("openai", {
      id: "user_a",
      label: "personal",
      type: "oauth",
      access: "access-a",
      refresh: "refresh-a",
      expires: Date.now() + 3600_000,
      accountId: "acct_a",
    })

    const api = createApi()
    await plugin.tui(api as any, { provider: "openai" } as any, {} as any)

    const root = await openProviderAccounts()
    root.onSelect(root.options[1])

    expect(toasts).toContainEqual({
      variant: "info",
      message: "No exhausted accounts",
    })
    expect(renderedDialogs).toHaveLength(1)
  })

  test("reset action opens checklist dialog with exhausted accounts only", async () => {
    storage.add("openai", {
      id: "user_a",
      label: "personal",
      type: "oauth",
      access: "access-a",
      refresh: "refresh-a",
      expires: Date.now() + 3600_000,
      accountId: "acct_a",
    })
    storage.add("openai", {
      id: "user_b",
      label: "work",
      type: "oauth",
      access: "access-b",
      refresh: "refresh-b",
      expires: Date.now() + 3600_000,
      accountId: "acct_b",
    })
    storage.add("openai", {
      id: "user_c",
      label: "shared",
      type: "oauth",
      access: "access-c",
      refresh: "refresh-c",
      expires: Date.now() + 3600_000,
      accountId: "acct_c",
    })
    storage.activate("openai", 0)
    storage.exhaust("openai", 1)
    storage.exhaust("openai", 2)

    const api = createApi()
    await plugin.tui(api as any, { provider: "openai" } as any, {} as any)

    const root = await openProviderAccounts()
    root.onSelect(root.options[1])

    expect(renderedDialogs[1]).toEqual({
      title: "Reset Exhausted Accounts",
      placeholder: "Exhausted accounts: 2 | Selected: 0",
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
        {
          title: "[ ] work",
          value: { kind: "toggle", index: 1 },
          category: "Exhausted",
          description: "id: user_b | accountId: acct_b",
          footer: "exhausted",
        },
        {
          title: "[ ] shared",
          value: { kind: "toggle", index: 2 },
          category: "Exhausted",
          description: "id: user_c | accountId: acct_c",
          footer: "exhausted",
        },
      ],
      skipFilter: true,
      onSelect: expect.any(Function),
    })
  })

  test("apply selected reset clears only chosen exhausted accounts", async () => {
    storage.add("openai", {
      id: "user_a",
      label: "personal",
      type: "oauth",
      access: "access-a",
      refresh: "refresh-a",
      expires: Date.now() + 3600_000,
      accountId: "acct_a",
    })
    storage.add("openai", {
      id: "user_b",
      label: "work",
      type: "oauth",
      access: "access-b",
      refresh: "refresh-b",
      expires: Date.now() + 3600_000,
      accountId: "acct_b",
    })
    storage.add("openai", {
      id: "user_c",
      label: "shared",
      type: "oauth",
      access: "access-c",
      refresh: "refresh-c",
      expires: Date.now() + 3600_000,
      accountId: "acct_c",
    })
    storage.activate("openai", 0)
    storage.exhaust("openai", 1)
    storage.exhaust("openai", 2)

    const api = createApi()
    await plugin.tui(api as any, { provider: "openai" } as any, {} as any)

    const root = await openProviderAccounts()
    root.onSelect(root.options[1])
    const reset = renderedDialogs[1]
    reset.onSelect(reset.options[3])
    const selected = renderedDialogs[2]
    selected.onSelect(selected.options[0])

    expect(storage.read("openai")).toEqual({
      active: 0,
      accounts: [
        {
          id: "user_a",
          label: "personal",
          type: "oauth",
          access: "access-a",
          refresh: "refresh-a",
          expires: expect.any(Number),
          accountId: "acct_a",
        },
        {
          id: "user_b",
          label: "work",
          type: "oauth",
          access: "access-b",
          refresh: "refresh-b",
          expires: expect.any(Number),
          accountId: "acct_b",
        },
        {
          id: "user_c",
          label: "shared",
          type: "oauth",
          access: "access-c",
          refresh: "refresh-c",
          expires: expect.any(Number),
          accountId: "acct_c",
        },
      ],
      exhausted: [2],
    })
    expect(toasts).toContainEqual({
      variant: "success",
      message: "Reset 1 exhausted account",
    })
    expect(renderedDialogs[3]).toEqual({
      title: "Provider Accounts",
      placeholder: "Provider: openai | Accounts: 3",
      options: [
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
        {
          title: "personal",
          value: { kind: "account", index: 0 },
          category: "Accounts",
          description: "id: user_a | accountId: acct_a",
          footer: "active",
        },
        {
          title: "work",
          value: { kind: "account", index: 1 },
          category: "Accounts",
          description: "id: user_b | accountId: acct_b",
          footer: "stored",
        },
        {
          title: "shared",
          value: { kind: "account", index: 2 },
          category: "Accounts",
          description: "id: user_c | accountId: acct_c",
          footer: "exhausted",
        },
      ],
      skipFilter: true,
      onSelect: expect.any(Function),
    })
  })

  test("reset all exhausted clears every exhausted account", async () => {
    storage.add("openai", {
      id: "user_a",
      label: "personal",
      type: "oauth",
      access: "access-a",
      refresh: "refresh-a",
      expires: Date.now() + 3600_000,
      accountId: "acct_a",
    })
    storage.add("openai", {
      id: "user_b",
      label: "work",
      type: "oauth",
      access: "access-b",
      refresh: "refresh-b",
      expires: Date.now() + 3600_000,
      accountId: "acct_b",
    })
    storage.activate("openai", 0)
    storage.exhaust("openai", 0)
    storage.exhaust("openai", 1)

    const api = createApi()
    await plugin.tui(api as any, { provider: "openai" } as any, {} as any)

    const root = await openProviderAccounts()
    root.onSelect(root.options[1])
    const reset = renderedDialogs[1]
    reset.onSelect(reset.options[1])

    expect(storage.read("openai")?.exhausted).toEqual([])
    expect(storage.read("openai")?.active).toBe(0)
    expect(toasts).toContainEqual({
      variant: "success",
      message: "Reset all exhausted accounts",
    })
  })

  test("back returns from nested account dialog to the root dialog", async () => {
    storage.add("openai", {
      id: "user_a",
      label: "personal",
      type: "oauth",
      access: "access-a",
      refresh: "refresh-a",
      expires: Date.now() + 3600_000,
      accountId: "acct_a",
    })

    const api = createApi()
    await plugin.tui(api as any, { provider: "openai" } as any, {} as any)

    const root = await openProviderAccounts()
    root.onSelect(root.options[2])
    const nested = renderedDialogs[1]
    nested.onSelect(nested.options[2])

    expect(renderedDialogs[2]).toEqual({
      title: "Provider Accounts",
      placeholder: "Provider: openai | Accounts: 1",
      options: [
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
        {
          title: "personal",
          value: { kind: "account", index: 0 },
          category: "Accounts",
          description: "id: user_a | accountId: acct_a",
          footer: "active",
        },
      ],
      skipFilter: true,
      onSelect: expect.any(Function),
    })
  })

  test("set active updates storage, syncs auth, returns to root, and shows success toast", async () => {
    storage.add("openai", {
      id: "user_a",
      label: "personal",
      type: "oauth",
      access: "access-a",
      refresh: "refresh-a",
      expires: Date.now() + 3600_000,
      accountId: "acct_a",
    })
    storage.add("openai", {
      id: "user_b",
      label: "work",
      type: "oauth",
      access: "access-b",
      refresh: "refresh-b",
      expires: Date.now() + 3600_000,
      accountId: "acct_b",
      enterpriseUrl: "https://enterprise.example.com",
    })
    storage.activate("openai", 0)

    const api = createApi()
    await plugin.tui(api as any, { provider: "openai" } as any, {} as any)

    const root = await openProviderAccounts()
    await root.onSelect(root.options[3])
    const nested = renderedDialogs[1]
    await nested.onSelect(nested.options[0])

    expect(storage.read("openai")?.active).toBe(1)
    expect(authSetCalls).toEqual([
      {
        providerID: "openai",
        auth: {
          type: "oauth",
          refresh: "refresh-b",
          access: "access-b",
          expires: expect.any(Number),
          enterpriseUrl: "https://enterprise.example.com",
          accountId: "acct_b",
        },
      },
    ])
    expect(toasts).toContainEqual({
      variant: "success",
      message: "Active account set to work",
    })
    expect(renderedDialogs[2]).toEqual({
      title: "Provider Accounts",
      placeholder: "Provider: openai | Accounts: 2",
      options: [
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
        {
          title: "personal",
          value: { kind: "account", index: 0 },
          category: "Accounts",
          description: "id: user_a | accountId: acct_a",
          footer: "stored",
        },
        {
          title: "work",
          value: { kind: "account", index: 1 },
          category: "Accounts",
          description: "id: user_b | accountId: acct_b",
          footer: "active",
        },
      ],
      skipFilter: true,
      onSelect: expect.any(Function),
    })
  })

  test("set active rolls back on auth sync failure and keeps nested dialog open", async () => {
    storage.add("openai", {
      id: "user_a",
      label: "personal",
      type: "oauth",
      access: "access-a",
      refresh: "refresh-a",
      expires: Date.now() + 3600_000,
      accountId: "acct_a",
    })
    storage.add("openai", {
      id: "user_b",
      label: "work",
      type: "oauth",
      access: "access-b",
      refresh: "refresh-b",
      expires: Date.now() + 3600_000,
      accountId: "acct_b",
    })
    storage.activate("openai", 0)

    const api = createApi({ authSetError: new Error("boom") })
    await plugin.tui(api as any, { provider: "openai" } as any, {} as any)

    const root = await openProviderAccounts()
    await root.onSelect(root.options[3])
    const nested = renderedDialogs[1]
    await nested.onSelect(nested.options[0])

    expect(storage.read("openai")?.active).toBe(0)
    expect(authSetCalls).toHaveLength(1)
    expect(toasts).toContainEqual({
      variant: "error",
      message: "Failed to set active account to work",
    })
    expect(renderedDialogs).toHaveLength(2)
  })

  test("set active warns and returns to root when the selected account disappeared", async () => {
    storage.add("openai", {
      id: "user_a",
      label: "personal",
      type: "oauth",
      access: "access-a",
      refresh: "refresh-a",
      expires: Date.now() + 3600_000,
      accountId: "acct_a",
    })
    storage.add("openai", {
      id: "user_b",
      label: "work",
      type: "oauth",
      access: "access-b",
      refresh: "refresh-b",
      expires: Date.now() + 3600_000,
      accountId: "acct_b",
    })
    storage.activate("openai", 0)

    const api = createApi()
    await plugin.tui(api as any, { provider: "openai" } as any, {} as any)

    const root = await openProviderAccounts()
    await root.onSelect(root.options[3])
    storage.write("openai", {
      active: 0,
      accounts: [storage.read("openai")!.accounts[0]!],
      exhausted: [],
    })
    const nested = renderedDialogs[1]
    await nested.onSelect(nested.options[0])

    expect(authSetCalls).toHaveLength(0)
    expect(toasts).toContainEqual({
      variant: "warning",
      message: "That account no longer exists",
    })
    expect(renderedDialogs[2]).toEqual({
      title: "Provider Accounts",
      placeholder: "Provider: openai | Accounts: 1",
      options: [
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
        {
          title: "personal",
          value: { kind: "account", index: 0 },
          category: "Accounts",
          description: "id: user_a | accountId: acct_a",
          footer: "active",
        },
      ],
      skipFilter: true,
      onSelect: expect.any(Function),
    })
  })

  test("remove inactive account preserves active account and does not touch auth", async () => {
    storage.add("openai", {
      id: "user_a",
      label: "personal",
      type: "oauth",
      access: "access-a",
      refresh: "refresh-a",
      expires: Date.now() + 3600_000,
      accountId: "acct_a",
    })
    storage.add("openai", {
      id: "user_b",
      label: "work",
      type: "oauth",
      access: "access-b",
      refresh: "refresh-b",
      expires: Date.now() + 3600_000,
      accountId: "acct_b",
    })
    storage.activate("openai", 1)

    const api = createApi()
    await plugin.tui(api as any, { provider: "openai" } as any, {} as any)

    const root = await openProviderAccounts()
    await root.onSelect(root.options[2])
    const nested = renderedDialogs[1]
    await nested.onSelect(nested.options[1])

    expect(storage.read("openai")).toEqual({
      active: 0,
      accounts: [
        {
          id: "user_b",
          label: "work",
          type: "oauth",
          access: "access-b",
          refresh: "refresh-b",
          expires: expect.any(Number),
          accountId: "acct_b",
        },
      ],
      exhausted: [],
    })
    expect(authSetCalls).toEqual([])
    expect(authRemoveCalls).toEqual([])
    expect(toasts).toContainEqual({
      variant: "success",
      message: "Removed account personal",
    })
    expect(renderedDialogs[2]).toEqual({
      title: "Provider Accounts",
      placeholder: "Provider: openai | Accounts: 1",
      options: [
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
        {
          title: "work",
          value: { kind: "account", index: 0 },
          category: "Accounts",
          description: "id: user_b | accountId: acct_b",
          footer: "active",
        },
      ],
      skipFilter: true,
      onSelect: expect.any(Function),
    })
  })

  test("remove active account switches auth to replacement account", async () => {
    storage.add("openai", {
      id: "user_a",
      label: "personal",
      type: "oauth",
      access: "access-a",
      refresh: "refresh-a",
      expires: Date.now() + 3600_000,
      accountId: "acct_a",
    })
    storage.add("openai", {
      id: "user_b",
      label: "work",
      type: "oauth",
      access: "access-b",
      refresh: "refresh-b",
      expires: Date.now() + 3600_000,
      accountId: "acct_b",
      enterpriseUrl: "https://enterprise.example.com",
    })
    storage.activate("openai", 0)

    const api = createApi()
    await plugin.tui(api as any, { provider: "openai" } as any, {} as any)

    const root = await openProviderAccounts()
    await root.onSelect(root.options[2])
    const nested = renderedDialogs[1]
    await nested.onSelect(nested.options[1])

    expect(storage.read("openai")).toEqual({
      active: 0,
      accounts: [
        {
          id: "user_b",
          label: "work",
          type: "oauth",
          access: "access-b",
          refresh: "refresh-b",
          expires: expect.any(Number),
          accountId: "acct_b",
          enterpriseUrl: "https://enterprise.example.com",
        },
      ],
      exhausted: [],
    })
    expect(authSetCalls).toEqual([
      {
        providerID: "openai",
        auth: {
          type: "oauth",
          refresh: "refresh-b",
          access: "access-b",
          expires: expect.any(Number),
          enterpriseUrl: "https://enterprise.example.com",
          accountId: "acct_b",
        },
      },
    ])
    expect(authRemoveCalls).toEqual([])
    expect(toasts).toContainEqual({
      variant: "success",
      message: "Removed account personal",
    })
  })

  test("remove last account logs out provider and returns empty state", async () => {
    storage.add("openai", {
      id: "user_a",
      label: "personal",
      type: "oauth",
      access: "access-a",
      refresh: "refresh-a",
      expires: Date.now() + 3600_000,
      accountId: "acct_a",
    })

    const api = createApi()
    await plugin.tui(api as any, { provider: "openai" } as any, {} as any)

    const root = await openProviderAccounts()
    await root.onSelect(root.options[2])
    const nested = renderedDialogs[1]
    await nested.onSelect(nested.options[1])

    expect(storage.read("openai")).toBeUndefined()
    expect(authSetCalls).toEqual([])
    expect(authRemoveCalls).toEqual([{ providerID: "openai" }])
    expect(toasts).toContainEqual({
      variant: "success",
      message: "Removed account personal",
    })
    expect(renderedDialogs[2]).toEqual({
      title: "Provider Accounts",
      placeholder: "Provider: openai | Accounts: 0",
      options: [
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
        {
          title: "No stored accounts",
          value: { kind: "empty" },
          category: "Accounts",
          description: "Provider: openai",
          footer: "Accounts: 0",
        },
      ],
      skipFilter: true,
      onSelect: expect.any(Function),
    })
  })

  test("remove warns and returns to root when the selected account disappeared", async () => {
    storage.add("openai", {
      id: "user_a",
      label: "personal",
      type: "oauth",
      access: "access-a",
      refresh: "refresh-a",
      expires: Date.now() + 3600_000,
      accountId: "acct_a",
    })
    storage.add("openai", {
      id: "user_b",
      label: "work",
      type: "oauth",
      access: "access-b",
      refresh: "refresh-b",
      expires: Date.now() + 3600_000,
      accountId: "acct_b",
    })
    storage.activate("openai", 0)

    const api = createApi()
    await plugin.tui(api as any, { provider: "openai" } as any, {} as any)

    const root = await openProviderAccounts()
    await root.onSelect(root.options[3])
    storage.write("openai", {
      active: 0,
      accounts: [storage.read("openai")!.accounts[0]!],
      exhausted: [],
    })
    const nested = renderedDialogs[1]
    await nested.onSelect(nested.options[1])

    expect(authSetCalls).toEqual([])
    expect(authRemoveCalls).toEqual([])
    expect(toasts).toContainEqual({
      variant: "warning",
      message: "That account no longer exists",
    })
    expect(renderedDialogs[2]).toEqual({
      title: "Provider Accounts",
      placeholder: "Provider: openai | Accounts: 1",
      options: [
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
        {
          title: "personal",
          value: { kind: "account", index: 0 },
          category: "Accounts",
          description: "id: user_a | accountId: acct_a",
          footer: "active",
        },
      ],
      skipFilter: true,
      onSelect: expect.any(Function),
    })
  })

  test("remove active account rolls back when auth sync fails", async () => {
    storage.add("openai", {
      id: "user_a",
      label: "personal",
      type: "oauth",
      access: "access-a",
      refresh: "refresh-a",
      expires: Date.now() + 3600_000,
      accountId: "acct_a",
    })
    storage.add("openai", {
      id: "user_b",
      label: "work",
      type: "oauth",
      access: "access-b",
      refresh: "refresh-b",
      expires: Date.now() + 3600_000,
      accountId: "acct_b",
    })
    storage.activate("openai", 0)

    const api = createApi({ authSetError: new Error("boom") })
    await plugin.tui(api as any, { provider: "openai" } as any, {} as any)

    const root = await openProviderAccounts()
    await root.onSelect(root.options[2])
    const nested = renderedDialogs[1]
    await nested.onSelect(nested.options[1])

    expect(storage.read("openai")).toEqual({
      active: 0,
      accounts: [
        {
          id: "user_a",
          label: "personal",
          type: "oauth",
          access: "access-a",
          refresh: "refresh-a",
          expires: expect.any(Number),
          accountId: "acct_a",
        },
        {
          id: "user_b",
          label: "work",
          type: "oauth",
          access: "access-b",
          refresh: "refresh-b",
          expires: expect.any(Number),
          accountId: "acct_b",
        },
      ],
      exhausted: [],
    })
    expect(authSetCalls).toHaveLength(1)
    expect(authRemoveCalls).toEqual([])
    expect(toasts).toContainEqual({
      variant: "error",
      message: "Failed to remove account personal",
    })
    expect(renderedDialogs).toHaveLength(2)
  })

  test("remove last account rolls back when provider logout fails", async () => {
    storage.add("openai", {
      id: "user_a",
      label: "personal",
      type: "oauth",
      access: "access-a",
      refresh: "refresh-a",
      expires: Date.now() + 3600_000,
      accountId: "acct_a",
    })

    const api = createApi({ authRemoveError: new Error("boom") })
    await plugin.tui(api as any, { provider: "openai" } as any, {} as any)

    const root = await openProviderAccounts()
    await root.onSelect(root.options[2])
    const nested = renderedDialogs[1]
    await nested.onSelect(nested.options[1])

    expect(storage.read("openai")).toEqual({
      active: 0,
      accounts: [
        {
          id: "user_a",
          label: "personal",
          type: "oauth",
          access: "access-a",
          refresh: "refresh-a",
          expires: expect.any(Number),
          accountId: "acct_a",
        },
      ],
      exhausted: [],
    })
    expect(authSetCalls).toEqual([])
    expect(authRemoveCalls).toEqual([{ providerID: "openai" }])
    expect(toasts).toContainEqual({
      variant: "error",
      message: "Failed to remove account personal",
    })
    expect(renderedDialogs).toHaveLength(2)
  })

  test("ignores plugin options", async () => {
    await expect(plugin.tui(createApi() as any, undefined, {} as any)).resolves.toBeUndefined()
    await expect(plugin.tui(createApi() as any, {}, {} as any)).resolves.toBeUndefined()
    await expect(plugin.tui(createApi() as any, { provider: "openai" }, {} as any)).resolves.toBeUndefined()
  })
})
