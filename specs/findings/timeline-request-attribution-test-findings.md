# Timeline Request Attribution Test Findings

## Current State

The timeline-request-attribution work is implemented and covered.

Added coverage/work completed:

- hook-level regression coverage for exhaust -> reset -> rotate back in -> exhaust again
- defensive branch coverage for:
  - missing auth interval at request time
  - historical account no longer mapping to storage
- server-side wait for reconciled active account after rotation `auth.set(...)`
- real integration coverage for terminal all-accounts-exhausted behavior
- fail-fast behavior when rotation is flagged but no next account exists

## Remaining Observation

### Integration watcher timing can still be slightly flaky

During repeated focused runs, one watcher integration test occasionally timed out and then passed on rerun without code changes.

Implication:

- attribution/rotation logic itself is covered and passing
- if the integration suite becomes flaky again, the first thing to inspect is watcher/debounce timing around `auth.json` rewrite detection

## Verification Snapshot

- `bun test test/index.test.ts test/integration/integration.test.ts`
- `bunx tsc --noEmit`

Both pass in the final implementation state.
