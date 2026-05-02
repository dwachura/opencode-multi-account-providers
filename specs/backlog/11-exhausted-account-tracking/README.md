# Exhausted-Account Tracking

Priority: P1

## User Story

As an OpenCode user, I want the plugin to remember which accounts hit limits so automatic fallback does not keep selecting known exhausted accounts.

## Problem

An account can remain connected but temporarily unsuitable for automatic continuation. The plugin needs persistent per-account exhaustion state separate from live provider auth.

## Scope

- Mark an account exhausted by provider ID and fingerprint.
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

## Acceptance Criteria

- Given a stored account is marked exhausted, then inventory shows it as exhausted.
- Given rotation scans accounts, then exhausted accounts are skipped.
- Given the same account credentials refresh, then exhausted state remains attached to the same fingerprint.
- Given an account is removed, then its exhausted state is removed too.
- Given all accounts are exhausted, then rotation reports no usable candidate.

## Implementation Notes

- Exhaustion is plugin policy state, not auth state.
- Store by fingerprint to survive order changes.
- Consider storing `exhausted_at` and `reason` now for later UX, even if initially unused.

## Open Questions

- Whether manual active selection should be allowed for exhausted accounts.
- Whether exhaustion should be per provider account globally or workspace-scoped.
