# Timeline-Based Request Attribution

Status: implemented.

Notes:

- server-side auth switches now wait for reconciled storage state
- automated coverage includes real integration coverage for terminal all-accounts-exhausted behavior
- related findings/status notes: `specs/findings/timeline-request-attribution-test-findings.md`

## Goal

Replace session-level account guesswork with time-based correlation:

- one auth/account interval timeline per provider
- latest request context per session
- retry exhaustion resolved from the account active when that request started

The implementation should follow the current repo shape:

- server bookkeeping is global across providers, not tied to one configured provider
- TUI account management is provider-picker based
- durable account identity should come from extracted auth identity, not mutable storage index

This should handle both:

- providers that use rotated credentials immediately
- providers that may keep using cached credentials for one more retry

## Why

The old bookkeeping kept only one session-level account guess.

That breaks when:

- the plugin rotates auth during retry
- the next retry actually uses the newly written credentials
- the retry event is still attributed to the previously tracked account

The fake provider reproduces this clearly.

## Core Model

Use one in-memory auth interval timeline keyed by provider, plus latest request context per session.

Use wall-clock timestamps:

- `startAt`
- `endAt`
- request `startedAt`

## Implemented Model

Runtime state in `src/rotation.ts`:

```ts
type AuthInterval = {
  providerID: string
  accountID: string
  fingerprint: string
  startAt: number
  endAt: number | null
}

type RequestContext = {
  sessionID: string
  providerID: string
  startedAt: number
}
```

Key rules:

- watcher owns auth-derived storage reconciliation
- watcher opens/closes auth intervals
- `chat.params` records only latest request context
- retry attribution resolves request time against provider auth intervals
- historical attribution maps back to current storage by fingerprint
- if mapping fails, exhaustion is skipped

## Regression Coverage

### Covered cases

Add integration coverage for the fake provider:

1. exhaust all accounts
2. reset one exhausted account
3. rotate into that account
4. let that account fail too
5. verify that account becomes exhausted

Covered by unit/integration tests:

- strict OpenAI identity extraction from `chatgpt_account_user_id`
- watcher startup reconciliation from existing `auth.json`
- watcher rewrite capture and deduplication
- request-time attribution against historical auth intervals
- fake-provider test environments with `enableDefaultExtractor: true`
- safe skip when historical account no longer maps to current storage

## Notes

- timeline stays in memory only
- durable join key is storage fingerprint derived from extracted account identity
- storage `active` is `number | null`
- TUI/server auth switches call auth APIs and wait for reconciled storage state

## Success Criteria

- if a request started under `alpha`, `alpha` is exhausted even if auth later moved to `beta`
- if a later request started under `beta`, exhaustion applies to `beta`
- if the attributed historical account was removed before the retry event is handled, the plugin skips exhaustion and logs why
- no fake-only hardcoded logic is required for correct attribution
