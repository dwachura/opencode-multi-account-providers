# Reset Exhausted Accounts

Priority: P1

## User Story

As an OpenCode user, I want to reset exhausted accounts after quota windows recover so those accounts become eligible for automatic rotation again.

## Problem

Exhaustion is plugin policy state, not provider state. The user needs a simple manual way to clear it without reconnecting accounts.

## Scope

- Clear exhausted state for one account.
- Clear exhausted state for all accounts under a provider.
- Reflect reset state in TUI inventory.
- Do not force active account changes during reset.
- Persist reset changes for server runtime rotation.

## Out Of Scope

- Verifying provider quota recovery.
- Automatic reset based on provider headers or time windows.
- Resetting provider-side rate limits.

## Dependencies

- Exhausted-account tracking.
- Multi-account inventory.
- Local TUI manager.

## Acceptance Criteria

- Given an exhausted account, when the user resets it, then it is no longer excluded from automatic rotation.
- Given several accounts are exhausted, when the user resets all, then all become rotation-eligible.
- Given the reset account is inactive, then active auth remains unchanged.
- Given the reset account is active, then active auth remains unchanged.
- Given reset is persisted, then server runtime observes the new eligibility without restart.

## Implementation Notes

- Reset is local trust-based state mutation.
- Keep reset independent from active switching.
- Later automation can add expiry-based reset without changing core manual semantics.

## Open Questions

- Whether reset all should apply per provider or globally across providers.
- Whether UI should show last exhausted reason/time if added later.
