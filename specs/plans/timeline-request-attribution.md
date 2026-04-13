# Timeline-Based Request Attribution

## Goal

Replace session-level `lastAccount` guesswork with timeline correlation:

- auth/account activation history per provider
- request history per session
- retry exhaustion resolved from the account active when that request started

The implementation should follow the current repo shape:

- server bookkeeping is global across providers, not tied to one configured provider
- TUI account management is provider-picker based
- durable account identity should come from extracted auth identity, not mutable storage index

This should handle both:

- providers that use rotated credentials immediately
- providers that may keep using cached credentials for one more retry

## Why

Current bookkeeping keeps only one session-level `usedAccount(sessionID)` value.

That breaks when:

- the plugin rotates auth during retry
- the next retry actually uses the newly written credentials
- the retry event is still attributed to the previously tracked account

The fake provider reproduces this clearly.

## Core Model

Use two in-memory timelines:

1. auth activation history
2. request history

Use both:

- `seq`: monotonic in-memory counter for ordering
- `at`: `Date.now()` for logs/debugging

`seq` should be the primary correlation key.

## Phase 1: History Scaffolding

### 1.1 Data structures

Add new records in `src/rotation.ts` or a new `src/timeline.ts`:

- `AuthActivation`
- `RequestRecord`

Suggested fields:

```ts
type AuthActivation = {
  providerID: string
  index: number
  accountID: string
  fingerprint: string
  seq: number
  at: number
  source: "rotation" | "switch" | "connect" | "disconnect" | "capture"
}

type RequestRecord = {
  sessionID: string
  providerID: string
  seq: number
  at: number
  kind?: "normal" | "retry"
}
```

Notes:

- `accountID` should come from the provider identity extractor result
- for providers with JWT-backed identity, this should prefer a stable user id such as `sub`
- `fingerprint` remains the durable lookup key for storage correlation
- `index` is a snapshot/debug field only; do not rely on it as the primary join key

### 1.2 Sequence allocator

Add:

- `nextSeq(): number`

### 1.3 Bounded history

Keep only recent entries:

- recent N activations per provider
- recent N requests per session

Add explicit reset helpers for tests.

### Exit

- no behavior change yet
- structures compile cleanly
- unit tests cover basic history storage and cleanup

## Phase 2: Record Auth Activation History

### 2.1 Recording API

Add:

- `recordActivation(providerID, index, fingerprint, source)`

### 2.2 Call sites

Record activation everywhere effective auth/account selection changes:

- server rotation path in `src/index.ts`
- server capture path when a newly captured account becomes active
- TUI `Set active`
- TUI `Connect account`
- TUI `Connect and activate`
- TUI disconnect flows that switch auth

Implementation note for current code:

- TUI hooks should be added inside the per-provider dialog flow reached from the provider picker, not in a single-provider command path

### 2.3 Scope guard

Do not record on every storage write.
Only record semantic auth/account activation changes.

### Exit

- all auth/account-switching paths append activation history
- tests cover recording behavior

## Phase 3: Record Request History

### 3.1 Replace coarse session tracking

In `chat.params`, record a request start entry instead of only storing one last-used account index.

### 3.2 Recorded fields

At minimum:

- `sessionID`
- `providerID`
- `seq`
- `at`

### 3.3 Existing provider mapping

Current code no longer has a single managed provider at request time.

- fold provider lookup into request history usage
- remove session-level provider tracking once the resolver no longer needs it

### Exit

- each request start is recorded
- old `usedAccount(sessionID)` can remain temporarily for transition

## Phase 4: Attribution Resolver

### 4.1 Resolver

Implement resolver:

- input: `sessionID`
- find latest relevant request record for the session
- find latest auth activation for that provider where `activation.seq <= request.seq`
- resolve current account from activation fingerprint / account identity
- return the attributed account index only after durable identity maps back to current storage

### 4.2 Fallback behavior

If no matching activation exists:

- fall back conservatively
- log fallback reason

If a historical activation resolves to an account that no longer exists in storage:

- skip exhaustion
- log that attribution could not be mapped safely
- do not fall back to current active index or last-known index

### 4.3 Unit tests

Cover:

- single activation before request
- multiple activations before and after requests
- bounded history behavior

### Exit

- attribution logic is deterministic and well tested

## Phase 5: Swap Retry Exhaustion to Resolver

### 5.1 Event path change

In retry event handling, stop using `usedAccount(sessionID)`.
Use the new resolver instead.

### 5.2 Logging

Log:

- request seq/at
- matched activation seq/at
- resolved provider/fingerprint/accountID/index/label
- fallback reason if used

### 5.3 Cleanup

Remove or deprecate:

- `trackAccount`
- `usedAccount`
- `track(sessionID, providerID)` if request history fully replaces provider lookup

### Exit

- retry exhaustion uses timeline correlation only

## Phase 6: Regression Coverage

### 6.1 Immediate-switch provider regression

Add integration coverage for the fake provider:

1. exhaust all accounts
2. reset one exhausted account
3. rotate into that account
4. let that account fail too
5. verify that account becomes exhausted

### 6.2 Cached-behavior simulation

If practical, simulate a provider path where a retry still belongs to the old account after auth rotation.

If not practical, cover this with unit tests against synthetic timelines.

Add one more synthetic case:

- request resolves to a historical fingerprint that was later removed from storage
- retry attribution should skip exhaustion rather than exhaust the wrong current account

### 6.3 Existing suite

Keep all current rotation and integration coverage green.

### Exit

- fake-provider regression is covered
- no regressions in existing behavior

## Phase 7: Observability and Cleanup

### 7.1 Better logs

Log:

- auth activation entries
- request start entries
- retry attribution decisions

### 7.2 Optional debug helper

Add helper to inspect recent:

- requests for a session
- activations for a provider

### 7.3 Docs

Update architecture docs to explain:

- `active` account
- request-attributed account
- why they can diverge temporarily

### Exit

- future attribution bugs can be diagnosed from logs alone

## Suggested Execution Order

1. Phase 1
2. Phase 2
3. Phase 3
4. Phase 4
5. Phase 5
6. Phase 6
7. Phase 7

## Recommended Implementation Notes

- prefer `seq` over raw timestamp for matching
- keep timestamps too for logs/debugging
- trim history aggressively; this is runtime bookkeeping, not audit storage
- keep the timeline in memory first
- do not persist it to SQLite unless a later need appears
- use auth-derived account identity as the durable timeline identity
- treat storage index as mutable and unsuitable for long-lived attribution
- record activations only after the effective auth switch succeeds
- current server path is provider-agnostic, so request history should be the source of provider attribution too

## Success Criteria

- after rotation to `beta`, if the retry actually used `beta`, the next rate-limit exhausts `beta`
- if a provider still used `alpha`, `alpha` is exhausted instead
- if the attributed historical account was removed before the retry event is handled, the plugin skips exhaustion and logs why
- no fake-only hardcoded logic is required for correct attribution
