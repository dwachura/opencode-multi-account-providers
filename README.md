# opencode-multi-account-providers

An [OpenCode](https://opencode.ai) plugin that manages multiple OAuth accounts across compatible providers and automatically rotates to another account when the current one hits a rate limit.

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
    ["opencode-multi-account-providers", {}]
  ]
}
```

`tui.json`

```json
{
  "plugin": [
    ["opencode-multi-account-providers", {}]
  ]
}
```

For local path-based development, replace the package name with the local repository path in both files.

Plugin options are currently ignored. Load the plugin once.

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

In the TUI, run `/provider-accounts` to open the local provider picker and account dialog.

Current dialog actions:

- pick a provider with OAuth support or stored accounts
- inspect stored accounts
- see which account is `active` or `exhausted`
- set the active account manually
- reset selected exhausted accounts or all exhausted accounts
- disconnect a stored account

`Connect account` is available in the dialog. You can either keep the previously active account active or activate the newly connected account.

## Limitations

- best support is currently `openai`
- depends on a compatible provider auth plugin that re-reads auth for each request
- the account-capture watcher is best-effort
- picker only shows providers with OAuth support or already stored accounts

## Docs

- user-facing TUI plan and iteration notes: `specs/plans/provider-accounts-command.md`
- current architecture and design notes: `specs/architecture.md`
- development, testing, and local harness docs: `specs/development.md`
- backlog and future ideas: `specs/backlog.md`
