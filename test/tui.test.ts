import { beforeEach, describe, expect, mock, test } from "bun:test"
import { join } from "node:path"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import * as storage from "../src/storage"
import plugin from "../src/tui"

let testDir: string
let registeredCommands: (() => any[]) | undefined
let renderedDialogs: any[]
let toasts: any[]
let authSetCalls: any[]
let authRemoveCalls: any[]

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "multi-account-plugin-tui-test-"))
  storage.configure(testDir)
  registeredCommands = undefined
  renderedDialogs = []
  toasts = []
  authSetCalls = []
  authRemoveCalls = []
})

function createApi(options: { authSetError?: Error, authRemoveError?: Error } = {}) {
  return {
    state: {
      path: {
        state: testDir,
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
    },
    ui: {
      DialogSelect: mock((props: any) => props),
      toast: mock((input: any) => {
        toasts.push(input)
      }),
      dialog: {
        replace: mock((render: () => unknown) => {
          renderedDialogs.push(render())
        }),
      },
    },
  }
}

describe("tui plugin module", () => {
  test("has correct id", () => {
    expect(plugin.id).toBe("opencode-multi-account-providers")
  })

  test("registers local provider-accounts command", async () => {
    const api = createApi()
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

    const command = registeredCommands!()[0]
    command.onSelect()

    expect(api.ui.dialog.replace).toHaveBeenCalledTimes(1)
    expect(renderedDialogs).toEqual([
      {
        title: "Provider Accounts",
        placeholder: "Provider: openai | Accounts: 0",
        options: [
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

    registeredCommands!()[0].onSelect()

    expect(renderedDialogs).toEqual([
      {
        title: "Provider Accounts",
        placeholder: "Provider: openai | Accounts: 2",
        options: [
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

    registeredCommands!()[0].onSelect()
    const root = renderedDialogs[0]
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

  test("placeholder actions show a toast and keep dialog open", async () => {
    const api = createApi()
    await plugin.tui(api as any, { provider: "openai" } as any, {} as any)

    registeredCommands!()[0].onSelect()
    const root = renderedDialogs[0]
    root.onSelect(root.options[0])

    expect(toasts).toEqual([
      {
        variant: "info",
        message: "Add account is not implemented yet",
      },
    ])
    expect(renderedDialogs).toHaveLength(1)
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

    registeredCommands!()[0].onSelect()
    const root = renderedDialogs[0]
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

    registeredCommands!()[0].onSelect()
    const root = renderedDialogs[0]
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

    registeredCommands!()[0].onSelect()
    const root = renderedDialogs[0]
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

    registeredCommands!()[0].onSelect()
    const root = renderedDialogs[0]
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

    registeredCommands!()[0].onSelect()
    const root = renderedDialogs[0]
    root.onSelect(root.options[2])
    const nested = renderedDialogs[1]
    nested.onSelect(nested.options[2])

    expect(renderedDialogs[2]).toEqual({
      title: "Provider Accounts",
      placeholder: "Provider: openai | Accounts: 1",
      options: [
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

    registeredCommands!()[0].onSelect()
    const root = renderedDialogs[0]
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

    registeredCommands!()[0].onSelect()
    const root = renderedDialogs[0]
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

    registeredCommands!()[0].onSelect()
    const root = renderedDialogs[0]
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

    registeredCommands!()[0].onSelect()
    const root = renderedDialogs[0]
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

    registeredCommands!()[0].onSelect()
    const root = renderedDialogs[0]
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

    registeredCommands!()[0].onSelect()
    const root = renderedDialogs[0]
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

    registeredCommands!()[0].onSelect()
    const root = renderedDialogs[0]
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

    registeredCommands!()[0].onSelect()
    const root = renderedDialogs[0]
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

    registeredCommands!()[0].onSelect()
    const root = renderedDialogs[0]
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

  test("throws when provider option is missing", async () => {
    await expect(plugin.tui(createApi() as any, undefined, {} as any)).rejects.toThrow(/provider/)
  })
})
