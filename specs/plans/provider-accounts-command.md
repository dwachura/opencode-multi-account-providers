# `/provider-accounts` TUI Command Plan

## Goal

Implement a basic provider-scoped account-management command for the plugin:

- `/provider-accounts`
- `/provider-accounts list`
- `/provider-accounts switch <index|label>`
- `/provider-accounts remove <index|label>`
- `/provider-accounts reset`
- `/provider-accounts add`

The first version should be command-driven, minimal, and compatible with the current rotation model. It should not implement OAuth itself.

## Scope and constraints

- Entry point is `/provider-accounts`
- One plugin instance manages one configured provider
- No custom OAuth implementation in this plugin
- Manual actions should affect the next request, not try to mutate in-flight request behavior
- If post-add "ask to switch" adds noticeable complexity, skip it in v1
- Recommended v1 add policy:
  - first stored account becomes active
  - subsequent accounts are captured and stored without auto-switching

## Current code seams

- `src/index.ts`
  - owns plugin hooks, watcher setup, account capture, rotation, auth writes, toasts
- `src/storage.ts`
  - owns SQLite persistence and provider account state
- `src/rotation.ts`
  - owns in-memory per-session rotation state
- `script/e2e.ts`
  - currently contains reusable-looking account removal/reindex logic that should move into `src/storage.ts`
- `test/storage.test.ts`
  - existing storage-level coverage
- `test/index.test.ts`
  - existing plugin-unit coverage with mocked `client.auth.set()` and `client.tui.showToast()`
- `test/integration/integration.test.ts`
  - existing real opencode server + fake provider coverage

## Command handling assumption

The likely implementation path is a plugin command hook, probably `command.execute.before`, rather than a custom TUI screen API. Public docs do not show plugin-defined modals/drawers or direct slash-command registration.

If slash-command interception works as expected, `/provider-accounts` can be fully implemented inside the plugin. If not, use a small fallback shim, but do not block the rest of the design on richer TUI primitives.

## User-visible v1 behavior

### `/provider-accounts`

Shows the same output as `list`, plus one-line usage hints for subcommands.

### `/provider-accounts list`

Shows:

- configured provider
- stored accounts in deterministic index order
- account label, and fallback identity where useful
- `active` and `exhausted` flags

### `/provider-accounts switch <index|label>`

- resolves target account
- marks it active in storage
- rewrites provider auth with `client.auth.set()`
- reports that the new active account applies on the next request

### `/provider-accounts remove <index|label>`

- resolves target account
- removes it from storage
- reindexes `active` and `exhausted`
- if the removed account was active and another account remains, rewrites provider auth to the new active account
- if no accounts remain, leaves provider auth unchanged in v1 unless a clean auth-clear path is confirmed

### `/provider-accounts reset`

- clears exhausted flags for the provider
- keeps the active account unchanged

### `/provider-accounts add`

- starts a guided add/login flow without implementing OAuth here
- relies on the existing `auth.json` watcher/capture path
- on first account, account becomes active
- on later accounts, capture succeeds and current active account stays unchanged in v1
- on timeout/no capture, reports retry guidance

## Phase 0: command spike

### Objective

Prove the plugin can intercept and handle `/provider-accounts` reliably.

### Work

1. Add a small command hook to `src/index.ts`
2. Detect the `provider-accounts` command name and parse raw arguments
3. Return trivial output for one happy-path case
4. Add a unit test proving the hook is wired and receives command input

### Exit criteria

- `/provider-accounts` can be intercepted in plugin tests
- command hook shape is stable enough to continue implementation

## Phase 1: storage helpers

### Objective

Move account-management domain logic into `src/storage.ts` so runtime code and tests share one implementation.

### Work

1. Add account resolution helper
   - resolve by numeric index
   - resolve by `label`
   - optionally resolve by `id` and `accountId` to make later UI more robust
2. Add removal helper
   - remove by resolved index
   - reindex `exhausted`
   - compute new `active`
3. Add small read-model helper if useful for deterministic rendering
4. Move any overlapping logic out of `script/e2e.ts`

### Invariants

- if accounts remain, `active` is always in range
- `exhausted` contains valid post-removal indices only
- removing last account yields an empty provider state cleanly
- duplicate account refresh behavior remains unchanged

### Exit criteria

- storage tests cover removal and resolution edge cases
- command layer can operate purely via storage helpers

## Phase 2: list and help output

### Objective

Ship the read-only command path first.

### Work

1. Implement `/provider-accounts` as `list + usage hints`
2. Implement `/provider-accounts list`
3. Define deterministic rendering format for tests
4. Add empty-state output

### Output guidelines

- concise, plain-text, command-friendly
- stable ordering and stable labels
- include enough guidance to discover `switch`, `remove`, `reset`, and `add`

### Exit criteria

- users can inspect all stored account state without mutating anything
- unit tests assert exact or near-exact output shape

## Phase 3: switch and reset

### Objective

Add the safest mutating operations first.

### Work

1. Implement `switch`
   - resolve target
   - `storage.activate(provider, index)`
   - `client.auth.set()` with selected account credentials
   - toast + command output
2. Implement `reset`
   - `storage.reset(provider)`
   - do not rewrite auth unless a later bug requires it
3. Add error paths
   - no accounts
   - target not found
   - invalid usage

### Exit criteria

- active account can be changed manually
- exhausted flags can be cleared manually
- both operations preserve existing rotation behavior for later prompts

## Phase 4: remove

### Objective

Add account deletion with correct reindexing and auth synchronization.

### Work

1. Implement `remove`
2. If removed account was inactive
   - update storage only
3. If removed account was active and another account remains
   - update storage
   - rewrite provider auth to new active account
4. If removed account was the last account
   - update storage to empty
   - do not clear provider auth in v1 unless a clean supported path is verified

### Risk

This is the most state-sensitive subcommand because it touches `active`, `exhausted`, and possibly provider auth.

### Exit criteria

- removal works for active and inactive accounts
- no invalid indices remain after deletion
- auth rewrite only happens when required

## Phase 5: guided add/login flow

### Objective

Add a minimal but useful `add` command that reuses the existing watcher-driven capture path.

### Work

1. Add command handler for `add`
2. Start or guide the normal provider login flow
   - prefer triggering existing login/command behavior if available
   - otherwise print exact next-step guidance and keep flow in command output/toasts
3. Track a lightweight pending-add state
   - provider
   - optional session
   - start time / timeout window
4. Detect capture completion via existing watcher path
5. Emit success or timeout feedback

### V1 behavior

- no custom OAuth implementation
- no required confirm-after-add
- if account count was previously zero, first captured account becomes active
- if account count was already non-zero, keep current active account unchanged

### Exit criteria

- `add` can be completed end-to-end using the existing watcher/capture path
- duplicate-account add refreshes stored credentials without duplicating rows

## Phase 6: command UX hardening

### Objective

Make command behavior consistent and easy to recover from.

### Work

1. Normalize usage and error messaging
2. Handle ambiguous label matches deterministically
3. Standardize success output for all mutating commands
4. Keep toasts supplemental, not the sole source of state

### Exit criteria

- each subcommand has one clear success path and one clear usage/error path
- output is predictable enough for docs and tests

## Phase 7: tests

### Storage tests

Extend `test/storage.test.ts` for:

- resolve by index
- resolve by label/id/accountId
- remove inactive account
- remove active account
- remove last account
- exhausted-index reindexing

### Plugin unit tests

Extend `test/index.test.ts` for:

- command hook presence
- `/provider-accounts` default output
- `list` output with active/exhausted markers
- `switch` calls `client.auth.set()` with correct credentials
- `reset` clears exhausted state
- `remove` rewrites auth only when the removed account was active
- `add` success path
- `add` duplicate-account refresh path
- `add` timeout/no-capture path
- invalid usage / unknown target errors

### Integration tests

Extend `test/integration/integration.test.ts` for:

- command-driven `switch` updates auth used by next prompt
- command-driven `remove` reassigns active account correctly
- command-driven `reset` clears exhausted flags after a rate-limit scenario
- command-driven `add` captures new account through auth.json rewrite and does not auto-switch when another account is already active

## Phase 8: manual verification

Use the existing interactive harness:

- `bun run e2e:tui`
- `bun run e2e:account:add <label> [limit]`
- `bun run e2e:account:list`
- `bun run e2e:limit <label> <reqLimit> [tokLimit]`
- `bun run e2e:reset`

Manual checklist:

1. `/provider-accounts` shows current state and usage hints
2. `switch` changes active account and next request uses it
3. `remove` updates storage and active account correctly
4. `reset` clears exhausted flags
5. `add` captures a new account without breaking current active account semantics
6. automatic retry rotation still works after manual operations

## Phase 9: docs

After implementation, update `README.md` to reflect shipped behavior:

- document `/provider-accounts` and subcommands
- note that v1 is command-driven
- note that add/login reuses normal provider auth flow
- note first-account activation and later-account capture behavior
- note any confirmed limitations around slash-command interception or auth clearing

## Risks

1. Slash-command interception may be less direct than expected
2. Remove logic can break `active` / `exhausted` invariants if implemented outside storage helpers
3. Auth rewrites during manual operations can conflict with request timing if treated as immediate rather than next-request state
4. `add` can become over-designed if it tries to solve UI concerns before command semantics are stable

## Recommended implementation order

1. Phase 0
2. Phase 1
3. Phase 2
4. Phase 3
5. Phase 4
6. Phase 7 storage + unit tests for completed work
7. Phase 5
8. Phase 7 integration tests
9. Phase 8
10. Phase 9

## Deferred items

Not part of this plan:

- true modal/drawer TUI UI, unless a supported plugin API is confirmed
- post-add "ask to switch" confirmation if it materially complicates v1
- `created_at` / `updated_at` account metadata work
- provider-side usage/rate-limit polling integration
