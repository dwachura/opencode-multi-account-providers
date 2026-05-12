# Account Deduplication

Priority: P0

## User Story

As an OpenCode user, I want reconnecting or refreshing the same provider account to update the existing account entry instead of creating duplicates.

## Problem

Auth observations happen repeatedly at startup, after OAuth callbacks, and after token refreshes. Without provider/account-id deduplication, the account list becomes noisy and unsafe for rotation.

## Scope

- Upsert accounts by `(provider, account_id)`.
- Update stored access/refresh tokens and expiration timestamps on repeated observations.
- Preserve active/exhausted state when credentials refresh.
- Reject or skip auth observations that do not provide safe identity.

## Out Of Scope

- Merging accounts across providers.
- Heuristic duplicate detection by label or token similarity.
- User-facing duplicate resolution UI in the first slice.

## Dependencies

- Shared persistent storage.
- Provider identity extraction.
- Host auth sync.

## Acceptance Criteria

- Given an account is already stored, when the same `(provider, account_id)` is observed again, then the stored row updates instead of appending a duplicate.
- Given stored tokens change for the same `(provider, account_id)`, when upsert runs, then token columns are replaced.
- Given an active account is refreshed, when upsert runs, then active state remains unchanged.
- Given an exhausted account is refreshed, when upsert runs, then exhausted state remains unless explicitly reset.
- Given identity extraction is unsafe, then no account is deduplicated by token or label guesswork.

## Implementation Notes

- Enforce uniqueness on `(provider, account_id)`.
- Store `created_at` and `updated_at`.
- Upsert should be idempotent because watcher events may be duplicated.

## Open Questions

- Whether account label changes should overwrite custom labels once custom labels exist.
- Whether refreshed credentials should update exhausted state expiry metadata if added later.
