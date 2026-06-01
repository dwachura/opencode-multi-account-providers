# Multi-Account Inventory

Priority: P0

## User Story

As an OpenCode user, I want to see and manage all stored accounts for one provider so I can understand which accounts are available, active, or exhausted.

## Problem

OpenCode exposes the current provider auth, not an inventory of multiple stored accounts. The plugin needs a coherent provider account model before user management or runtime rotation can work.

## Scope

- Model stored accounts as rows keyed by provider and account id.
- Expose selectable `active` state per account.
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

## Implementation Phase Alignment

Phase 3: Account Listing
- Implement the server-side inventory read model and local API response shape.
- Read plugin storage only from the server runtime; TUI consumes inventory through `/opencode-auth-pool`.
- Include provider id, account id, label, active state, exhausted state, and sync status needed for compact display.
- Tests: cover DB-row mapping, empty inventory, grouped multi-account inventory, persistence across restart boundaries where practical, and JSON error handling for read failures.

## Acceptance Criteria

- Given no accounts are stored, when inventory is requested, then the provider shows an empty manageable state.
- Given one account is captured from host auth, when inventory is requested, then that account appears and is marked active.
- Given several accounts are stored, when inventory is requested, then account rows are stable across process restarts.
- Given an account is exhausted, when inventory is requested, then exhausted state is visible without removing the account.
- Given live auth is missing, when inventory is requested, then stored accounts remain visible and selectable state is unchanged.

## Implementation Notes

- Inventory should be server-backed; TUI access needs an explicit bridge because TUI and server plugins are separate runtimes.
- Keep public read model small: provider, account id, active, exhausted, timestamps.
- Server storage uses `bun:sqlite`; avoid `better-sqlite3` because OpenCode loads plugins under Bun.

## Open Questions

- Whether inventory should include provider display names from OpenCode provider registry.
- Whether users can reorder accounts in the first version.
