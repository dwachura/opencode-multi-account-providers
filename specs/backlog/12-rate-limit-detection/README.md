# Rate-Limit Detection

Priority: P2

## User Story

As an OpenCode user, I want the plugin to detect provider rate-limit or quota-limit failures so it can trigger fallback account behavior without manual intervention.

## Problem

Plugin events expose retry and final error information, but not a universal typed provider exhaustion signal. The plugin needs conservative classification from available OpenCode events.

## Scope

- Listen to server plugin `event` hook.
- Treat `session.status` retry events with `status.action.reason === "account_rate_limit"` as strong account-limit signals.
- Treat `session.status` retry events with rate-limit-like messages as live rate-limit signals.
- Treat `session.error` `APIError` with `statusCode === 429` as final rate-limit failure.
- Extract retry timing from `status.next` or final error headers when available.
- Classify temporary rate limits, quota/billing exhaustion hints, and provider overload messages.

## Out Of Scope

- Raw HTTP response interception for successful requests.
- Provider-specific quota prediction.
- Recomputing OpenCode backoff when `status.next` is available.

## Dependencies

- Server plugin hooks.
- Event payload types from OpenCode.

## Implementation Phase Alignment

Phase 9A: Rate-Limit Detection
- Split detection from attribution and rotation.
- Listen to server plugin events and emit internal rate-limit signals only.
- Treat `session.status` retry with `status.action.reason === "account_rate_limit"` as the strongest account-limit signal.
- Tests: cover strong retry signal, rate-limit-like retry messages, final `429` errors, retry-after metadata, non-rate-limit errors, and ambiguous classification avoiding exhaustion.

## Acceptance Criteria

- Given a `session.status` retry message mentions rate limit, too many requests, or overloaded, then the plugin emits an internal rate-limit signal.
- Given a `session.status` retry action has `reason === "account_rate_limit"`, then the plugin emits a strong account-limit signal.
- Given a `session.error` APIError has `statusCode === 429`, then the plugin emits a final rate-limit signal.
- Given final error headers contain retry-after values, then the plugin records them as metadata.
- Given a non-rate-limit API error occurs, then no exhaustion mutation is triggered.
- Given message classification is ambiguous, then the plugin avoids strong exhaustion behavior unless later stories can safely proceed.

## Implementation Notes

- Use `session.status` for live backoff state and `session.error` for final failure metadata.
- Prefer structured `status.action.reason` when available before falling back to message classification.
- Prefer conservative matching over broad generic error matching.
- Treat provider overload as transient/provider-level unless later provider-specific policy proves account exhaustion.
- Detection alone should not mark accounts exhausted until attribution can identify the responsible account.

## Open Questions

- Exact set of provider message substrings for initial classifier.
- Whether any provider-specific overload message should be promoted from provider-level transient state to account exhaustion.
