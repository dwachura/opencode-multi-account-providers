# opencode-multi-account-providers

An [opencode](https://opencode.ai) v1 plugin that automatically rotates between multiple OAuth accounts for the same LLM provider when one hits a rate limit.

If you have two ChatGPT Pro subscriptions and one gets rate-limited mid-conversation, this plugin transparently switches to the other account on the next retry — no manual intervention needed.

## How it works

The plugin uses `auth.json` as a side-channel. When a rate limit is detected, it writes the next account's OAuth credentials to `auth.json` so the provider's auth plugin (e.g., the built-in Codex plugin for OpenAI) picks them up on the next request.

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

This plugin only works with **OAuth-based accounts** (e.g., ChatGPT Pro/Plus subscriptions authenticated via browser login). API key accounts are not supported because their credentials are cached by the SDK at startup and not re-read on each request.

The rotation mechanism depends on the provider's auth plugin implementing a per-request fetch wrapper that re-reads `auth.json` before every HTTP call. The built-in **Codex plugin** (which handles OpenAI OAuth) does this. Custom providers or API-key-based providers do not.

## Installation

```bash
bun install
```

Add the plugin to your `opencode.json`:

```json
{
  "plugin": [
    ["opencode-multi-account-providers", { "providers": ["openai"] }]
  ]
}
```

### Options

| Option | Type | Default | Description |
|---|---|---|---|
| `providers` | `string[]` | `["openai"]` | Provider IDs to manage. Only providers with OAuth auth and a compatible auth plugin (like Codex) will work. |

## Setup

1. Log in to opencode with your first account (`/connect` or `opencode auth login openai`)
2. Send a message — the plugin auto-detects the account from `auth.json`
3. Log in with your second account
4. Send another message — the plugin detects the new account
5. Both accounts are now tracked in `multi-auth.json`

From this point on, rate limits trigger automatic rotation.

## Architecture

### Files

```
src/
  index.ts       Plugin entry — chat.params and event hooks
  storage.ts     multi-auth.json CRUD, auth.json reading with mtime cache
  rotation.ts    In-memory session-to-provider tracking, rotation flags
```

### Storage (`multi-auth.json`)

The plugin maintains its own credential store at `$XDG_DATA_HOME/opencode/multi-auth.json` (alongside opencode's `auth.json`). Each managed provider gets an entry:

```json
{
  "openai": {
    "active": 0,
    "accounts": [
      { "type": "oauth", "access": "...", "refresh": "...", "expires": 123, "accountId": "acct_1" },
      { "type": "oauth", "access": "...", "refresh": "...", "expires": 123, "accountId": "acct_2" }
    ],
    "exhausted": [0]
  }
}
```

Accounts are deduplicated by a SHA-256 fingerprint based on `accountId` (stable across token refreshes) or `refresh` token as fallback.

### Hooks

**`chat.params`** (awaited before every LLM request):
- Tracks which session maps to which provider
- On normal path: reads `auth.json`, auto-detects and stores new OAuth accounts
- On rotation path: consumes the rotation flag, activates the next non-exhausted account, writes its credentials to `auth.json` via `client.auth.set()`

**`event`** (fire-and-forget on every bus event):
- On `session.status` with `type: "retry"`: checks if the message indicates a rate limit, exhausts the account that was used for the request, flags rotation for the session
- On `session.created`: resets exhaustion for all managed providers

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
- **OAuth provider with per-request auth.json reads.** The built-in Codex plugin (for OpenAI) implements a custom `fetch` wrapper that calls `getAuth()` on every HTTP request, re-reading `auth.json` each time. This is what makes the side-channel rotation work. Providers that resolve credentials once at startup (API key providers, custom providers without an auth plugin) will not pick up rotated credentials.
- **File-based auth.json.** The plugin reads and writes `$XDG_DATA_HOME/opencode/auth.json` directly (for reading) and via `client.auth.set()` (for writing). This assumes opencode's auth storage is file-based at that path.
- **Synchronous event hooks.** The `event` hook must complete synchronously. All rotation state operations are single-line assignments with no I/O.

## Known limitations

- **Exhaustion reset is per-session.** Currently, `session.created` clears the exhaustion list. Rate limits are global (provider-side), so a new session will re-try accounts that may still be rate-limited. A better approach would be time-based expiry or manual reset.
- **Single wasted retry after rotation.** Due to credential caching in the provider's fetch wrapper, the first retry after rotation may still use the old account's credentials. The second retry will use the new ones.

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
```

### Integration test infrastructure

Integration tests run a real `opencode serve` instance against a fake LLM server:

- **`test/integration/fake-server/`** — Bun HTTP server implementing the OpenAI Responses API with SQLite-backed user accounts, rate limiting, and OAuth token support. Admin API for controlling limits and usage.
- **`test/integration/auth-plugin/`** — Test-only opencode plugin that provides a Codex-like fetch wrapper for the `"fake"` provider. Re-reads `auth.json` on every request and passes the access token as a Bearer header, without rewriting URLs.
- **`.test-env/`** — Isolated environment (gitignored) with its own `auth.json`, `multi-auth.json`, and `opencode.json`, controlled via `XDG_DATA_HOME` and `OPENCODE_CONFIG_DIR`.
