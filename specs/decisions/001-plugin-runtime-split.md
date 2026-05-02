# Decision: Split Server And TUI Plugins

## Context

OpenCode loads server and TUI plugins as separate runtime targets.

Server plugins can observe runtime hooks and events. TUI plugins can register local commands, dialogs, selectors, routes, slots, and toasts.

This project needs both sides:

- runtime-side rate-limit detection, retry attribution, and future account rotation
- TUI-local `/provider-accounts` account management

## Decision

Ship one package with two plugin entrypoints:

- `./server` exports the server plugin
- `./tui` exports the TUI plugin

Each entrypoint default-exports exactly one OpenCode plugin module shape:

- server entrypoint: `{ id, server }`
- TUI entrypoint: `{ id, tui }`

Do not default-export both `server()` and `tui()` from the same file.

## Consequences

The package manifest exposes:

```json
{
  "main": "./dist/server/index.js",
  "exports": {
    "./server": "./dist/server/index.js",
    "./tui": "./dist/tui/index.js"
  }
}
```

Users must install/configure the package for both OpenCode server config and TUI config when they want both runtime and local UI behavior.

Server-only code belongs under `src/server/`, TUI-only code belongs under `src/tui/`, and shared code belongs under `src/shared/` so runtime policy and TUI behavior do not drift.
