# opencode-multi-account-providers

An [OpenCode](https://opencode.ai) plugin that manages multiple OAuth accounts for one provider and automatically rotates to another account when the current one hits a rate limit.

If you keep multiple ChatGPT subscriptions for the same provider, the plugin can retry with another stored account instead of leaving the session stuck on a rate-limited one.

## Requirements

- OAuth-based provider auth
- a provider auth plugin that re-reads auth before each request
- best-supported provider today: `openai`

API-key-only providers are not supported.

## Installation

When you add the plugin manually, configure it in both `opencode.json` and `tui.json`.

`opencode.json`

```json
{
  "plugin": [
    ["opencode-multi-account-providers", { "provider": "openai" }]
  ]
}
```

`tui.json`

```json
{
  "plugin": [
    ["opencode-multi-account-providers", { "provider": "openai" }]
  ]
}
```

For local path-based development, replace the package name with the local repository path in both files.

### Option

| Option | Type | Description |
|---|---|---|
| `provider` | `string` | Provider ID managed by this plugin instance. |

To manage multiple providers, add the plugin more than once with different `provider` values.

## Setup

Accounts are captured from the normal OpenCode login flow.

1. Run `opencode auth login <provider>` for your first account
2. Run it again for the next account
3. Repeat for any additional accounts

The plugin records those accounts automatically when credentials are written.

If the plugin starts after `auth.json` already exists, the current account is captured on the first request as a fallback.

## Usage

### Automatic rotation

Once multiple accounts are stored, the plugin will automatically rotate after a rate-limited retry.

### TUI account management

In the TUI, run `/provider-accounts` to open the local account dialog.

Current dialog actions:

- inspect stored accounts
- see which account is `active` or `exhausted`
- set the active account manually
- reset selected exhausted accounts or all exhausted accounts
- disconnect a stored account

`Add account` is not implemented in the dialog yet. Keep using `opencode auth login <provider>` to add new accounts.

## Limitations

- one provider per plugin instance
- best support is currently `openai`
- depends on a compatible provider auth plugin that re-reads auth for each request
- the account-capture watcher is best-effort

## Docs

- user-facing TUI plan and iteration notes: `specs/plans/provider-accounts-command.md`
- current architecture and design notes: `specs/architecture.md`
- development, testing, and local harness docs: `specs/development.md`
- backlog and future ideas: `specs/plans/backlog.md`
