# Safe Retry Attribution

Priority: P2

## User Story

As an OpenCode user, I want rate-limit consequences assigned to the account that started the failed request so the plugin does not exhaust the wrong account after async auth changes.

## Problem

Retry events can arrive after auth changed. Current active account is not always the account that caused the failed request. Incorrect blame corrupts exhaustion state and rotation behavior.

## Scope

- Capture request context with `sessionID`, `providerID`, request/message id when available, and `startedAt` during request setup.
- Maintain in-memory auth timeline intervals per provider from reconciliation events.
- Resolve the account active at request start by matching `startedAt` against timeline intervals.
- Join historical account identity to current storage by account id.
- Skip exhaustion when attribution cannot be proven safely.

## Out Of Scope

- Persisting historical auth timeline across restarts.
- Guessing attribution from current active account when timeline is missing.
- Reconstructing old timelines from logs.

## Dependencies

- Request setup hook.
- Host auth sync and reconciliation events.
- Provider account identity extraction.
- Multi-account inventory.

## Acceptance Criteria

- Given request starts under account A and auth later switches to B, when A's retry event arrives, then attribution resolves to A.
- Given no auth interval matches the request start, then exhaustion is skipped.
- Given the historical account id no longer maps to current storage, then exhaustion is skipped.
- Given attribution is safe and rate limit is detected, then the responsible account id is returned for exhaustion marking.
- Given multiple sessions retry concurrently, then attribution remains separated by session/request context.
- Given multiple requests can overlap in one session, then attribution uses message/request id when available and skips if session-level data is insufficient.

## Implementation Notes

- Timeline is in-memory process state; storage remains source for current account inventory.
- Reconciliation should open/close intervals when active auth changes or disappears.
- Request context should be captured early enough before any staged rotation mutates auth.
- `chat.params` input includes `sessionID`, provider, and user message data; use the user message id as the request key when possible.

## Open Questions

- How to distinguish multiple requests within one session if OpenCode event granularity is session-level.
