# All-Accounts-Exhausted Failure

Priority: P2

## User Story

As an OpenCode user, I want a clear failure when every stored account is exhausted so I know rotation cannot continue and what action is needed.

## Problem

Without terminal handling, the plugin could silently keep retrying exhausted accounts or fail with generic provider errors that hide the actual multi-account state.

## Scope

- Detect when rotation has no usable account candidate.
- Stop automatic rotation for that provider/session.
- Surface a clear all-accounts-exhausted message.
- Include provider ID and suggested user recovery actions.
- Preserve exhausted state until user resets or reconnects accounts.

## Out Of Scope

- Automatically buying quota or changing billing state.
- Auto-resetting exhausted accounts.
- Inventing fallback providers.

## Dependencies

- On-the-fly account rotation.
- Exhausted-account tracking.
- Logging/toast surface for feedback.

## Acceptance Criteria

- Given all accounts for a provider are exhausted, when rotation scans candidates, then it returns a terminal no-candidate result.
- Given terminal exhaustion occurs, then the user sees a clear message rather than silent retry looping.
- Given the user resets an exhausted account, then later rotation can use it again.
- Given a new account is connected, then terminal state no longer blocks future rotation if the account is usable.
- Given terminal failure occurs in server runtime, then enough context is logged for TUI/user feedback.

## Implementation Notes

- Treat terminal exhaustion as product state, not provider auth state.
- Message should suggest reset exhausted accounts, wait for provider limit window, or connect another account.
- Avoid clearing active auth just because all accounts are exhausted.
- A retry event cannot directly abort or rewrite the in-flight provider request through plugin hooks; enforce terminal behavior at the next safe pre-request boundary unless a deliberate session API path is added.

## Open Questions

- Whether terminal state should be per session only or persisted per provider until account state changes.
- Whether to add deliberate session-abort integration later, or only report/stage terminal failure state.
