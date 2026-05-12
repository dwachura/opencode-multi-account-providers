# Define Accounts From TUI OAuth

Priority: P0

## User Story

As an OpenCode user, I want to add provider accounts from `/provider-accounts` using the provider OAuth flow so I can build my managed account pool without manually editing storage.

## Problem

The DB layer can store accounts, but users have no flow to define accounts from the TUI. Because TUI and server plugins are separate runtimes, the feature needs a deliberate bridge between TUI actions, server-side OAuth/auth capture, and server-owned storage.

## Scope

- Add a TUI `Add account` flow under `/provider-accounts`.
- Let the user select an OAuth-capable provider.
- Trigger server-side account definition through an explicit TUI/server bridge.
- Use OpenCode provider OAuth APIs to start and complete auth.
- Capture resulting provider auth on the server side.
- Extract stable `account_id` from auth.
- Upsert the account into the `accounts` table.
- Refresh TUI account list after successful capture.
- Add e2e/sandbox coverage for account definition without touching real user OpenCode state.

## Out Of Scope

- Manual token entry.
- Importing account JSON.
- Non-OAuth providers.
- Automatic account rotation.
- Rate-limit detection.
- Provider-side OAuth token revocation.
- Advanced account editing.

## Dependencies

- Completed server persistent storage decision: `specs/decisions/002-server-persistent-storage.md`.
- OpenCode provider OAuth APIs.
- TUI/server bridge design.
- Provider identity extraction for at least the first supported provider.

## Acceptance Criteria

- Given the user opens `/provider-accounts`, when they choose `Add account`, then they can select a provider.
- Given provider OAuth succeeds, when account identity is extracted, then the account is stored in `db.sqlite`.
- Given the same provider account is added again, then the existing row is updated by `(provider, account_id)`.
- Given OAuth fails, then no account row is inserted.
- Given identity extraction is unsafe, then no guessed account row is inserted.
- Given account capture succeeds, then the TUI refreshes and shows the new account without restart.
- Given e2e/sandbox flow runs, then real user OpenCode config, data, state, cache, and provider credentials are not touched.

## Implementation Notes

- Treat this as a vertical account-management slice involving server, TUI, and e2e updates.
- Keep DB writes server-side through `src/server/db.ts`.
- Do not mutate `auth.json` directly.
- Do not expose raw tokens in TUI logs or toasts.
- Prefer the narrowest bridge needed for account definition and inventory refresh.

## Open Questions

- Exact OpenCode-supported bridge shape between TUI plugin and server-side plugin behavior.
- Exact OAuth API call sequence available from plugin context.
- First provider to support for strict account identity extraction.
