# Plugin API Session

Date: 2026-05-31

## Overall Session Summary

- Started by reading `specs/.stash/current-decisions.md` to recover next planned work.
- Confirmed previous plan was to build `/provider-accounts` add-account vertical slice after reassessing bridge approach.
- Reviewed prior spec update style: research OpenCode reality first, record findings, then propagate decisions into product/backlog specs.
- User decided to use a plugin-dedicated server/bridge to centralize server-side logic and keep UI components thin.
- Rechecked fresh `../opencode` against previous baseline.
- Found current OpenCode package version `1.15.13` at commit `abaabdcb738652e83526af08a6d805f1d5fd5afc`.
- Found 74 commits since analyzed baseline `1.15.12` / `710ed7cb3380b3ff923ff4d91fe505b9d24701de`.
- Confirmed `../opencode` worktree was clean during analysis.
- Inspected plugin APIs, TUI APIs, provider OAuth APIs, server auth, CORS, SDK client behavior, request hooks, retry status, and event delivery.
- Prepared two plans:
  - spec update after OpenCode codebase changes
  - plugin API implementation using OpenCode-like HTTP/auth style
- Executed plan 1 by updating specs.
- Replaced old stash memory file with this focused session file.
- Current next work is plan 2: implement plugin-owned bridge/API skeleton, then wire TUI and server plugin around it.

Key constraints retained:

- This repo changes only the plugin project.
- OpenCode core is reference-only.
- Do not assume unavailable APIs exist.
- Do not implement provider OAuth ourselves; use OpenCode SDK provider OAuth routes.
- Do not write `auth.json` directly; use OpenCode SDK auth APIs for live auth mutation.
- Plugin storage is not live auth until host-auth sync confirms it.
- TUI must not import server DB/service code directly.
- Bridge is plugin-owned infrastructure, not OpenCode-native routing.

## Spec Update Summary

- OpenCode reference baseline updated to `1.15.13` / `abaabdcb738652e83526af08a6d805f1d5fd5afc`.
- Previous analyzed baseline was `1.15.12` / `710ed7cb3380b3ff923ff4d91fe505b9d24701de`.
- Latest OpenCode check found no official TUI-to-server plugin RPC.
- Latest OpenCode check found no plugin API for mounting custom HTTP routes into OpenCode's server.
- Server plugin events now flow through `EventV2Bridge`, are filtered by directory, and still reach plugins as `{ id, type, properties }`.
- Provider OAuth/auth routes and retry signal shape are unchanged.
- Plugin-owned loopback HTTP bridge is now the chosen TUI/server communication mechanism.
- The bridge is plugin-owned infrastructure, not OpenCode-native routing.
- Bridge root is `/opencode-auth-pool`.
- Bridge binds to `127.0.0.1` only.
- Bridge uses random/free port plus plugin-owned discovery metadata.
- Bridge does not use mDNS and does not support remote exposure in first implementation.
- Bridge auth mirrors OpenCode server auth:
  - `OPENCODE_SERVER_PASSWORD` unset or empty means allow loopback requests without credentials.
  - `OPENCODE_SERVER_PASSWORD` set means require Basic auth or `auth_token=base64(username:password)`.
  - `OPENCODE_SERVER_USERNAME` defaults to `opencode`.
  - invalid credentials return `401` with `www-authenticate: Basic realm="Secure Area"`.
- Bridge CORS allows no origin, localhost/127.0.0.1 origins, and `oc://renderer`.
- Server-side service owns account DB operations, host-auth sync orchestration, OAuth capture coordination, account switching, and future rotation support.
- TUI only calls the bridge for plugin-owned account operations and must not import server DB code.
- OpenCode-owned auth/OAuth behavior still goes through OpenCode SDK routes from the server-side service.

Updated spec files:

- `specs/findings/opencode-implementation-reference.md`
- `specs/findings/opencode-server-auth.md`
- `specs/product-spec.md`
- `specs/decisions/002-server-persistent-storage.md`
- `specs/backlog/01-tui-oauth-account-definition/README.md`
- `specs/backlog/03-host-auth-sync/README.md`
- `specs/backlog/07-local-tui-manager/README.md`
- `specs/backlog/08-connect-extra-accounts/README.md`

## Plan 2: Plugin API Implementation

1. Add shared API contracts.
   - Add `src/shared/api.ts`.
   - Define route root `/opencode-auth-pool`.
   - Define request/response and error types.
   - Use JSON error shape `{ name, data: { message, ... } }`.

2. Add bridge auth.
   - Add `src/server/bridge-auth.ts`.
   - Mirror OpenCode Basic auth behavior.
   - Support `Authorization: Basic ...`.
   - Support `?auth_token=base64(username:password)`.
   - Use `OPENCODE_SERVER_PASSWORD` and `OPENCODE_SERVER_USERNAME || "opencode"`.
   - Return `401` with `www-authenticate: Basic realm="Secure Area"` when auth is required and invalid.

3. Add bridge CORS.
   - Add `src/server/bridge-cors.ts`.
   - Allow no origin, localhost, `127.0.0.1`, and `oc://renderer`.
   - Handle `OPTIONS` preflight.

4. Add server-side account service.
   - Add `src/server/service.ts`.
   - Centralize account orchestration outside UI components.
   - Initial operations:
     - list accounts
     - list OAuth-capable providers through OpenCode SDK
     - start OAuth through OpenCode SDK
     - complete OAuth through OpenCode SDK
   - Later operations:
     - wait for host-auth reconciliation
     - upsert account
     - preserve/activate account policy
     - switch active account
     - reset exhaustion
     - disconnect account

5. Add HTTP bridge.
   - Add `src/server/bridge.ts`.
   - Bind `127.0.0.1` on port `0`.
   - Return JSON only.
   - Initial endpoints:
     - `GET /opencode-auth-pool/health`
     - `GET /opencode-auth-pool/providers`
     - `GET /opencode-auth-pool/accounts?provider=...`
     - `POST /opencode-auth-pool/providers/:providerID/oauth/authorize`
     - `POST /opencode-auth-pool/providers/:providerID/oauth/callback`

6. Add bridge discovery.
   - Add `src/server/discovery.ts`.
   - Add `src/tui/bridge-client.ts`.
   - Server writes metadata containing URL, directory, worktree, PID, and start time.
   - TUI reads metadata using `api.state.path.directory` and `api.state.path.worktree`.
   - TUI treats stale or unreachable bridge as a local unavailable state.

7. Wire server plugin.
   - Update `src/server/index.ts`.
   - Open DB.
   - Create service.
   - Start bridge.
   - Write discovery metadata.
   - Return `dispose` that stops bridge, removes/stales discovery, and closes DB.

8. Wire TUI.
   - Replace placeholder dialog with bridge-backed flow.
   - Discover bridge.
   - Health check.
   - Load accounts/providers.
   - Show clear unavailable state if bridge is missing.
   - Add provider selection for add-account flow.

9. Add tests.
   - Auth helper tests:
     - password unset allows
     - valid Basic auth allows
     - invalid Basic auth rejects
     - valid `auth_token` allows
   - Bridge tests:
     - health
     - CORS preflight
     - accounts list
   - Later sandbox e2e:
     - mock OAuth authorize/callback through bridge
     - account appears after host-auth reconciliation
