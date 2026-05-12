# Manual Active Account Switcher

Priority: P1

## User Story

As an OpenCode user, I want to manually choose the active stored account for a provider so future model requests use that account without redoing provider login.

## Problem

Stored accounts are only useful if the user can intentionally make one account live. The switch must go through OpenCode auth APIs and be confirmed through synced state, not local optimistic state.

## Scope

- Select a stored account by provider and account id.
- Write that account's OAuth credentials through `auth.set(...)`.
- Wait for host auth sync to confirm the expected account id.
- Report timeout or mismatch as unconfirmed switch.
- Define switching as affecting subsequent requests only.

## Out Of Scope

- Rewriting in-flight model requests.
- Switching to accounts with unsafe or missing stored credentials.
- Automatically resetting exhausted state when manually selected.

## Dependencies

- Multi-account inventory.
- Stored OAuth credentials.
- Host auth sync confirmation.
- OpenCode `auth.set(...)` access.

## Acceptance Criteria

- Given a stored inactive account, when the user sets it active, then `auth.set(...)` is called with that account's credentials.
- Given auth sync confirms the account id, then the switch is reported successful.
- Given auth sync times out, then the switch is reported as unconfirmed and local active state is not falsely changed.
- Given the requested account id does not exist, then no auth mutation is attempted.
- Given a request is already in flight, then the switch only applies to later requests.

## Implementation Notes

- Expose server-side switching behavior; TUI invocation needs an explicit bridge.
- Do not mutate `auth.json` directly.
- Exhausted accounts may still be manually selected unless product policy later forbids it.

## Open Questions

- Should manual selection warn when choosing an exhausted account.
- Should manual switch clear pending automatic rotation for the same provider.
