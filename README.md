# opencode-multi-account-providers

An [opencode](https://opencode.ai) v1 plugin that automatically rotates between multiple OAuth accounts for the same LLM provider when one hits a rate limit.

If you have two ChatGPT Pro subscriptions and one gets rate-limited mid-conversation, this plugin transparently switches to the other account on the next retry with no manual intervention.

## How it works

The plugin uses `auth.json` as a side-channel. It watches `auth.json` to capture accounts when `opencode auth login <provider>` writes new credentials, then later writes rotated OAuth credentials back through `client.auth.set()` when a rate limit is detected.

A compatible provider auth plugin, such as the built-in Codex plugin for OpenAI, re-reads `auth.json` on the next request and uses the new credentials.

```
1. You send a message
2. Provider returns 429 (rate limited)
3. opencode's retry system fires a session.status event
4. This plugin marks the current account as exhausted and flags rotation
5. On retry, chat.params hook writes the next account's credentials to auth.json
6. The provider's auth plugin re-reads auth.json and uses the new credentials
7. The retry succeeds with the new account
```

## Important: OAuth accounts only

This plugin only works with **OAuth-based accounts** (e.g., ChatGPT Pro/Plus subscriptions authenticated via browser login). API key accounts are not supported because their credentials are typically resolved once and not re-read on each request.

The rotation mechanism depends on the provider's auth plugin implementing a per-request fetch wrapper that re-reads `auth.json` before every HTTP call. The built-in **Codex plugin** for OpenAI does this. Other providers only work if they have equivalent auth-plugin behavior.

## Installation

```bash
bun install
```

Add the plugin to your `opencode.json`:

```json
{
  "plugin": [
    ["opencode-multi-account-providers", { "provider": "openai" }]
  ]
}
```

### Options

| Option | Type | Default | Description |
|---|---|---|---|
| `provider` | `string` | none | Provider ID managed by this plugin instance. Best-supported path is `"openai"`. |

To manage multiple providers, add the plugin more than once with different `provider` values.

## Setup

The plugin captures accounts automatically from opencode's `auth.json`.

1. Log in to your first account (`opencode auth login openai`)
2. If identity extraction succeeds, the plugin captures the account when `auth.json` is rewritten
3. Log in to your second account
4. If identity extraction succeeds, the plugin captures that account too
5. Accounts are stored in `multi-auth.db`

If the plugin starts after `auth.json` already exists, the current account is captured on the first chat request as a cold-start fallback.

From this point on, rate limits trigger automatic rotation.

### Why watch `auth.json`

The plugin watches opencode's `auth.json` so each `opencode auth login <provider>` can be captured automatically as soon as credentials are written.

This keeps provider auth flows unchanged: opencode still owns `auth.json`, and the plugin records accounts from those updates into its own storage.

The watcher is the primary capture path, but it is still best-effort:

- it retries until the `auth.json` parent directory exists
- it only stores accounts when identity extraction succeeds for the current provider

`chat.params` remains the fallback path when the watcher misses an update or the plugin starts after `auth.json` already exists.

## Architecture

### Files

```
src/
  index.ts            Plugin entry, auth.json watcher, chat.params and event hooks
  storage.ts          SQLite storage, auth.json reading with mtime cache
  rotation.ts         In-memory session/provider tracking and rotation flags
  identity.ts         Provider identity extractor registry
  identity-openai.ts  OpenAI JWT identity extraction
```

### Storage (`multi-auth.db`)

The plugin stores account state at `$XDG_DATA_HOME/opencode/multi-auth.db` alongside opencode's `auth.json`.

Stored state includes:

- provider ID
- account position
- stable account fingerprint
- extracted account identity and label
- OAuth credentials
- active account flag
- exhausted account flag

Accounts are deduplicated by a stable provider identity extracted from the OAuth access token. For OpenAI, this comes from JWT claims. Providers without a dedicated identity extractor fall back to using the access token itself, which is not stable across token refreshes.

### Hooks

**`chat.params`** (awaited before every LLM request):
- Tracks which session maps to which provider
- On rotation path: consumes the rotation flag, activates the next non-exhausted account, writes its credentials to `auth.json` via `client.auth.set()`
- On normal path: cold-start fallback that reads `auth.json` and captures the current account if it was not already recorded

**`event`** (fire-and-forget on every bus event):
- On `session.status` with `type: "retry"`: checks if the message indicates a rate limit, exhausts the account actually used for the failed request, and flags rotation for the session

### Account Detection

The plugin captures new accounts in two ways:

1. **Primary path:** a best-effort filesystem watcher observes `auth.json` and records successful `opencode auth login` writes
2. **Fallback path:** `chat.params` captures the current account on the first request if the plugin started after `auth.json` already existed

### Rotation state (`rotation.ts`)

Pure in-memory, synchronous state — critical because the `event` hook runs inside `Effect.sync` where promises are dropped.

- `track(sessionID, providerID)` — maps session to provider
- `trackAccount(sessionID, index)` — records which account index was used for the current request
- `flag(sessionID)` / `consume(sessionID)` — single-use rotation flag
- `usedAccount(sessionID)` — returns the account index to exhaust (prevents exhausting the wrong account after rotation)

### Timing model

```
streamText() fails → retry policy → status event → plugin exhausts + flags
→ sleep(delay) → chat.params → plugin rotates → streamText() with new credentials
```

The plugin sets the rotation flag synchronously during the retry delay (minimum 2 seconds). On the next retry, `chat.params` consumes the flag and writes new credentials before `streamText()` runs.

### Credential caching caveat

When credentials are rotated, the retry that triggered the rotation may still use the **old** credentials (cached by the provider's fetch wrapper for that request). This causes one "wasted" 429 response. The plugin handles this by tracking which account was *actually used* per session (`trackAccount`), so the event handler exhausts the correct account — not whichever account is currently `active`.

## Assumptions and dependencies

- **opencode >= 1.3.0** with the v1 plugin API
- **OAuth provider with per-request auth.json reads.** The built-in Codex plugin for OpenAI implements a custom `fetch` wrapper that calls `getAuth()` on every HTTP request, re-reading `auth.json` each time. This is what makes the side-channel rotation work. Other providers only work if their auth plugin does the same.
- **Provider-specific identity extraction may be required.** OpenAI has a dedicated extractor. Other providers currently fall back to access-token-based identity, which may create duplicate accounts after token refresh.
- **File-based auth.json.** The plugin reads and writes `$XDG_DATA_HOME/opencode/auth.json` directly (for reading) and via `client.auth.set()` (for writing). This assumes opencode's auth storage is file-based at that path.
- **Synchronous event hooks.** The `event` hook must complete synchronously. All rotation state operations are single-line assignments with no I/O.

## Known limitations

- **Single provider per plugin instance.** Configuration uses `provider`, not `providers`.
- **Best support is currently OpenAI.** Other providers need a compatible auth plugin and may need a provider-specific identity extractor.
- **Exhaustion reset is not yet automatic.** Exhausted accounts are not currently reset on `session.created`.
- **Single wasted retry after rotation.** Due to credential caching in the provider's fetch wrapper, the first retry after rotation may still use the old account's credentials. The second retry will use the new ones.
- **Watcher is best-effort.** Filesystem notifications are used for automatic capture, with `chat.params` as the cold-start fallback.

## Development

```bash
# Install dependencies
bun install

# Type check
bun run tsc

# Run unit tests
bun test test/storage.test.ts test/rotation.test.ts test/index.test.ts

# Run fake server tests
bun test test/integration/fake-server.test.ts

# Run integration tests (requires opencode installed)
bun test test/integration/integration.test.ts

# Run everything
bun test

# Launch interactive fake-server + opencode TUI harness
bun run e2e:tui

# From another terminal, manage fake accounts in the running env
bun run e2e:account:add alpha 2
bun run e2e:account:add beta 2
bun run e2e:account:list
bun run e2e:account:remove alpha

# Force rate limiting and reset state
bun run e2e:limit alpha 1
bun run e2e:reset
```

### Interactive E2E harness

`bun run e2e:tui` starts:

- the fake LLM server on `http://localhost:${E2E_FAKE_PORT:-18080}` with no predefined users
- a fresh temporary opencode config under `.test-env/interactive/`
- a bootstrap `auth.json` entry so the fake auth plugin attaches on startup
- `opencode` with the built-in `title` agent disabled, so visible prompts do not spend extra requests on automatic title generation
- fake server logs redirected to `fake-server.log`, so they do not overlap the opencode TUI
- the normal `opencode` TUI pointed at that isolated environment

While the TUI is running, use the helper scripts from another terminal to:

- create a fake account with any label you want; its user id, access token, refresh token, and account id all use that same label
- optionally pass an initial request limit as the second argument to `e2e:account:add`
- add that fake account by rewriting `auth.json` and letting the plugin watcher capture it
- list stored accounts from `multi-auth.db`
- remove stored accounts from `multi-auth.db`
- lower request limits to force rotation
- reset fake-server usage and clear exhausted flags

Suggested manual demo:

1. Run `bun run e2e:tui`
2. In another shell, run `bun run e2e:account:add alpha 2`
3. Then run `bun run e2e:account:add beta 2`
4. Optionally add a third account with `bun run e2e:account:add gamma 2`
5. In the TUI, send prompts using provider `fake` / model `fake-model-v1`
6. Observe watcher capture, rate-limit handling, and rotation

If you want to force rotation immediately, lower the active account limit with `bun run e2e:limit alpha 1`.

Notes:

- Before you add a real fake account, the bootstrap credentials are intentionally invalid for the fake server.
- `e2e:account:add <label> [limit]` both creates the fake server user and rewrites `auth.json` so the plugin watcher captures it.
- `e2e:account:remove <label>` removes the stored plugin account and deletes the fake server user.
- `bun run e2e:tui` prints the path to `fake-server.log`; use `tail -f` from another terminal to inspect which account served each request and current usage.

### Fake server admin API

The fake server used by integration tests and the interactive harness exposes:

- `GET /admin/users`
- `POST /admin/users`
- `GET /admin/users/:id`
- `DELETE /admin/users/:id`
- `PUT /admin/users/:id/limits`
- `PUT /admin/users/:id/tokens`
- `POST /admin/users/:id/reset`
- `POST /admin/reset`

Interactive `e2e:tui` starts the fake server with `FAKE_SERVER_SEED=0`, so users are created on demand by `e2e:account:add`.

## Future Work

### Planned: TUI account management

- manage stored accounts for the configured provider directly from the opencode TUI
- initial scope: list accounts, show `active` / `exhausted`, manually switch the active account, reset exhausted state, and remove stored accounts
- guided `Add account` flow should stay inside the app via a modal or drawer and reuse the normal `opencode auth login <provider>` flow rather than implementing OAuth in this plugin
- the add/login UI should watch for `auth.json` capture completion, then offer `Set active now` or `Keep current active`
- manual account-management actions should preserve the current rotation model and apply safely on the next request

### Planned: account metadata

- add `created_at` to persisted account rows so we know when an account record was first captured
- add `updated_at` to persisted account rows so we know when credentials or account metadata were last refreshed
- preserve `created_at` on duplicate-account refresh and bump `updated_at` whenever an existing stored account is rewritten
- expose these timestamps in future account-management views for debugging and stale-account inspection

### Other ideas

- optional TUI confirm-before-switch flow for rate-limited accounts, configurable per plugin instance via `rotationMode: "auto" | "confirm"`
- account usage tracking, likely combining local request/token counting with provider-side checks; for OpenAI OAuth accounts this likely means `GET https://chatgpt.com/backend-api/wham/usage` with `Authorization: <token>` and tracking fields such as `user_id`, `account_id`, `email`, `plan_type`, `rate_limit.allowed`, `rate_limit.limit_reached`, the primary and secondary window reset/usage fields, and credits/spend-control status

OpenAI usage endpoint reference for later planning:

```bash
curl --location 'https://chatgpt.com/backend-api/wham/usage' \
  --header 'Authorization: <token>'
```

Example response:

```json
{
  "user_id": "<user id>",
  "account_id": "<account id>",
  "email": "<user email>",
  "plan_type": "team",
  "rate_limit": {
    "allowed": true,
    "limit_reached": false,
    "primary_window": {
      "used_percent": 19,
      "limit_window_seconds": 18000,
      "reset_after_seconds": 10721,
      "reset_at": 1775869147
    },
    "secondary_window": {
      "used_percent": 19,
      "limit_window_seconds": 604800,
      "reset_after_seconds": 519936,
      "reset_at": 1776378362
    }
  },
  "code_review_rate_limit": null,
  "additional_rate_limits": null,
  "credits": {
    "has_credits": false,
    "unlimited": false,
    "overage_limit_reached": false,
    "balance": null,
    "approx_local_messages": null,
    "approx_cloud_messages": null
  },
  "spend_control": {
    "reached": false
  },
  "promo": null
}
```

### Integration test infrastructure

Integration tests run a real `opencode serve` instance against a fake LLM server:

- **`test/integration/fake-server/`** — Bun HTTP server implementing the OpenAI Responses API with SQLite-backed user accounts, rate limiting, and OAuth token support. Admin API for controlling limits and usage.
- **`test/integration/auth-plugin/`** — Test-only opencode plugin that provides a Codex-like fetch wrapper for the `"fake"` provider. Re-reads `auth.json` on every request and passes the access token as a Bearer header, without rewriting URLs.
- **`.test-env/`** — Isolated environment (gitignored) with its own `auth.json`, `multi-auth.db`, and `opencode.json`, controlled via `XDG_DATA_HOME` and `OPENCODE_CONFIG_DIR`.
