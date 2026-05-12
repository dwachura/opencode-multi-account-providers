# Disconnect And Remove Accounts

Priority: P1

## User Story

As an OpenCode user, I want to remove stored provider accounts safely so unused accounts disappear without leaving live auth broken or inconsistent.

## Problem

Removing an inactive account is local storage work, but removing the active or last account needs host auth side effects. There is no cross-system transaction, so the flow must handle partial failure.

## Scope

- Remove inactive stored accounts without changing live auth.
- Remove active account and choose deterministic fallback when another account remains.
- Remove last account and call `auth.remove(...)` for that provider.
- Delete row-local exhausted state with the account.
- Roll back local removal snapshot when required auth side effects fail.

## Out Of Scope

- Revoking OAuth tokens at provider side.
- Deleting OpenCode auth by direct file edit.
- Complex fallback policies beyond deterministic next available account.

## Dependencies

- Multi-account inventory.
- Manual active account switcher.
- Host auth sync.
- OpenCode `auth.remove(...)` access.

## Acceptance Criteria

- Given an inactive account is removed, then the stored account list changes and live active auth remains unchanged.
- Given the active account is removed and another account remains, then the plugin switches live auth to the fallback account and confirms sync.
- Given the last account is removed, then the plugin removes provider auth through `auth.remove(...)` and clears active state after sync.
- Given fallback switch fails, then local state is restored or the user sees a clear unconfirmed state.
- Given an exhausted account is removed, then exhausted state no longer references it.

## Implementation Notes

- Snapshot provider state before removal.
- Fallback selection should be deterministic from remaining account rows after deletion.
- Use row id or `(provider, account_id)` references to avoid index-shift corruption.

## Open Questions

- Whether removing an exhausted inactive account should need confirmation.
- Whether removing last account should delete historical provider row or leave empty provider state.
