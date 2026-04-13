# Architecture

## Overview

The plugin has two entrypoints:

- `src/index.ts`: server plugin responsibilities
- `src/tui.ts`: local TUI account-management UI

The server side handles account capture and automatic rotation during retries.
The TUI side exposes `/provider-accounts` as a fully local command that does not invoke the model.

## Core Design

The implementation uses OpenCode's `auth.json` as the integration boundary.

1. The provider auth plugin owns request-time auth resolution.
2. This plugin captures multiple OAuth accounts into its own SQLite storage.
3. On rate limit, the server plugin selects another stored account.
4. The plugin writes the next account through `client.auth.set(...)`.
5. On the next request, the provider auth plugin re-reads auth and uses the updated credentials.

This keeps provider-specific auth logic outside this plugin.

## Main Components

### `src/index.ts`

Server responsibilities:

- watch `auth.json`
- capture newly logged-in accounts
- detect rate-limited retries
- mark accounts exhausted
- rotate to the next available account
- write rotated credentials through the OpenCode auth API

### `src/tui.ts`

TUI responsibilities:

- register local `/provider-accounts`
- render a provider picker
- render dialog-based account management
- show account state (`active`, `exhausted`)
- switch active account
- reset selected exhausted accounts or all exhausted accounts
- disconnect stored accounts
- log out via provider auth removal when the last stored account is disconnected

### `src/storage.ts`

Shared SQLite storage for:

- stored accounts
- active account index
- exhausted account indices

Current DB path:

- `$XDG_DATA_HOME/opencode/multi-auth.db`

### `src/rotation.ts`

In-memory request/session state used by the server plugin to keep rotation safe across retries.

## Capture Flow

Account capture has two paths:

1. Primary: filesystem watcher on `auth.json`
2. Fallback: first request path in `chat.params`

The fallback exists for cold start, when auth data already existed before the plugin started.

## Automatic Rotation Flow

```text
request fails with rate limit
-> OpenCode retry emits session.status retry event
-> plugin marks the used account exhausted and flags rotation
-> next chat.params sees the flag
-> plugin activates the next available account
-> plugin writes new credentials via client.auth.set(...)
-> retried request uses the new account
```

## TUI Flow

`/provider-accounts` is implemented through the TUI plugin API, not server command interception.

Reason:

- server `command.execute.before` still falls through to the normal LLM-backed command path
- TUI command registration runs locally and can open dialogs immediately

Current dialog structure:

- provider picker
  - providers with OAuth support
  - providers with stored accounts
- provider dialog
  - `Connect account`
  - `Reset exhausted accounts`
  - account rows
- account dialog
  - `Set active`
  - `Disconnect account`
  - `Back`
- reset dialog
  - toggle selected exhausted accounts
  - `Apply selected`
  - `Reset all exhausted`
  - `Back`

## Auth Sync Rules

### Manual switch

- update active index in storage
- call `client.auth.set(...)`
- on failure, restore previous active index

### Disconnect account

- remove from storage first
- if another account remains and the removed one was active, call `client.auth.set(...)` for the replacement account
- if no accounts remain, call `client.auth.remove({ providerID })`
- on auth failure, restore the previous storage snapshot

The plugin does not edit `auth.json` directly for logout.

## Storage Model

Each provider stores:

- ordered accounts
- active index
- exhausted indices

The plugin is loaded once globally and routes capture, rotation, and TUI actions by runtime provider ID.

Accounts are deduplicated by a stable fingerprint derived from provider identity data. OpenAI has a dedicated identity extractor. Other providers may fall back to weaker identity matching.

## Important Assumptions

- OAuth-based auth only
- provider auth plugin must re-read auth on each request
- best-supported provider is currently `openai`
- event-side rotation bookkeeping must stay synchronous

## Known Tradeoffs

- watcher-based capture is best-effort
- there can still be one wasted retry before the new credentials are used, depending on provider-side auth caching inside the failed request path
- provider support quality depends on available identity extraction and request-time auth behavior

## Related Docs

- TUI command plan: `specs/plans/provider-accounts-command.md`
- development/testing notes: `specs/development.md`
- backlog: `specs/backlog.md`
