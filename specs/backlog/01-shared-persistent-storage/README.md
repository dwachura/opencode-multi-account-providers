# Shared Persistent Storage

Priority: P0

## User Story

As an OpenCode user with multiple accounts for one provider, I want the plugin to persist account state locally so server-side runtime behavior and TUI management operate on the same data.

## Problem

OpenCode stores only the currently active provider auth. The plugin needs a durable account portfolio for each provider, plus active and exhausted policy state, shared across separate plugin entrypoints.

## Scope

- Create a local SQLite-backed store for plugin-managed provider accounts.
- Store one provider record with an ordered account list, active account reference, and exhausted account references.
- Store OAuth credentials and provider metadata needed to restore an account through OpenCode auth APIs.
- Expose a shared storage module usable by server and TUI plugin entrypoints.
- Support atomic-ish read/modify/write operations for common account mutations.
- Include schema versioning and migration entrypoint from the start.

## Out Of Scope

- Encrypting local credentials beyond what OpenCode already provides.
- Usage analytics, billing history, or quota prediction.
- Non-OAuth credentials.

## Dependencies

- None for the first storage slice.
- Later stories depend on stable fingerprints produced by provider identity extraction.

## Acceptance Criteria

- Given no previous store exists, when the plugin starts, then it creates the database and current schema.
- Given a provider has accounts, when server and TUI entrypoints read storage, then both observe the same provider account list.
- Given an account mutation fails midway, when possible, then storage is not left in a partially rewritten JSON blob or invalid schema state.
- Given schema version changes, when the plugin starts, then migrations run before normal access.
- Given account order changes, active and exhausted references remain valid by fingerprint or are safely reconciled.

## Implementation Notes

- Prefer SQLite tables over large opaque JSON blobs for account rows, provider state, and migrations.
- Persist active/exhausted state by account fingerprint, not only by list index.
- Keep credentials stored exactly in the shape required by `auth.set(...)` handoff.
- Storage is plugin policy state; live auth still belongs to OpenCode.

## Open Questions

- Exact OpenCode plugin data directory path to use.
- Whether storage should be workspace-scoped, global, or configurable.
- Whether credential material should be delegated to existing OpenCode auth storage instead of duplicated.
