# Development

## Setup

```bash
bun install
```

## Common Commands

```bash
# Type check
bunx tsc

# Focused unit tests
bun test test/storage.test.ts test/rotation.test.ts test/index.test.ts test/tui.test.ts

# Fake server tests
bun test test/integration/fake-server.test.ts

# Real integration tests
bun test test/integration/integration.test.ts

# Full suite
bun test
```

## Interactive Harness

```bash
bun run e2e:tui
```

This starts:

- the fake provider server
- an isolated OpenCode config under `.test-env/interactive/`
- a matching `opencode.json` and `tui.json`
- the OpenCode TUI against that isolated environment

From another terminal you can drive the fake environment:

```bash
# Add fake accounts
bun run e2e:account:add alpha 2
bun run e2e:account:add beta 2

# Inspect stored accounts
bun run e2e:account:list

# Remove a fake account
bun run e2e:account:remove alpha

# Force faster rate limiting
bun run e2e:limit alpha 1

# Reset fake-server usage and exhausted flags
bun run e2e:reset
```

Suggested manual flow:

1. Run `bun run e2e:tui`
2. Add at least two fake accounts from another shell
3. Open `/provider-accounts` in the TUI
4. Test switch/reset/disconnect flows
5. Send prompts to verify automatic rotation still works

### Current blocker

`bun run e2e:tui` is currently not reliable enough for end-to-end verification.

Findings so far:

- the TUI runtime only started loading external TUI plugins after writing `tui.json` into the XDG config path, not just the local config dir
- the fake auth plugin also needed a no-op `tui` entrypoint; without it, TUI plugin loading logged an error before the real plugin loaded
- helper commands now drive auth changes through the OpenCode auth API, wait for auth/storage reconciliation, pin to the project directory, and no longer delete fake users on local account removal
- helper commands also now wait for the local OpenCode server/provider auth APIs to be ready instead of assuming an immediately usable startup state
- remaining blocker: in the interactive CLI runtime, fake-provider prompts still do not consistently honor the fake auth plugin's OAuth request auth, so prompt traffic can still fall back to missing/dummy API-key auth instead of the OAuth access token

Current implication:

- use unit tests plus `test/integration/integration.test.ts` as the source of truth for now
- treat `e2e:tui` as an unfinished debugging harness, not a passing verification path

## Fake Server Admin API

The fake server used by tests and the interactive harness exposes:

- `GET /admin/users`
- `POST /admin/users`
- `GET /admin/users/:id`
- `DELETE /admin/users/:id`
- `PUT /admin/users/:id/limits`
- `PUT /admin/users/:id/tokens`
- `POST /admin/users/:id/reset`
- `POST /admin/reset`

## Notes

- `.test-env/` is intentionally isolated from your normal OpenCode state
- the interactive harness writes both `opencode.json` and `tui.json`
- if you keep a long-running interactive harness open while testing other flows, be mindful that it also runs its own OpenCode process against test data
- when debugging `e2e:tui`, inspect both:
  - `.test-env/interactive/<run>/data/opencode/log/`
  - `.test-env/interactive/<run>/fake-server.log`
