# Decision: Server Persistent Storage

## Context

The plugin needs durable account state for multiple signed-in accounts per provider. OpenCode owns live provider auth, while plugin storage owns account-management policy state.

Server and TUI plugins run as separate OpenCode runtimes. TUI code cannot directly call server module functions or share in-memory state with server code.

## Decision

Use a server-owned SQLite database initialized by the server plugin.

Default path:

```txt
<OpenCode global data dir>/plugins/opencode-auth-pool/db.sqlite
```

On Linux/XDG:

```txt
${XDG_DATA_HOME:-~/.local/share}/opencode/plugins/opencode-auth-pool/db.sqlite
```

Implementation lives in `src/server/db.ts`.

TUI access requires an explicit bridge in a later story; the TUI plugin must not import server DB functions directly.

## Schema

Storage uses one table, `accounts`:

```sql
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  account_id TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  access_token_expires_at TEXT,
  refresh_token_expires_at TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  exhausted INTEGER NOT NULL DEFAULT 0,
  exhausted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(provider, account_id)
)
```

## Semantics

- `id` is a plugin-generated UUID.
- `(provider, account_id)` is the dedupe key.
- `account_id` is provider-local stable identity extracted from auth.
- `active` means selectable/eligible; multiple accounts can be active for one provider.
- `exhausted` is independent from `active`.
- `exhausted_at` is set when exhausted and cleared when exhaustion is reset.
- Timestamps are ISO strings.
- Live OpenCode auth remains external source of request-time truth.

## DB API

`openDb(options?)` returns a small DB object:

- `close()`
- `listAccounts(provider?)`
- `upsertAccount(input)`
- `setAccountActive(id, active)`
- `setAccountExhausted(id, exhausted)`
- `deleteAccount(id)`

`openDb()` creates the parent directory, opens SQLite, and runs private schema bootstrap with `CREATE TABLE IF NOT EXISTS`.

## Upsert Rules

`upsertAccount(input)` matches by `(provider, account_id)`.

On insert:

- generates UUID
- sets `created_at` and `updated_at`
- defaults `active = 1`
- defaults `exhausted = 0`

On update:

- replaces access token, refresh token, and expiration timestamps
- updates `updated_at`
- preserves `id`
- preserves `created_at`
- preserves `active`
- preserves `exhausted`
- preserves `exhausted_at`

## Consequences

The current storage layer is intentionally small and easy to refactor. It does not include migrations, encryption, project-scoped storage, direct TUI access, auth mutation, OAuth flow, or account rotation.
