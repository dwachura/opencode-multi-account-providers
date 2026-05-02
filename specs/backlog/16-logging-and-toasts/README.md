# Logging And Toasts

Priority: P2

## User Story

As an OpenCode user, I want clear feedback when the plugin captures, switches, exhausts, rotates, or fails so automatic account behavior remains understandable.

## Problem

Account switching and retry handling are asynchronous. Without concise feedback, users cannot tell whether work continued under another account, failed to sync, or exhausted all options.

## Scope

- Emit TUI toasts for user-visible management actions.
- Emit server logs for runtime detection, attribution, exhaustion, and rotation.
- Include provider ID and safe account label/fingerprint suffix where useful.
- Report sync timeouts and unsafe attribution skips.
- Report all-accounts-exhausted terminal state.

## Out Of Scope

- Full audit log UI.
- Sensitive credential logging.
- Analytics or telemetry export.

## Dependencies

- Local TUI manager.
- Manual switch flow.
- Runtime rate-limit, attribution, and rotation flows.

## Acceptance Criteria

- Given an account is captured, then the user can see concise confirmation in TUI flow.
- Given active switch succeeds or times out, then feedback clearly states the result.
- Given a rate limit triggers exhaustion, then logs identify provider and account without leaking tokens.
- Given attribution is skipped for safety, then logs explain the skip reason.
- Given all accounts are exhausted, then user-facing feedback names the provider and recovery options.

## Implementation Notes

- Never log OAuth tokens or full credential payloads.
- Prefer labels and short fingerprint suffixes for account references.
- Keep logs structured enough for debugging but concise enough for normal use.

## Open Questions

- Exact TUI toast API availability from plugin context.
- Whether server-runtime events can be bridged to TUI notifications live.
