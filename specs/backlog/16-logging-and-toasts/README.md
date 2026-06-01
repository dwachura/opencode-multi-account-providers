# Logging And Toasts

Priority: P2

## User Story

As an OpenCode user, I want clear feedback when the plugin captures, switches, exhausts, rotates, or fails so automatic account behavior remains understandable.

## Problem

Account switching and retry handling are asynchronous. Without concise feedback, users cannot tell whether work continued under another account, failed to sync, or exhausted all options.

## Scope

- Emit TUI toasts for user-visible management actions.
- Optionally use TUI attention notifications for high-salience terminal states.
- Emit server logs for runtime detection, attribution, exhaustion, and rotation.
- Include provider ID and safe account id suffix where useful.
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

## Implementation Phase Alignment

Cross-Phase Feedback
- Add feedback with the owning business phase rather than as unrelated infrastructure.
- Phase 4: account captured/OAuth failed feedback.
- Phase 5: active switch success, timeout, mismatch feedback.
- Phase 6: remove success/failure feedback.
- Phase 7: sync/reconciliation failure feedback.
- Phase 8: manual rotation feedback if surfaced in TUI.
- Phase 9: runtime detection, attribution skip, exhaustion, rotation, and all-exhausted feedback.
- Tests: each owning phase must assert safe user-visible messages and server logs do not leak tokens.

## Acceptance Criteria

- Given an account is captured, then the user can see concise confirmation in TUI flow.
- Given active switch succeeds or times out, then feedback clearly states the result.
- Given a rate limit triggers exhaustion, then logs identify provider and account without leaking tokens.
- Given attribution is skipped for safety, then logs explain the skip reason.
- Given all accounts are exhausted, then user-facing feedback names the provider and recovery options.

## Implementation Notes

- Never log OAuth tokens or full credential payloads.
- Prefer account ids or short account id suffixes for account references.
- Keep logs structured enough for debugging but concise enough for normal use.
- TUI feedback can use `api.ui.toast`; terminal cases may use `api.attention.notify` if not too noisy.

## Open Questions

- Whether server-runtime events can be bridged to TUI notifications live.
