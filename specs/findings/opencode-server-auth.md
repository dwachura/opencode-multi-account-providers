# OpenCode Server Auth Findings

## Summary

OpenCode server auth is optional Basic auth controlled by environment variables. It is not enabled by default.

If `OPENCODE_SERVER_PASSWORD` is unset or empty, OpenCode treats the HTTP server as unsecured and allows requests without credentials.

## Configuration

Auth config is defined in `packages/opencode/src/server/auth.ts`.

Environment variables:

- `OPENCODE_SERVER_PASSWORD`: enables auth when set to a non-empty value.
- `OPENCODE_SERVER_USERNAME`: optional username, defaulting to `opencode`.

Auth is required only when:

```ts
Option.isSome(config.password) && config.password.value !== ""
```

## Credential Format

OpenCode uses HTTP Basic auth:

```txt
Authorization: Basic base64(username:password)
```

It also accepts the same base64 value as a query parameter:

```txt
?auth_token=base64(username:password)
```

Invalid or missing credentials return `401` with:

```txt
www-authenticate: Basic realm="Secure Area"
```

## Route Coverage

Auth middleware is applied to OpenCode HTTP API route groups including:

- global routes
- event stream
- provider/auth routes
- session routes
- config routes
- TUI routes
- PTY routes
- raw UI fallback

Known bypasses:

- auth disabled because `OPENCODE_SERVER_PASSWORD` is unset or empty
- selected static UI assets such as manifest and web app icons
- PTY websocket route when a valid PTY ticket URL is present

## Client Behavior

OpenCode-generated clients attach Basic auth headers through `ServerAuth.headers(...)` when a password is configured.

Server plugins receive an SDK client configured with:

```ts
headers: ServerAuth.headers()
```

Attach/run clients expose CLI options:

- `--password`
- `--username`

Those default to `OPENCODE_SERVER_PASSWORD` and `OPENCODE_SERVER_USERNAME` / `opencode`.

## Server Defaults

OpenCode network defaults are local-first:

- hostname: `127.0.0.1`
- port: `0` unless configured

`opencode serve` and `opencode web` warn when `OPENCODE_SERVER_PASSWORD` is not set.

When mDNS is enabled and no hostname is configured, OpenCode can listen on `0.0.0.0`.

## CORS

OpenCode allows CORS for:

- no origin
- `http://localhost:*`
- `http://127.0.0.1:*`
- `oc://renderer`
- Tauri localhost origins
- `https://*.opencode.ai`
- configured extra origins

CORS preflight can succeed without credentials, but protected requests still require Basic auth when server auth is enabled.

## Implications For This Plugin

- OpenCode does not use a bearer-token model for its built-in HTTP server.
- OpenCode server auth is optional and environment-driven.
- A plugin-owned local HTTP service cannot directly reuse OpenCode's auth middleware without OpenCode core changes.
- This plugin will introduce a plugin-owned loopback HTTP bridge.
- The bridge auth model should mirror OpenCode server auth rather than inventing a bearer-token model.
- If `OPENCODE_SERVER_PASSWORD` is unset or empty, the bridge allows loopback requests without credentials.
- If `OPENCODE_SERVER_PASSWORD` is set and non-empty, the bridge requires either Basic auth or `auth_token=base64(username:password)`.
- `OPENCODE_SERVER_USERNAME` should default to `opencode`.
- The bridge should return `401` with `www-authenticate: Basic realm="Secure Area"` for invalid or missing credentials when auth is required.
- The bridge must bind to loopback only in the first implementation.
- The bridge should not use mDNS or inherit OpenCode's remote listening behavior.
- The bridge CORS policy should allow no origin, localhost/127.0.0.1 origins, and `oc://renderer`; broader origins are unnecessary for local TUI use.

## References

- `packages/opencode/src/server/auth.ts`
- `packages/opencode/src/server/routes/instance/httpapi/middleware/authorization.ts`
- `packages/opencode/src/server/routes/instance/httpapi/server.ts`
- `packages/opencode/src/cli/network.ts`
- `packages/opencode/src/cli/cmd/serve.ts`
- `packages/opencode/src/cli/cmd/web.ts`
- `packages/opencode/src/cli/cmd/tui/attach.ts`
- `packages/opencode/src/cli/cmd/run.ts`
- `packages/opencode/src/server/cors.ts`
