# Connect Extra Accounts

Priority: P1

## User Story

As an OpenCode user, I want to connect another account for the same provider so I can build fallback capacity without losing accounts I already stored.

## Problem

OpenCode provider OAuth normally leaves the newly authenticated account as live auth. The plugin must capture that new account, dedupe it, and optionally restore the previous active account.

## Scope

- Start provider OAuth from the TUI manager by calling the plugin bridge, which uses OpenCode provider OAuth APIs server-side.
- Capture the resulting live auth through normal host auth sync.
- Support preserve-current mode after connecting a new account.
- Support activate-new mode after connecting a new account.
- Serialize concurrent connect flows for the same provider.
- Avoid deleting or overwriting existing stored accounts for that provider.

## Out Of Scope

- Reimplementing OAuth UI or provider auth flows.
- Importing accounts from external files.
- Non-OAuth provider support.

## Dependencies

- Local TUI manager.
- Host auth sync.
- Account deduplication.
- Manual active account switcher.
- Provider OAuth APIs.
- Plugin-owned bridge account service.

## Acceptance Criteria

- Given account A is active, when the user connects account B in preserve mode, then B is captured and A is restored as active after sync.
- Given account A is active, when the user connects account B in activate mode, then B is captured and remains active after sync.
- Given the connected account already exists, then credentials are updated and no duplicate appears.
- Given OAuth completes but identity extraction is unsafe, then the plugin does not add a guessed account.
- Given OpenCode returns a structured provider OAuth error, then the user sees a specific safe error message.
- Given restore of previous active account fails, then the user is told the new account may still be live.

## Implementation Notes

- Treat OAuth completion and capture as separate from activation policy.
- Preserve the previous active account id before starting OAuth.
- Use server-side reconciliation wait rather than directly reading the OAuth callback result as final storage truth.
- TUI calls bridge endpoints; server-side service owns SDK OAuth calls, capture, restore, and activation policy.
- Provider OAuth pending state is keyed by provider ID, so overlapping connect flows for one provider can overwrite pending state.

## Open Questions

- Whether preserve or activate should be the default choice.
