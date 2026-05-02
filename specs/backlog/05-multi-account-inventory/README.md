# Multi-Account Inventory

Priority: P0

## User Story

As an OpenCode user, I want to see and manage all stored accounts for one provider so I can understand which accounts are available, active, or exhausted.

## Problem

OpenCode exposes the current provider auth, not an inventory of multiple stored accounts. The plugin needs a coherent provider account model before user management or runtime rotation can work.

## Scope

- Model one provider as an ordered account list.
- Expose active account state per provider.
- Expose exhausted state per account.
- Provide read APIs for UI and server runtime.
- Include provider/account metadata needed for compact display.
- Support empty, single-account, and multi-account states.

## Out Of Scope

- Rich profile pages.
- Usage analytics.
- Quota windows or provider-side subscription state.

## Dependencies

- Shared persistent storage.
- Host auth sync.
- Account deduplication.
- Provider identity extraction.

## Acceptance Criteria

- Given no accounts are stored, when inventory is requested, then the provider shows an empty manageable state.
- Given one account is captured from host auth, when inventory is requested, then that account appears and is marked active.
- Given several accounts are stored, when inventory is requested, then order is stable across process restarts.
- Given an account is exhausted, when inventory is requested, then exhausted state is visible without removing the account.
- Given active auth is missing, when inventory is requested, then stored accounts remain visible but no account is marked active.

## Implementation Notes

- Inventory should be a shared domain module, not TUI-specific data shaping.
- Keep public read model small: provider id, account fingerprint, label, metadata, active, exhausted.
- Store positions for display/rotation order, but use fingerprints for identity-sensitive operations.

## Open Questions

- Whether inventory should include provider display names from OpenCode provider registry.
- Whether users can reorder accounts in the first version.
