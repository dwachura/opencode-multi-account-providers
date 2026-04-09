# Multi-Account Plugin for OpenCode

External plugin that enables multi-account workflows for providers with subscription-based rate limits (e.g., ChatGPT Plus/Pro). When one account's rate limit is reached, automatically switches to the next available account.

## Constraints

- No opencode core modifications
- No code duplication from internal plugins (CodexAuthPlugin etc.)
- External v1 plugin only (`PluginModule` format)
- Separate storage file for multi-account data

## Architecture

### Core Idea

CodexAuthPlugin reads `getAuth()` → `auth.json` **on every fetch call** (`codex.ts:410`). The plugin manipulates auth.json as a side channel — writing a different account's credentials before the next request. CodexAuthPlugin does all the heavy lifting (OAuth token refresh, URL rewriting, header injection) unmodified.

### Hooks Used

| Hook          | Purpose                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------ |
| `chat.params` | Track `sessionID → providerID` mapping; detect new auth entries and auto-save to multi-account storage |
| `event`       | Listen for `session.status` retry events; set in-memory rotation flag on rate limit                    |

No `auth` hook — CodexAuthPlugin is fully preserved (methods, loader, fetch).

### Data Flow

```
                    ┌──────────────────────┐
                    │   multi-auth.json    │
                    │  (plugin's storage)  │
                    └──────┬───────────────┘
                           │ read/write
                    ┌──────┴───────────────┐
                    │   Plugin (external)  │
                    │                      │
  chat.params ──────┤  - session tracking  │
                    │  - auto-save new     │
  event ────────────┤    accounts          │
                    │  - rotation flag     │
                    │  - write auth.json   │
                    └──────┬───────────────┘
                           │ write via SDK client
                    ┌──────┴───────────────┐
                    │      auth.json       │
                    │  (opencode core)     │
                    └──────┬───────────────┘
                           │ getAuth() on every fetch
                    ┌──────┴───────────────┐
                    │   CodexAuthPlugin    │
                    │  (token refresh,     │
                    │   URL rewrite,       │
                    │   header injection)  │
                    └──────────────────────┘
```

### Request/Retry Timeline

```
1. chat.params runs (plugin checks rotation flag)
     ├─ flag set → rotate auth.json (await), clear flag
     └─ flag not set → check for new auth entries, proceed
2. streamText() called → AI SDK → CodexAuthPlugin fetch
     → getAuth() reads auth.json → uses current credentials
3. Response
     ├─ 2xx → success
     └─ 429 / rate limit → error propagates to retry system
4. SessionRetry.policy():
     a. Classifies error as retryable (message: "Rate Limited" etc.)
     b. Publishes session.status event { type: "retry", message, ... }
     c. Returns delay (≥2000ms without headers)
5. Event hook fires (forked fiber, async):
     → detects rate limit message
     → looks up provider via session→provider map
     → marks current account exhausted
     → sets needsRotation[sessionID] = true
6. Effect.sleep(delay) — event hook runs during this window
7. Retry: back to step 1 — chat.params sees flag, rotates
```

### Timing Characteristics

The event hook only sets an in-memory flag (sync variable assignment, <1ms). The actual auth.json write happens in `chat.params` which is awaited in the request pipeline before `streamText()`. This ensures the write completes before CodexAuthPlugin reads auth.json.

The only race: does the event hook's forked fiber set the flag before `chat.params` runs on retry? With `Effect.sleep(delay)` yielding to other fibers and minimum 2000ms delay, the risk is near-zero. Worst case (zero-delay retry-after header): the retry uses stale credentials, gets another 429, and the next retry succeeds with rotated credentials.

## Storage

### File Location

`${XDG_DATA_HOME:-~/.local/share}/opencode/multi-auth.json` — permissions `0o600`.

Same directory as `auth.json` for consistency. The plugin resolves the path from env or platform defaults.

### Schema

```json
{
  "openai": {
    "active": 0,
    "accounts": [
      {
        "label": "personal",
        "type": "oauth",
        "access": "eyJ...",
        "refresh": "eyJ...",
        "expires": 1749500000000,
        "accountId": "acct_abc123"
      },
      {
        "label": "work",
        "type": "oauth",
        "access": "eyJ...",
        "refresh": "eyJ...",
        "expires": 1749500000000,
        "accountId": "acct_def456"
      }
    ],
    "exhausted": [1]
  }
}
```

| Field       | Type        | Description                                                   |
| ----------- | ----------- | ------------------------------------------------------------- |
| `active`    | `number`    | Index of currently active account                             |
| `accounts`  | `Account[]` | Array of stored credentials (same shape as auth.json entries) |
| `exhausted` | `number[]`  | Indices of accounts exhausted in the current "cycle"          |

### Account Auto-Detection

The plugin detects new/changed auth entries automatically — no explicit "save" action needed.

In `chat.params` (runs before each request for the target provider):

1. Read auth.json for the provider (filesystem read, cached by mtime)
2. Compute a fingerprint (e.g., hash of `refresh` + `accountId` for OAuth, `key` for API)
3. Compare against known accounts in multi-auth.json
4. If no match → new account detected → append to `accounts`, set as `active`, write multi-auth.json

This means the user workflow for adding accounts is:

```
opencode auth login openai   → account A stored in auth.json
send any message              → plugin auto-saves A to multi-auth.json
opencode auth login openai   → account B overwrites auth.json
send any message              → plugin auto-saves B to multi-auth.json
```

### Exhaustion Reset

Exhaustion state (`exhausted` array) resets when a new session starts. The plugin listens for `session.created` events in the `event` hook and clears the array.

## Implementation Plan

### File Structure

```
opencode-plugin-multi-account/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts          # PluginModule entry point
    ├── storage.ts        # Multi-auth.json CRUD operations
    └── rotation.ts       # Rotation logic, exhaustion tracking
```

### Step 1: Project Scaffold

Create the npm package with:

- `package.json` — name, version, `engines.opencode`, `exports` (v1 plugin format), peer dep on `@opencode-ai/plugin`
- `tsconfig.json` — TypeScript config targeting Bun runtime
- Entry point exporting `PluginModule` with `{ id, server }`

### Step 2: Storage Module (`storage.ts`)

Functions:

- `path()` — resolve multi-auth.json location from `XDG_DATA_HOME` or platform default
- `read(provider)` — read and parse provider entry from multi-auth.json; return `{ active, accounts, exhausted }` or `undefined`
- `write(provider, data)` — write provider entry to multi-auth.json with `0o600` permissions
- `add(provider, label, entry)` — append account, deduplicate by fingerprint
- `activate(provider, index)` — set active index
- `exhaust(provider, index)` — add index to exhausted array
- `reset(provider)` — clear exhausted array
- `next(provider)` — find next non-exhausted account index, or `undefined` if all exhausted
- `fingerprint(entry)` — compute identity hash for deduplication (refresh token + accountId for OAuth, key for API)

All operations are synchronous file I/O (Bun.file / fs) since they run in `chat.params` (awaited) and `event` hook contexts.

### Step 3: Rotation Module (`rotation.ts`)

In-memory state:

- `sessions: Record<string, string>` — maps `sessionID → providerID`
- `pending: Record<string, boolean>` — maps `sessionID → needsRotation`

Functions:

- `track(sessionID, providerID)` — store session→provider mapping
- `flag(sessionID)` — set `pending[sessionID] = true`
- `consume(sessionID)` — if `pending[sessionID]`, delete and return `true`; else `false`
- `provider(sessionID)` — look up provider for session

### Step 4: Plugin Entry (`index.ts`)

The `server` function receives `PluginInput` and returns `Hooks`:

#### `chat.params` hook

```
1. if model.providerID not in managed providers → return
2. rotation.track(sessionID, providerID)
3. if rotation.consume(sessionID):
     a. storage.next(providerID) → nextIndex
     b. if nextIndex is undefined → all exhausted, return (let error propagate)
     c. storage.activate(providerID, nextIndex)
     d. read account credentials from multi-auth.json
     e. write to auth.json via input.client.auth.set()
4. else:
     a. read auth.json (mtime-cached)
     b. if credentials changed → storage.add(providerID, label, entry)
```

#### `event` hook

```
on session.status { type: "retry", message }:
  if message matches rate limit patterns ("Rate Limited", "Too Many Requests", etc.):
    providerID = rotation.provider(sessionID)
    if providerID and providerID in managed providers:
      storage.exhaust(providerID, storage.read(providerID).active)
      rotation.flag(sessionID)

on session.created:
  for each managed provider:
    storage.reset(providerID)
```

#### Rate limit message detection

Match against patterns from `session/retry.ts`:

- `"Rate Limited"`
- `"Too Many Requests"`
- message containing `"rate limit"` (case-insensitive)
- message containing `"too many requests"` (case-insensitive)

### Step 5: Auth.json Write via SDK Client

The plugin writes to auth.json using `input.client.auth.set()`:

```ts
await input.client.auth.set({
  providerID: "openai",
  auth: {
    type: "oauth",
    refresh: account.refresh,
    access: account.access,
    expires: account.expires,
    ...(account.accountId && { accountId: account.accountId }),
  },
})
```

This sends `PUT /auth/{providerID}` to the opencode server, which writes auth.json atomically with `0o600` permissions. CodexAuthPlugin's `getAuth()` reads the updated file on the next fetch.

### Step 6: Configuration

The plugin accepts options via the opencode config to define which providers are managed:

```json
{
  "plugin": [["opencode-plugin-multi-account", { "providers": ["openai"] }]]
}
```

Default: `["openai"]` if not specified.

### Step 7: Testing

- Unit tests for storage module (read/write/dedup/rotation)
- Unit tests for rotation state machine
- Integration test: simulate rate limit event → verify auth.json rotation
- Edge cases: all accounts exhausted, single account (no rotation), new account detection

## Event Payloads Reference

### `session.status` (retry)

```ts
{
  type: "session.status",
  properties: {
    sessionID: string,
    status: {
      type: "retry",
      attempt: number,
      message: string,    // "Rate Limited", "Too Many Requests", etc.
      next: number,       // epoch ms of next retry
    }
  }
}
```

### `session.error`

```ts
{
  type: "session.error",
  properties: {
    sessionID?: string,
    error?: {
      name: "APIError",
      data: {
        message: string,
        statusCode?: number,       // 429 for rate limits
        isRetryable: boolean,
        responseHeaders?: Record<string, string>,
        responseBody?: string,
      }
    }
  }
}
```

### `session.created`

```ts
{
  type: "session.created",
  properties: {
    sessionID: string,
    info: SessionInfo,
  }
}
```

## Provider-Agnostic Design

The storage, rotation, and event detection logic is provider-agnostic. The only provider-specific aspect is which providers are "managed" (via config). Adding support for another provider (e.g., Anthropic with multiple API keys) requires only adding the provider ID to the config list.

The fingerprinting logic handles both OAuth entries (fingerprint by `refresh` + `accountId`) and API key entries (fingerprint by `key`).

## Future: Deterministic Approaches

The current event-based approach has a near-zero timing risk. If this becomes a problem, these upstream changes to opencode would enable fully deterministic solutions:

### Option A: `fetch.intercept` hook

```ts
"fetch.intercept"?: (
  input: { providerID: string; url: URL; init: RequestInit },
  next: (url: URL, init: RequestInit) => Promise<Response>
) => Promise<Response>
```

Plugin wraps the existing fetch pipeline. Can inspect response, catch 429, rotate, and retry within the same synchronous call chain. Zero duplication — CodexAuthPlugin's fetch is the `next()` function.

### Option B: `retry.before` hook

```ts
"retry.before"?: (
  input: {
    sessionID: string; providerID: string; modelID: string;
    error: { status: number; code: string; message: string };
    attempt: number
  },
  output: { handled: boolean }
) => Promise<void>
```

Called synchronously in the retry pipeline, before the delay. Runs in the request fiber — fully deterministic. Plugin rotates credentials and sets `output.handled = true` to skip backoff.

### Option C: Composable auth loaders

Instead of last-plugin-wins for `auth.loader`, the provider system chains loaders. Each receives the previous loader's output:

```ts
async loader(getAuth, provider, previousOptions) {
  const prevFetch = previousOptions.fetch
  return {
    fetch: async (input, init) => {
      const res = await prevFetch(input, init)
      if (res.status === 429) { /* rotate and retry */ }
      return res
    }
  }
}
```

Zero duplication — delegates to CodexAuthPlugin's fetch via `prevFetch`.

### Option D: Re-exported helpers

`@opencode-ai/plugin` re-exports CodexAuthPlugin's stateless helpers (PKCE generation, token refresh, URL rewriting). External plugins import and compose without duplicating implementation.

### Recommendation

**Option A** (`fetch.intercept`) is the most general-purpose and would benefit the entire plugin ecosystem. **Option C** (composable loaders) is the most targeted for this specific use case. Either would eliminate the timing concern entirely.
