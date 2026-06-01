# Exhausted-Account Tracking

Priority: P1

## User Story

As an OpenCode user, I want the plugin to remember which accounts hit limits so automatic fallback does not keep selecting known exhausted accounts.

## Problem

An account can remain connected but temporarily unsuitable for automatic continuation. The plugin needs persistent per-account exhaustion state separate from live provider auth.

## Scope

- Mark an account exhausted by row id or `(provider, account_id)`.
- Store optional exhaustion metadata such as reason, source event, and timestamp.
- Exclude exhausted accounts from automatic rotation candidate selection.
- Keep exhausted accounts visible and manually manageable.
- Preserve exhausted state across token refresh and process restart.

## Out Of Scope

- Predicting quota reset time.
- Automatically verifying whether an exhausted account has recovered.
- Removing or logging out exhausted accounts.

## Dependencies

- Shared persistent storage.
- Multi-account inventory.

## Implementation Phase Alignment

Phase 8: Rotation Candidate State
- Provide the exhaustion state required by manual and automatic rotation candidate selection.
- Keep exhausted accounts visible in inventory but excluded from automatic rotation.
- Tests: cover mark exhausted, preserve exhausted state across credential refresh, skip exhausted candidates, cleanup on account removal, and all-exhausted candidate result.

Phase 9 Prerequisite: Retry-Triggered Exhaustion
- Expose a server-side operation for safely attributed rate-limit handling to mark an account exhausted.
- Tests: cover idempotent marking and no mutation when attribution is unsafe.

## Acceptance Criteria

- Given a stored account is marked exhausted, then inventory shows it as exhausted.
- Given rotation scans accounts, then exhausted accounts are skipped.
- Given the same account credentials refresh, then exhausted state remains attached to the same account row.
- Given an account is removed, then its exhausted state is removed too.
- Given all accounts are exhausted, then rotation reports no usable candidate.

## Implementation Notes

- Exhaustion is plugin policy state, not auth state.
- Store exhaustion on the `accounts` row.
- `exhausted_at` is already part of the storage schema; reason can be added later if needed.

## Open Questions

- Whether manual active selection should be allowed for exhausted accounts.
- Whether exhaustion should be per provider account globally or workspace-scoped.
