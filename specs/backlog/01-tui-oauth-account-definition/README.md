# Mock OAuth Provider And TUI Account Definition

Priority: P0

## User Stories

Part 1: As a plugin developer, I want a local mock OAuth provider and matching OpenCode provider plugin for e2e tests so account-definition flows can be developed without touching real providers or real user OpenCode state.

Part 2: As an OpenCode user, I want to add provider accounts from `/provider-accounts` using the provider OAuth flow so I can build my managed account pool without manually editing storage.

## Problem

The DB layer can store accounts, but users have no flow to define accounts from the TUI. Because TUI and server plugins are separate runtimes, the feature uses the plugin-owned loopback bridge between TUI actions, server-side OAuth/auth capture, and server-owned storage.

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

- Register `/provider-accounts` as a TUI-local keymap palette command.
- Add a TUI `Add account` flow under `/provider-accounts`.
- Let the user select an OAuth-capable provider.
- Trigger server-side account definition through the plugin-owned bridge.
- Use OpenCode provider OAuth APIs to start and complete auth.
- Capture resulting provider auth on the server side.
- Surface structured OAuth failures when OpenCode returns provider auth error details.
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
- Provider identity extraction for at least the first supported provider.

## Implementation Phase Alignment

Phase 0: Dependency Baseline
- Update `@opencode-ai/plugin` to the current analyzed SDK baseline.
- Resolve compile/type drift before adding account-management behavior.
- Tests: run existing build/typecheck/test commands; add behavior tests only if the SDK update requires code changes.

Phase 1: Local Bridge/API Setup + Discovery
- Implement the plugin-owned local API skeleton required for TUI-to-server account management.
- Use `src/server/auth-pool-api.ts` with internal `AuthPoolServer`; keep routing, auth, CORS, and JSON helpers in that file.
- Add `/opencode-auth-pool/health`, service discovery metadata, server lifecycle wiring, and the TUI client discovery/health-check path.
- Add the initial `/provider-accounts` service-status UI so account definition can report bridge availability before OAuth actions exist.
- Tests: cover health, JSON 404, auth disabled/enabled, Basic auth, `auth_token`, invalid auth, CORS allow/reject cases, discovery metadata, and TUI unavailable states.

Phase 4: First Account Definition
- Add the initial TUI-driven OAuth account capture flow.
- Use the plugin-owned local API to call server-side OpenCode provider OAuth APIs.
- Persist the captured account only after safe identity extraction and host-auth reconciliation.
- Tests: cover OAuth start/continue handling, failed OAuth non-persistence, unsafe identity rejection, account upsert refresh, and TUI prompt/error states.

## Part 2 Acceptance Criteria

- Given the user invokes `/provider-accounts`, then local TUI UI opens and no model request is sent.
- Given the user opens `/provider-accounts`, when they choose `Add account`, then they can select a provider.
- Given provider OAuth succeeds, when account identity is extracted, then the account is stored in `db.sqlite`.
- Given the same provider account is added again, then the existing row is updated by `(provider, account_id)`.
- Given OAuth fails, then no account row is inserted.
- Given OAuth fails with a structured provider auth error, then the TUI shows a specific local error instead of a generic failure when safe.
- Given identity extraction is unsafe, then no guessed account row is inserted.
- Given account capture succeeds, then the TUI refreshes and shows the new account without restart.
- Given e2e/sandbox flow runs, then real user OpenCode config, data, state, cache, and provider credentials are not touched.

## Implementation Notes

- Treat Part 1 as test infrastructure and Part 2 as the vertical account-management slice involving server, TUI, and e2e updates.
- Keep the sandbox script, mock provider, and test OpenCode provider plugin under `e2e-sandbox/`, not normal package exports.
- Prefer the mock provider as the first e2e target before real provider-specific OAuth work.
- Keep DB writes server-side through `src/server/db.ts`.
- Keep account orchestration server-side through `src/server/service.ts`.
- Do not mutate `auth.json` directly.
- Do not expose raw tokens in TUI logs or toasts.
- Prefer the narrowest bridge endpoints needed for account definition and inventory refresh.
- Bridge endpoints live under `/opencode-auth-pool` and are plugin-owned, not OpenCode-native routes.
- Bridge auth mirrors OpenCode server auth through `OPENCODE_SERVER_PASSWORD` and `OPENCODE_SERVER_USERNAME`.
- Use `api.keymap.registerLayer` with palette namespace and `slashName`; do not use legacy `api.command.register`.
- Serialize connect flows per provider because OpenCode OAuth pending state is keyed by provider ID.
- Treat OAuth callback success as host-auth persistence only; storage capture still comes from auth reconciliation.
- Use TUI plugin modes for any modal/route-specific keybindings.
- Rely on runtime-scoped cleanup for keymap registrations; use explicit lifecycle cleanup only for resources not scoped by OpenCode.

## Open Questions

- Exact minimal provider plugin surface needed for the mock OAuth provider.
- Whether real OpenAI support should be implemented immediately after mock-provider e2e passes or as a separate follow-up.
