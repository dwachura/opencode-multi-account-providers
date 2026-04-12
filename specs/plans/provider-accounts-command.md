# `/provider-accounts` TUI Dialog Plan

## Goal

Implement provider account management as a real TUI plugin command and rendered dialog, not as an LLM-backed slash command.

Primary entrypoint:

- `/provider-accounts`

Initial actions:

- inspect stored accounts
- show `active` / `exhausted`
- switch active account
- reset exhausted state
- disconnect stored account
- add account through a guided dialog flow later

## Decision

Use the TUI plugin API for this feature.

Do not use `command.execute.before` for the user-facing command path.

Reasons:

- server command execution currently falls through to `SessionPrompt.command()` and the normal LLM flow
- plugin `command.execute.before` can mutate prompt parts but cannot cleanly mark a command as locally handled
- a throw-based stop-signal hack can stop execution, but it is still an error path and is not needed for the native TUI flow
- the TUI plugin API already supports local slash-command registration and rendered dialogs

Scope choice for v1:

- TUI only
- no non-TUI `/session/:id/command` parity yet

## Relevant upstream facts

- server-plugin config hook can register commands into autocomplete/help, but execution still reaches the LLM path
- TUI plugins can register local commands with slash metadata via `api.command.register(...)`
- TUI plugins can open rendered dialogs with `api.ui.dialog.replace(...)`
- TUI plugins can register custom routes, but a dialog is the preferred first UI shape

## Current code seams

- `src/index.ts`
  - current server plugin entrypoint
  - owns watcher setup, auth capture, rotation, auth sync
- `src/storage.ts`
  - shared SQLite persistence for provider accounts
- `src/rotation.ts`
  - in-memory runtime rotation state
- `test/storage.test.ts`
  - storage-level behavior coverage
- `test/index.test.ts`
  - current server plugin unit tests
- `test/integration/integration.test.ts`
  - current opencode server + fake provider integration tests
- `package.json`
  - currently exports only `./server`

## Architecture

### Server plugin responsibilities

Keep in the existing server plugin:

- auth.json watcher
- identity extraction
- account capture
- automatic rotation on rate limit
- auth writes during model requests

### TUI plugin responsibilities

Add a new TUI entrypoint that handles:

- local slash command registration for `/provider-accounts`
- rendered dialog UI
- reading and mutating account storage
- syncing active account changes through client auth APIs
- local success/error toasts

### Shared state

Reuse the same SQLite DB via `src/storage.ts`.

The TUI plugin should configure storage using the TUI runtime state path so both server and TUI entrypoints point at the same DB.

## User-visible behavior

### `/provider-accounts`

Typing `/provider-accounts` in the TUI opens a rendered dialog immediately.

It must not create an assistant message or invoke the configured model.

### Initial dialog

Dialog title:

- `Provider Accounts`

Dialog content:

- configured provider name
- account count
- selectable top-level actions
- selectable account rows

Top-level actions:

- `Add account`
- `Reset exhausted accounts`

Account rows:

- label
- `id`
- optional `accountId`
- `active` marker
- `exhausted` marker

### Account action dialog

Selecting an account opens a nested dialog with actions:

- `Set active`
- `Disconnect account`
- `Back`

### Mutation feedback

On success:

- refresh the dialog contents
- show a toast

On failure:

- keep dialog open if possible
- show a warning/error toast

## Packaging work

Add a TUI entrypoint.

Expected package changes:

- keep `./server`
- add `./tui`

Likely file additions:

- `src/tui.tsx`
- optional small shared helper files if needed, but prefer keeping the first version compact

Expected TUI entry shape:

- `/** @jsxImportSource @opentui/solid */`
- `import type { TuiPluginModule } from "@opencode-ai/plugin/tui"`

Expected dependency additions:

- `@opentui/core`
- `@opentui/solid`
- `solid-js`

## Iteration plan

### Iteration 0: TUI entry spike

Objective:

Prove the plugin can expose a TUI entry and register a local slash command.

Work:

1. Add `./tui` export in `package.json`
2. Add `src/tui.tsx`
3. Register one local command with:
   - slash name: `provider-accounts`
   - title/description for command dialog
4. On select, open a placeholder rendered dialog

Exit criteria:

- `/provider-accounts` appears in local TUI command list
- selecting it opens a rendered dialog
- no assistant message / no LLM request is created

### Iteration 1: read-only dialog

Objective:

Show current stored account state in the dialog.

Work:

1. Point TUI plugin storage at the shared state path
2. Read current provider data via `src/storage.ts`
3. Render provider name, account count, and account rows
4. Render empty state if no accounts exist

Exit criteria:

- dialog reflects the current DB state
- ordering is deterministic
- `active` / `exhausted` are visible

### Iteration 2: interactive dialog structure

Objective:

Add nested dialog interaction without mutations yet, if needed.

Work:

1. Add top-level `Actions` entries
2. Make account rows selectable
3. Open nested account-action dialog on row select
4. Add refresh helper so later mutations can rerender cleanly

Exit criteria:

- user can navigate the dialog structure
- account-specific actions are discoverable

### Iteration 3: switch

Objective:

Allow manual active-account switching from the dialog.

Work:

1. Resolve selected account using `src/storage.ts`
2. Call `storage.activate(provider, index)`
3. Sync auth using the selected account credentials
4. Refresh dialog state
5. Show success toast

Rules:

- action applies for the next request
- do not try to mutate an in-flight request path

Exit criteria:

- active account changes in DB
- provider auth is updated
- UI reflects new active account immediately

### Iteration 4: reset

Objective:

Allow clearing exhausted state.

Work:

1. Add `Reset exhausted accounts` action
2. Call `storage.reset(provider)`
3. Refresh dialog state
4. Show success toast

Exit criteria:

- exhausted flags clear
- active account remains unchanged

### Iteration 5: disconnect

Objective:

Allow disconnecting stored accounts safely.

Work:

1. Use `storage.remove(provider, selector)`
2. If removed account was active and another account remains, sync auth to new active account
3. Refresh dialog state
4. Show success toast

Rules:

- preserve valid `active` and `exhausted` indices
- if no accounts remain, do not clear provider auth in v1 unless a clean path is confirmed

Exit criteria:

- inactive and active disconnect flows both work
- auth sync only happens when needed

### Iteration 6: guided add flow

Objective:

Add account capture from inside the dialog without implementing OAuth in this plugin.

Work:

1. Add `Add account` action
2. Open a dialog flow that explains the login process
3. Reuse existing auth/capture path from the server plugin
4. Detect newly captured account and refresh the list
5. Show pending/success/timeout states in the dialog

V1 behavior:

- first captured account becomes active
- later captured accounts are stored without auto-switching
- skip post-add confirm if it adds noticeable complexity

Exit criteria:

- add flow completes end-to-end through the existing watcher/capture path

## Cleanup

The earlier server-command experiment should be removed or disabled once the TUI path is implemented.

Cleanup items:

- remove server-side `/provider-accounts` command registration
- remove server-side `command.execute.before` handling for this command
- remove or replace the failing integration test that exercises `/session/:id/command` for this feature

Reason:

- avoid misleading slash-command behavior outside the TUI
- avoid token-burning paths that appear to work but do not truly stay local

## Testing plan

### Storage tests

Continue to rely on `test/storage.test.ts` for account-state correctness.

### TUI unit tests

Add tests around the TUI plugin using mocked TUI API methods:

- command registration
- placeholder dialog opening
- read-only rendering
- nested dialog navigation
- switch/reset/remove actions

### Integration / manual verification

Manual checks in real TUI:

1. `/provider-accounts` opens dialog immediately
2. no assistant message is created
3. no provider request is sent
4. switch/reset/remove update dialog state correctly
5. add flow refreshes after capture

## Deferred items

Not part of this plan:

- non-TUI command execution parity
- server-command stop-signal hack
- custom route/screen instead of dialog for v1
- `created_at` / `updated_at` metadata work
- provider usage polling / rate-limit endpoint integration
