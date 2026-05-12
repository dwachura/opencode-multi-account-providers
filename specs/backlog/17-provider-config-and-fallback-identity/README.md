# Provider Config And Fallback Identity

Priority: P3

## User Story

As an OpenCode user or plugin maintainer, I want configurable provider support and explicitly enabled fallback identity behavior so the plugin can support more environments without pretending weak identity is production-safe.

## Problem

Strong provider support requires stable identity extraction. Some controlled environments may accept weaker token-based fallback, but enabling it by default would risk duplicates and wrong attribution.

## Scope

- Add plugin config for enabled providers.
- Add config-gated generic fallback identity extraction.
- Clearly mark fallback-derived accounts as lower confidence.
- Allow provider adapters to declare support quality.
- Document limitations and recommended production providers.

## Out Of Scope

- Making fallback identity equivalent to provider-specific extraction.
- Provider-specific quota prediction.
- Supporting non-OAuth providers.

## Dependencies

- Provider registry.
- Provider identity extraction.
- Backlog docs for supported provider behavior.

## Acceptance Criteria

- Given fallback identity is disabled, then unsupported providers are skipped safely.
- Given fallback identity is enabled for a controlled provider, then account capture can use the configured weak identity method.
- Given fallback identity is used, then inventory or logs indicate lower confidence.
- Given provider-specific extraction exists, then it takes precedence over fallback.
- Given config is invalid, then plugin starts with safe defaults or fails clearly without unsafe capture.

## Implementation Notes

- Make fallback opt-in per provider rather than global broad default.
- Use token-derived identity only as a last-resort controlled mode.
- Preserve safe skip behavior for runtime attribution when fallback confidence is insufficient.

## Open Questions

- Config file location and schema.
- Which fallback methods are acceptable: token hash, account metadata field, or user-provided identity.
- Whether fallback accounts can participate in automatic rotation by default.
