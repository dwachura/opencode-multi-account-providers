# Local TUI Manager

Priority: P1

## User Story

As an OpenCode user, I want a local `/provider-accounts` TUI manager so I can inspect accounts, connect accounts, switch active account, reset exhaustion, and disconnect accounts without sending a model request.

## Problem

Account management is local plugin state and host auth coordination. It should not be implemented as a server slash-command that triggers model execution.

## Scope

- Register a local TUI palette command exposed as `/provider-accounts`.
- Display providers and their stored accounts.
- Show active and exhausted markers.
- Provide actions for connect, set active, reset exhausted, and disconnect.
- Show success/failure feedback for async operations.
- Discover and call the plugin-owned loopback bridge for account state and mutations.
- Show a clear local error when the bridge is unavailable or stale.
- Use TUI plugin modes for route/modal-specific bindings when the manager grows beyond simple dialogs.

## Out Of Scope

- Non-TUI management parity.
- Rich account profile inspection.
- Advanced bulk editing beyond reset-all exhausted if implemented.

## Dependencies

- Multi-account inventory.
- TUI/server bridge API from `specs/backlog/01-tui-oauth-account-definition/README.md`.
- Manual active account switcher.
- Reset exhausted accounts.
- Disconnect/remove accounts.
- Connect extra accounts.

## Implementation Phase Alignment

Phase 2: Provider Listing UI
- Display providers returned from the local API.
- Keep provider SDK calls server-side only.
- Depend on the bridge/API setup implemented by `01`.
- Tests: cover TUI loading, success, and error provider states plus client response parsing.

Phase 3: Account Listing UI
- Display stored accounts grouped by provider using the server inventory API.
- Tests: cover empty, grouped, active/exhausted/sync-status, and error states.

Later Operation Surfaces
- Add connect, activate, remove, sync, reset, and rotate controls only after their owning backlog phases are implemented and tested server-side.
- Tests for each UI action belong with the owning business phase and must include refresh/error behavior.

## Acceptance Criteria

- Given the user invokes `/provider-accounts`, then no model request is sent.
- Given accounts exist, then the TUI lists them with label, active state, and exhausted state.
- Given no accounts exist, then the TUI shows an empty state and connect action.
- Given an action completes, then the TUI refreshes through a server-backed bridge rather than stale local assumptions.
- Given an action fails or times out, then the TUI shows a clear local error.
- Given bridge discovery fails, then the TUI reports that the server-side plugin bridge is unavailable.

## Implementation Notes

- Keep the command TUI-local because server `command.execute.before` is not the right completion boundary.
- Prefer `api.keymap.registerLayer` with palette namespace and `slashName`; `api.command` is legacy/deprecated in current OpenCode findings.
- Use `api.ui.Dialog*`, `DialogSelect`, `DialogPrompt`, and `api.ui.toast` for local flows.
- Use `api.mode.push(...)` for manager-owned keybinding modes instead of always-active bindings.
- OpenCode scopes keymap, route, event, slot, mode, and attention soundboard cleanup to plugin activation; explicit lifecycle cleanup is for non-scoped resources.
- Avoid embedding storage mutations in UI components.
- Refresh after each mutation through server-backed inventory reads from `/opencode-auth-pool`.
- The bridge is plugin-owned infrastructure discovered by metadata, not an OpenCode SDK plugin RPC.

## Open Questions

- Whether provider selection appears first or accounts are grouped on one screen.
