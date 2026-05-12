# Local TUI Manager

Priority: P1

## User Story

As an OpenCode user, I want a local `/provider-accounts` TUI manager so I can inspect accounts, connect accounts, switch active account, reset exhaustion, and disconnect accounts without sending a model request.

## Problem

Account management is local plugin state and host auth coordination. It should not be implemented as a server slash-command that triggers model execution.

## Scope

- Register a local TUI command named `/provider-accounts`.
- Display providers and their stored accounts.
- Show active and exhausted markers.
- Provide actions for connect, set active, reset exhausted, and disconnect.
- Show success/failure feedback for async operations.

## Out Of Scope

- Non-TUI management parity.
- Rich account profile inspection.
- Advanced bulk editing beyond reset-all exhausted if implemented.

## Dependencies

- Multi-account inventory.
- Manual active account switcher.
- Reset exhausted accounts.
- Disconnect/remove accounts.
- Connect extra accounts.

## Acceptance Criteria

- Given the user invokes `/provider-accounts`, then no model request is sent.
- Given accounts exist, then the TUI lists them with label, active state, and exhausted state.
- Given no accounts exist, then the TUI shows an empty state and connect action.
- Given an action completes, then the TUI refreshes through a server-backed bridge rather than stale local assumptions.
- Given an action fails or times out, then the TUI shows a clear local error.

## Implementation Notes

- Keep the command TUI-local because server `command.execute.before` is not the right completion boundary.
- Avoid embedding storage mutations in UI components.
- Refresh after each mutation through server-backed inventory read once the bridge exists.

## Open Questions

- Exact OpenCode TUI APIs for dialogs, selectors, and toasts.
- Whether provider selection appears first or accounts are grouped on one screen.
