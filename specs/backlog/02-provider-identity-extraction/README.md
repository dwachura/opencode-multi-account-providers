# Provider Identity Extraction

Priority: P0

## User Story

As an OpenCode user, I want each provider account to be identified by a stable identity so reconnects, token refreshes, and account switching do not create duplicates or corrupt state.

## Problem

Provider auth payloads differ and raw token values can change. The plugin needs stable provider-aware identity extraction before it can safely store, dedupe, switch, or blame accounts.

## Scope

- Define a provider adapter registry keyed by OpenCode provider ID.
- Define a normalized identity result with stable `id`, display `label`, and optional metadata.
- Implement strict OpenAI identity extraction using `chatgpt_account_user_id`.
- Convert provider identity into a stable `account_id` for storage.
- Return explicit unsupported/weak identity results when extraction is unsafe.

## Out Of Scope

- Supporting every OpenCode provider in the first release.
- Using raw token value as default production identity.
- Fetching remote provider profile data unless a provider adapter explicitly needs it later.

## Dependencies

- Provider registry shape.
- Auth payload shape from OpenCode provider auth.

## Acceptance Criteria

- Given an OpenAI OAuth auth payload with `chatgpt_account_user_id`, when identity extraction runs, then it returns a stable account id.
- Given the same account has refreshed credentials, when extraction runs again, then it returns the same account id.
- Given unsupported provider auth, when extraction runs, then it returns a safe unsupported result instead of guessing.
- Given a provider adapter supplies a label, when the account is listed, then the label is usable for display but not used as behavior identity.
- Given extraction fails, downstream capture and attribution skip unsafe mutation.

## Implementation Notes

- Keep provider-specific code narrow and explicit.
- Storage deduplication uses `(provider, account_id)`, so account id only needs to be stable within the provider.
- Treat label as UI-only metadata.
- Avoid generic fallback until the config/fallback story enables it explicitly.

## Open Questions

- Exact OpenAI auth payload field path in current OpenCode runtime.
- Whether enterprise/account URL metadata is available and should influence display only.
- Which second provider should be added after OpenAI.
