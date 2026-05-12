# OpenCode Implementation Reference

This file collects OpenCode core implementation points relevant to the multi-account provider plugin.

OpenCode source used for references:

- Repository: `https://github.com/anomalyco/opencode`
- Branch: `dev`
- Package version: `1.14.48`
- Git commit: `8feb4a31c75e8bd3bd8f84ec860cfd4d326479b4`
- Worktree state during analysis: clean

## Plugin Packaging

- Server plugins default-export `{ id?, server }`.
- TUI plugins default-export `{ id?, tui }`.
- A single module exporting both `server` and `tui` is rejected.
- Package plugins should expose separate `./server` and `./tui` entrypoints.
- Server package loading can fall back to `main`; TUI package loading does not use `main` and needs `exports["./tui"]`.

References:

- `packages/plugin/src/index.ts:77`
- `packages/plugin/src/tui.ts:545`
- `packages/opencode/src/plugin/shared.ts:103`
- `packages/opencode/src/plugin/shared.ts:272`
- `packages/opencode/specs/tui-plugins.md:102`

Implications:

- Keep this package split into `src/server`, `src/tui`, and `src/shared`.
- Keep package exports for `./server` and `./tui`.
- Do not add one default export containing both runtimes.

## Server Plugin Hooks

Relevant server hook surface:

- `event({ event })`
- `chat.params(input, output)`
- `chat.headers(input, output)`
- `config(input)`

References:

- `packages/plugin/src/index.ts:222`
- `packages/plugin/src/index.ts:246`
- `packages/plugin/src/index.ts:256`
- `packages/opencode/src/plugin/index.ts:242`
- `packages/opencode/src/plugin/index.ts:258`

Important behavior:

- Event hooks subscribe to the OpenCode bus and are fire-and-forget.
- Event hooks cannot mutate the current request or abort runtime flow.
- Trigger hooks run sequentially and mutate a shared output object.
- Throwing from a trigger hook can stop pre-request processing, but there is no structured plugin abort API.

Implications:

- Use `event` only for observation and staging state.
- Use `chat.params` or `chat.headers` as the pre-request boundary for request context capture and staged rotation attempts.
- Do not assume retry events can directly change the in-flight provider call.

## TUI Plugin Surface

Relevant TUI APIs:

- `api.keymap.registerLayer({ commands, bindings })`
- `api.ui.Dialog*`, `api.ui.dialog`, `api.ui.toast`
- `api.client`
- `api.state`
- `api.lifecycle`

References:

- `packages/plugin/src/tui.ts:500`
- `packages/opencode/specs/tui-plugins.md:230`
- `packages/opencode/specs/tui-plugins.md:261`
- `packages/opencode/src/cli/cmd/tui/plugin/api.tsx:231`
- `packages/opencode/src/cli/cmd/tui/feature-plugins/system/plugins.tsx:48`

Important behavior:

- `api.command` exists but is legacy/deprecated.
- Palette commands should be registered through `api.keymap.registerLayer` with `namespace: "palette"`.
- `slashName` exposes a TUI command as slash-like palette/autocomplete command.
- Local TUI command execution does not need to send a model request.
- If a user manually submits an unknown slash command as prompt text, it can fall through to model prompting.

References:

- `packages/opencode/specs/tui-plugins.md:234`
- `packages/opencode/src/cli/cmd/tui/component/prompt/autocomplete.tsx:538`
- `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx:1150`

Implications:

- Implement `/provider-accounts` as a TUI keymap palette command, not a server slash command.
- Prefer command palette/autocomplete path for local execution.
- Use dialogs/selectors/toasts for account management flows.

## Legacy Auth Storage

OpenCode's active provider auth is stored in legacy `auth.json`.

Reference:

- `packages/opencode/src/auth/index.ts:9`

Path:

```ts
path.join(Global.Path.data, "auth.json")
```

`Global.Path.data` is based on XDG data dir plus `opencode`.

References:

- `packages/core/src/global.ts:9`
- `packages/core/src/global.ts:20`

Auth schema:

- OAuth: `{ type: "oauth", refresh, access, expires, accountId?, enterpriseUrl? }`
- API: `{ type: "api", key, metadata? }`
- Well-known: `{ type: "wellknown", key, token }`

References:

- `packages/opencode/src/auth/index.ts:13`
- `packages/opencode/src/auth/index.ts:22`
- `packages/opencode/src/auth/index.ts:28`

Important behavior:

- `auth.all()` reads `auth.json` on each call unless `OPENCODE_AUTH_CONTENT` is set.
- `auth.set(providerID, info)` rewrites the provider entry and uses file mode `0600`.
- `auth.remove(providerID)` removes normalized provider keys and rewrites file mode `0600`.

References:

- `packages/opencode/src/auth/index.ts:57`
- `packages/opencode/src/auth/index.ts:72`
- `packages/opencode/src/auth/index.ts:82`

Implications:

- Treat `auth.json` as the read-side sync source.
- Use SDK `auth.set` and `auth.remove` for writes.
- Do not mutate `auth.json` directly.
- Watcher-based sync is still needed because there is no auth-change bus event.
- `OPENCODE_AUTH_CONTENT` can make file watching irrelevant in special embedded/control-plane contexts.

## Auth HTTP And SDK APIs

Supported live auth mutation routes:

- `PUT /auth/:providerID` annotated as `auth.set`
- `DELETE /auth/:providerID` annotated as `auth.remove`

References:

- `packages/opencode/src/server/routes/instance/httpapi/groups/control.ts:38`
- `packages/opencode/src/server/routes/instance/httpapi/groups/control.ts:50`
- `packages/opencode/src/server/routes/instance/httpapi/handlers/control.ts:13`
- `packages/opencode/src/server/routes/instance/httpapi/handlers/control.ts:21`

Implications:

- Stored account credentials should be kept in exactly the shape accepted by SDK `auth.set`.
- A successful API response means the file write completed, but plugin storage reconciliation still must confirm active fingerprint.

## Provider OAuth APIs

Provider auth routes:

- `GET /provider/auth`
- `POST /provider/:providerID/oauth/authorize`
- `POST /provider/:providerID/oauth/callback`

References:

- `packages/opencode/src/server/routes/instance/httpapi/groups/provider.ts:27`
- `packages/opencode/src/server/routes/instance/httpapi/groups/provider.ts:37`
- `packages/opencode/src/server/routes/instance/httpapi/groups/provider.ts:50`
- `packages/opencode/src/server/routes/instance/httpapi/handlers/provider.ts:39`
- `packages/opencode/src/server/routes/instance/httpapi/handlers/provider.ts:43`
- `packages/opencode/src/server/routes/instance/httpapi/handlers/provider.ts:71`

Provider OAuth result shape:

- Authorization returns `{ url, method, instructions }`.
- Callback success persists OAuth credentials when result contains `refresh`.
- Callback success persists API credentials when result contains `key`.

References:

- `packages/plugin/src/index.ts:165`
- `packages/opencode/src/provider/auth.ts:158`
- `packages/opencode/src/provider/auth.ts:183`
- `packages/opencode/src/provider/auth.ts:196`
- `packages/opencode/src/provider/auth.ts:203`

Important behavior:

- OAuth pending state is keyed only by `providerID`.
- Starting another OAuth flow for the same provider can overwrite pending state.
- HTTP callback persists under the requested provider ID; `result.provider` is ignored there.

References:

- `packages/opencode/src/provider/auth.ts:120`
- `packages/opencode/src/provider/auth.ts:174`
- `packages/opencode/src/provider/auth.ts:204`

Implications:

- Serialize connect flows per provider.
- Capture new accounts from host auth reconciliation after OAuth completes.
- Treat OAuth completion and account activation policy as separate steps.
- Do not depend on callback response carrying the new auth payload.

## OpenAI OAuth Identity

OpenCode's OpenAI/Codex OAuth implementation stores `accountId`, not `chatgpt_account_user_id`.

References:

- `packages/opencode/src/plugin/codex.ts:58`
- `packages/opencode/src/plugin/codex.ts:77`
- `packages/opencode/src/plugin/codex.ts:85`
- `packages/opencode/src/plugin/codex.ts:509`
- `packages/opencode/src/plugin/codex.ts:585`

Identity extraction sources:

- `chatgpt_account_id`
- `https://api.openai.com/auth.chatgpt_account_id`
- first organization id fallback

Reference:

- `packages/opencode/src/plugin/codex.ts:77`

Request-time use:

- OpenAI OAuth fetch sets `Authorization: Bearer <access>`.
- If `accountId` exists, it sets `ChatGPT-Account-Id`.
- Token refresh preserves or re-extracts `accountId` and writes through SDK `auth.set`.

References:

- `packages/opencode/src/plugin/codex.ts:424`
- `packages/opencode/src/plugin/codex.ts:435`
- `packages/opencode/src/plugin/codex.ts:466`
- `packages/opencode/src/plugin/codex.ts:468`

Implications:

- Initial strict OpenAI extractor should use OAuth `accountId` from `auth.json`.
- Existing specs mentioning `chatgpt_account_user_id` should be corrected or treated as stale.
- Fingerprint should include provider ID plus `accountId`.
- Account labels may need to be derived from `accountId` unless richer metadata is added later.

## Provider Request Timing

OpenCode resolves language model, config, provider info, and current auth before plugin `chat.params` and `chat.headers` hooks run.

References:

- `packages/opencode/src/session/llm.ts:90`
- `packages/opencode/src/session/llm.ts:161`
- `packages/opencode/src/session/llm.ts:181`
- `packages/opencode/src/session/llm.ts:364`
- `packages/opencode/src/session/llm.ts:373`

Provider loading behavior:

- Provider state loads env keys, stored API keys, then plugin auth loader output.
- Provider SDK cache key includes provider options.
- Language model cache key is only `providerID/modelID`.

References:

- `packages/opencode/src/provider/provider.ts:1269`
- `packages/opencode/src/provider/provider.ts:1282`
- `packages/opencode/src/provider/provider.ts:1295`
- `packages/opencode/src/provider/provider.ts:1464`
- `packages/opencode/src/provider/provider.ts:1584`

Implications:

- Auth mutation inside `chat.params` is not guaranteed to affect the same request for every provider.
- Rotation should be considered staged for next request/retry boundary, not atomic in the retry event.
- OpenAI OAuth is somewhat better because its custom fetch calls `getAuth()` at fetch time, but this should not be generalized to all providers.

## Retry And Error Events

Retry status event shape:

```ts
{
  type: "session.status",
  properties: {
    sessionID: string,
    status: {
      type: "retry",
      attempt: number,
      message: string,
      action?: {
        reason: string,
        provider: string,
        title: string,
        message: string,
        label: string,
        link?: string,
      },
      next: number,
    },
  },
}
```

References:

- `packages/opencode/src/session/status.ts:8`
- `packages/opencode/src/session/status.ts:34`
- `packages/opencode/src/session/status.ts:77`
- `packages/opencode/src/session/processor.ts:756`

Final error event:

- `session.error` carries optional `sessionID` and optional assistant error.

Reference:

- `packages/opencode/src/session/session.ts:358`

Retry detection behavior:

- Context overflow is not retried.
- API errors retry only when retryable or HTTP status is 5xx.
- `FreeUsageLimitError` maps to `free_tier_limit` action.
- `GoUsageLimitError` maps to `account_rate_limit` action.
- Plain text rate-limit strings are detected.
- JSON error codes like `too_many_requests`, `rate_limit`, `exhausted`, and `unavailable` are detected.

References:

- `packages/opencode/src/session/retry.ts:66`
- `packages/opencode/src/session/retry.ts:74`
- `packages/opencode/src/session/retry.ts:87`
- `packages/opencode/src/session/retry.ts:123`
- `packages/opencode/src/session/retry.ts:136`

Backoff behavior:

- `retry-after-ms` is milliseconds.
- Numeric `retry-after` is seconds.
- HTTP-date `retry-after` is supported.
- Without headers, exponential backoff is capped at 30 seconds.
- `session.status.retry.next` exposes retry timestamp.

References:

- `packages/opencode/src/session/retry.ts:24`
- `packages/opencode/src/session/retry.ts:33`
- `packages/opencode/src/session/retry.ts:174`

Implications:

- Use `session.status.retry` as the main live signal.
- Use `status.action.reason === "account_rate_limit"` as a strong account-limit signal when present.
- Use message classification for provider rate/quota phrases when no action exists.
- Use final `session.error` only for terminal metadata and final 429 cases.
- Do not recompute backoff when `status.next` is available.

## Request Attribution Limits

`chat.params` input includes:

- `sessionID`
- `agent`
- `model`
- `provider`
- `message`

Reference:

- `packages/plugin/src/index.ts:246`

Open question from core behavior:

- Retry events are session-level.
- If multiple requests/retries overlap within one session, session-only attribution may be insufficient unless message/request ID is tracked from hook input.

Implications:

- Capture request context as early as possible in `chat.params` or `chat.headers`.
- Include session ID, provider ID, message/user ID if available, and `startedAt`.
- Resolve responsible account through runtime auth timeline at `startedAt`.
- Skip exhaustion when attribution cannot be proven.

## Abort And Current Request Control

Core has request abort support internally and via session abort endpoint, but plugin hooks do not receive the active abort signal.

References:

- `packages/opencode/src/session/llm.ts:419`
- `packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts:214`
- `packages/opencode/src/session/run-state.ts:77`

Implications:

- Plugin cannot directly abort or rewrite an already-running provider request from a retry event.
- All-accounts-exhausted handling can log/toast/report, but active request termination may require throwing from a future pre-request hook or using session APIs deliberately.

## auth-v2.json

OpenCode has a v2 auth file with multi-account-oriented structures.

Reference:

- `packages/opencode/src/v2/auth.ts:108`

Path:

```ts
path.join(global.data, "auth-v2.json")
```

Important current limitation:

- Provider OAuth routes and control auth routes referenced above use legacy `@/auth`, not `v2/auth`.

Note:

- This suggests the plugin may duplicate logic that OpenCode could eventually provide as built-in multi-account auth.
- This is only a future overlap risk, not an implementation input for the current plugin.
- Current plugin design and decisions should continue to target the live OpenCode integration points: legacy `auth.json`, SDK `auth.set/remove`, provider OAuth APIs, and plugin hooks.

Implications:

- Do not build this plugin on `auth-v2.json` for current OpenCode integration.
- Revisit if OpenCode migrates provider OAuth and SDK control auth to v2.

## Implementation Priorities For This Plugin

1. Server-side SQLite storage with account rows keyed by `(provider, account_id)`.
2. OpenAI strict identity extractor using OAuth `accountId`.
3. Host auth watcher over legacy `auth.json`, with mtime cache and retry on partial reads.
4. Central reconciliation path for startup scan, file changes, OAuth completion, and `auth.set` confirmation.
5. Server-side account switching using SDK `auth.set` plus reconciliation wait.
6. TUI `/provider-accounts` through keymap palette command and dialogs.
7. Server `event` hook for retry/rate-limit detection and staged rotation.
8. Request context capture in `chat.params` or `chat.headers` before staged auth mutation.
9. In-memory auth timeline maintained by reconciliation events.
10. Conservative safe-skip behavior for weak identity or unsafe attribution.
