# opencode-auth-pool

Bare OpenCode plugin foundation for multi-account provider management.

## Current State

- server plugin initializes global SQLite storage and logs
- TUI plugin registers `/provider-accounts`
- `/provider-accounts` opens a placeholder dialog
- no auth mutation, OAuth flow, provider integration, rate-limit detection, or account rotation yet

## Structure

```txt
package.json
bun.lock
package-lock.json
tsconfig.json
scripts/opencode-sandbox.mjs
src/server/config.ts
src/server/db.ts
src/server/index.ts
src/server/logger.ts
src/shared/constants.ts
src/tui/constants.ts
src/tui/index.tsx
src/tui/provider-accounts.tsx
test/*.test.mjs
```

## Entrypoints

`src/server/index.ts` default-exports `{ id, server }`.

`src/tui/index.tsx` default-exports `{ id, tui }`.

OpenCode rejects a default export containing both `server()` and `tui()`, so server and TUI targets stay separate.

## Development

Bun is primary for local development:

```sh
bun install
bun run test
bun run opencode:sandbox
```

npm remains supported:

```sh
npm install
npm test
npm run opencode:sandbox
```

Track both lockfiles:

- `bun.lock` is canonical
- `package-lock.json` is npm compatibility output

Dependency updates use Bun first, then refresh npm compatibility:

```sh
bun add <package>
npm install --package-lock-only
```

Package scripts stay package-manager neutral so both Bun and npm work.

## Install

Local package config uses an absolute `file://` URL in both OpenCode config files.

`opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["file:///absolute/path/to/opencode-auth-pool"]
}
```

`tui.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["file:///absolute/path/to/opencode-auth-pool"]
}
```

Released package config uses the npm package name in both files.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-auth-pool"]
}
```

OpenCode installs npm plugins automatically at startup and caches dependencies under its cache directory.

## Configuration

Plugin options use OpenCode's plugin tuple syntax:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [["opencode-auth-pool", { "logLevel": "info" }]]
}
```

`logLevel` controls plugin-emitted OpenCode app log severity. Default: `info`. Valid values: `debug`, `info`, `warn`, `error`.

## Storage

The server entrypoint initializes a SQLite database at:

```txt
<OpenCode global data dir>/plugins/opencode-auth-pool/db.sqlite
```

On Linux/XDG this resolves under:

```txt
${XDG_DATA_HOME:-~/.local/share}/opencode/plugins/opencode-auth-pool/db.sqlite
```

The database currently contains one table, `accounts`, for signed-in provider accounts. Accounts are deduped by `(provider, account_id)`. Multiple accounts can be active for the same provider, and exhausted state is independent from active state.

Database access currently lives in the server entrypoint only: `src/server/db.ts`. The TUI plugin is a separate OpenCode runtime and does not directly import or call server DB functions.

## Sandbox Smoke Test

Run installed `opencode` from `PATH` against this plugin without touching user OpenCode config, state, cache, data, or provider credentials.

```sh
bun run build
bun run opencode:sandbox
```

Useful variants:

```sh
bun run opencode:sandbox -- --dry-run
bun run opencode:sandbox -- --released --plugin opencode-auth-pool
bun run opencode:sandbox -- --opencode /custom/bin/opencode
bun run opencode:sandbox -- --keep
```

The sandbox runner sets isolated `HOME`, XDG dirs, `OPENCODE_CONFIG_DIR`, and `OPENCODE_DB`. It sets `OPENCODE_DISABLE_PROJECT_CONFIG=true` and `OPENCODE_DISABLE_DEFAULT_PLUGINS=true`.

It does not set `OPENCODE_PURE=true` because that disables external plugins.

It removes common provider API environment variables.

## Specs

- `specs/product-spec.md`
- `specs/decisions/001-plugin-runtime-split.md`
- `specs/decisions/002-server-persistent-storage.md`
- `specs/backlog/README.md`
- `specs/findings/`
