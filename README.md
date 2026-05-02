# opencode-multi-account-providers

Bare OpenCode plugin foundation for multi-account provider management.

## Current State

- server plugin initializes and logs
- TUI plugin registers `/provider-accounts`
- `/provider-accounts` opens a placeholder dialog
- no account storage, auth mutation, OAuth flow, provider integration, rate-limit detection, or account rotation yet

## Structure

```txt
package.json
bun.lock
package-lock.json
tsconfig.json
scripts/opencode-sandbox.mjs
src/server/config.ts
src/server/index.ts
src/server/logger.ts
src/shared/types.ts
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
  "plugin": ["file:///absolute/path/to/opencode-multi-account-providers"]
}
```

`tui.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["file:///absolute/path/to/opencode-multi-account-providers"]
}
```

Released package config uses the npm package name in both files.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-multi-account-providers"]
}
```

OpenCode installs npm plugins automatically at startup and caches dependencies under its cache directory.

## Configuration

Plugin options use OpenCode's plugin tuple syntax:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [["opencode-multi-account-providers", { "logLevel": "info" }]]
}
```

`logLevel` controls plugin-emitted OpenCode app log severity. Default: `info`. Valid values: `debug`, `info`, `warn`, `error`.

## Sandbox Smoke Test

Run installed `opencode` from `PATH` against this plugin without touching user OpenCode config, state, cache, data, or provider credentials.

```sh
bun run build
bun run opencode:sandbox
```

Useful variants:

```sh
bun run opencode:sandbox -- --dry-run
bun run opencode:sandbox -- --released --plugin opencode-multi-account-providers
bun run opencode:sandbox -- --opencode /custom/bin/opencode
bun run opencode:sandbox -- --keep
```

The sandbox runner sets isolated `HOME`, XDG dirs, `OPENCODE_CONFIG_DIR`, and `OPENCODE_DB`. It sets `OPENCODE_DISABLE_PROJECT_CONFIG=true` and `OPENCODE_DISABLE_DEFAULT_PLUGINS=true`.

It does not set `OPENCODE_PURE=true` because that disables external plugins.

It removes common provider API environment variables.

## Specs

- `specs/product-spec.md`
- `specs/decisions/001-plugin-runtime-split.md`
- `specs/backlog/README.md`
- `specs/findings/`
