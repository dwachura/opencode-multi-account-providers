# Mock OAuth Provider And TUI Account Definition

Priority: P0

## User Stories

Part 1: As a plugin developer, I want a local mock OAuth provider and matching OpenCode provider plugin for e2e tests so account-definition flows can be developed without touching real providers or real user OpenCode state.

Part 2: As an OpenCode user, I want to add provider accounts from `/provider-accounts` using the provider OAuth flow so I can build my managed account pool without manually editing storage.

## Problem

The DB layer can store accounts, but users have no flow to define accounts from the TUI. Because TUI and server plugins are separate runtimes, the feature needs a deliberate bridge between TUI actions, server-side OAuth/auth capture, and server-owned storage.

Real provider OAuth is a poor first e2e target because it requires external accounts, browser interaction, and real credentials. The first slice should create a deterministic mock OAuth provider and a test-only OpenCode provider plugin, then use that harness to drive the actual account-definition feature.

## Part 1 Scope: Mock OAuth Provider Harness

- Add a very small local mock OAuth provider server for tests.
- Add a test-only OpenCode provider plugin that exposes the mock provider as an OAuth-capable provider.
- Support the minimal provider OAuth API behavior needed by OpenCode auth flows.
- Return deterministic OAuth credentials with a stable mock `accountId`.
- Allow tests to define multiple mock accounts without external credentials.
- Integrate the mock provider and provider plugin into the sandbox/e2e harness.
- Ensure the mock provider is not shipped or enabled for normal plugin users.

## Part 1 Out Of Scope

- Production provider support.
- Real OpenAI OAuth.
- Rich provider model behavior beyond what e2e needs.
- Security hardening beyond localhost test isolation.

## Part 1 Acceptance Criteria

- Given the e2e harness starts, then it can start a local mock OAuth provider server.
- Given OpenCode loads test plugins, then the mock provider appears as an OAuth-capable provider.
- Given mock OAuth completes, then OpenCode persists OAuth-shaped auth with stable `accountId`.
- Given two different mock accounts are selected, then they produce different stable account IDs.
- Given tests run, then real user OpenCode config, data, state, cache, and provider credentials are not touched.
- Given package build/release output is produced, then the test-only mock provider plugin is not part of normal runtime exports.

## Part 2 Scope: TUI Account Definition

- Add a TUI `Add account` flow under `/provider-accounts`.
- Let the user select an OAuth-capable provider.
- Trigger server-side account definition through an explicit TUI/server bridge.
- Use OpenCode provider OAuth APIs to start and complete auth.
- Capture resulting provider auth on the server side.
- Extract stable `account_id` from auth.
- Upsert the account into the `accounts` table.
- Refresh TUI account list after successful capture.
- Add e2e/sandbox coverage through the mock OAuth provider harness.

## Part 2 Out Of Scope

- Manual token entry.
- Importing account JSON.
- Non-OAuth providers.
- Automatic account rotation.
- Rate-limit detection.
- Provider-side OAuth token revocation.
- Advanced account editing.

## Dependencies

- Completed server persistent storage decision: `specs/decisions/002-server-persistent-storage.md`.
- Completed mock OAuth provider harness from Part 1.
- OpenCode provider OAuth APIs.
- TUI/server bridge design.
- Provider identity extraction for at least the first supported provider.

## Part 2 Acceptance Criteria

- Given the user opens `/provider-accounts`, when they choose `Add account`, then they can select a provider.
- Given provider OAuth succeeds, when account identity is extracted, then the account is stored in `db.sqlite`.
- Given the same provider account is added again, then the existing row is updated by `(provider, account_id)`.
- Given OAuth fails, then no account row is inserted.
- Given identity extraction is unsafe, then no guessed account row is inserted.
- Given account capture succeeds, then the TUI refreshes and shows the new account without restart.
- Given e2e/sandbox flow runs, then real user OpenCode config, data, state, cache, and provider credentials are not touched.

## Implementation Notes

- Treat Part 1 as test infrastructure and Part 2 as the vertical account-management slice involving server, TUI, and e2e updates.
- Keep the sandbox script, mock provider, and test OpenCode provider plugin under `e2e-sandbox/`, not normal package exports.
- Prefer the mock provider as the first e2e target before real provider-specific OAuth work.
- Keep DB writes server-side through `src/server/db.ts`.
- Do not mutate `auth.json` directly.
- Do not expose raw tokens in TUI logs or toasts.
- Prefer the narrowest bridge needed for account definition and inventory refresh.

## Open Questions

- Exact OpenCode-supported bridge shape between TUI plugin and server-side plugin behavior.
- Exact OAuth API call sequence available from plugin context.
- Exact minimal provider plugin surface needed for the mock OAuth provider.
- Whether real OpenAI support should be implemented immediately after mock-provider e2e passes or as a separate follow-up.
