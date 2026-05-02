# Account Deduplication

Priority: P0

## User Story

As an OpenCode user, I want reconnecting or refreshing the same provider account to update the existing account entry instead of creating duplicates.

## Problem

Auth observations happen repeatedly at startup, after OAuth callbacks, and after token refreshes. Without fingerprint-based deduplication, the account list becomes noisy and unsafe for rotation.

## Scope

- Upsert accounts by stable fingerprint within a provider.
- Update stored credentials and metadata on repeated observations.
- Preserve account order when an existing account is updated.
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

- Given an account is already stored, when the same fingerprint is observed again, then the stored row updates instead of appending a duplicate.
- Given stored credentials change for the same fingerprint, when upsert runs, then credentials are replaced and the account order is unchanged.
- Given an active account is refreshed, when upsert runs, then active state remains on the same fingerprint.
- Given an exhausted account is refreshed, when upsert runs, then exhausted state remains unless explicitly reset.
- Given identity extraction is unsafe, then no account is deduplicated by token or label guesswork.

## Implementation Notes

- Enforce uniqueness on `(provider_id, fingerprint)`.
- Store `first_seen_at` and `updated_at` if useful for future UI, but keep initial UI narrow.
- Upsert should be idempotent because watcher events may be duplicated.

## Open Questions

- Whether account label changes should overwrite custom labels once custom labels exist.
- Whether refreshed credentials should update exhausted state expiry metadata if added later.
