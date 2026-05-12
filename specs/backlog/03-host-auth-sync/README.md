# Host Auth Sync

Priority: P0

## User Story

As an OpenCode user, I want plugin account state to follow OpenCode's live auth state so the plugin remains correct when auth changes inside or outside the plugin UI.

## Problem

OpenCode auth APIs mutate live auth asynchronously from plugin-visible storage. The plugin must observe `auth.json`, reconcile account state, and confirm mutations only after sync catches up.

## Scope

- Locate and read the workspace-relevant OpenCode `auth.json`.
- Parse valid OAuth-shaped provider auth entries.
- Watch auth file changes with debounce and startup retry behavior.
- Reconcile observed auth into plugin storage through a single centralized path.
- Update active account state when observed live auth changes.
- Handle provider auth disappearance by clearing active live state.

## Out Of Scope

- Writing directly to `auth.json`.
- Syncing non-OAuth auth entries.
- Predicting auth changes before OpenCode persists them.

## Dependencies

- Server persistent storage.
- Provider identity extraction.
- Account deduplication path.

## Acceptance Criteria

- Given OpenCode auth changes outside the plugin, when the watcher observes `auth.json`, then plugin storage reconciles to the new active account.
- Given `auth.set(...)` returns, when synced storage does not yet show the expected account id, then the flow waits rather than reporting success immediately.
- Given provider auth disappears, when reconciliation runs, then active state is cleared without deleting stored historical accounts by default.
- Given `auth.json` is temporarily unreadable or partially written, then the watcher retries without corrupting storage.
- Given an unsupported auth entry appears, then the plugin skips capture and records no unsafe account.

## Implementation Notes

- Cache file reads by mtime to avoid unnecessary parsing.
- Centralize reconciliation so startup scan and watcher events follow identical rules.
- Expose `waitForActiveAccount(provider, accountID, timeout)` for switching and rotation flows.
- Maintain runtime auth timeline from reconciliation events for attribution stories.

## Open Questions

- Exact file-watch primitive available in OpenCode plugin runtime.
- Timeout defaults for waiting on sync confirmation.
- How to surface sync failures in server-only contexts.
