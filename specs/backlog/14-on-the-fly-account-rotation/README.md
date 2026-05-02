# On-The-Fly Account Rotation

Priority: P2

## User Story

As an OpenCode user, I want the plugin to switch to another stored account after the active account reaches limits so work can continue with minimal manual intervention.

## Problem

OpenCode retry handling and request setup happen in separate phases. The plugin must mark exhaustion during retry/error handling and apply auth switching during a safe next request setup phase.

## Scope

- When a rate limit is safely attributed, mark the responsible account exhausted.
- Select next usable account by circular scan from the responsible/active account order.
- Stage a rotation request for the provider.
- Apply `auth.set(...)` during request setup or another safe mutation boundary.
- Wait for sync confirmation before treating rotation as complete.
- Avoid rotating when no safe attribution exists.

## Out Of Scope

- Load balancing across accounts.
- Provider-specific quota optimization.
- Guarantees that an already-scheduled retry uses new credentials immediately.

## Dependencies

- Exhausted-account tracking.
- Rate-limit detection.
- Safe retry attribution.
- Manual active account switching service.
- Host auth sync confirmation.

## Acceptance Criteria

- Given account A hits a safely attributed rate limit and account B is usable, then A is marked exhausted and rotation to B is staged.
- Given staged rotation applies, then `auth.set(...)` switches to B and sync confirms B active.
- Given account B is exhausted, then selection skips B and continues circular scan.
- Given no usable account exists, then rotation does not loop and all-exhausted handling is invoked.
- Given attribution is unsafe, then no account is marked exhausted and no automatic rotation occurs.

## Implementation Notes

- Keep rotation two-phase: event marks/flags, request setup applies.
- Candidate selection should be deterministic and storage-backed.
- Clear stale staged rotation after success, terminal failure, or manual override if required.

## Open Questions

- Exact hook boundary where auth mutation is safest before next provider request.
- Whether staged rotation should trigger immediately or wait for next model request.
- How to communicate one wasted retry if provider auth is cached.
