# Backlog

## Interactive TUI Harness

`script/e2e.ts` still needs more work before it can be treated as a stable validation path.

Open findings:

- TUI plugin config discovery did not match server-side config discovery
- external TUI plugin loading is stricter than server plugin loading; server-only helper plugins still need a `tui()` export
- helper-side fake-account mutations were hardened to use auth APIs plus reconciliation waits, but the live interactive prompt path still needs more work
- fake-provider prompts in the interactive harness still do not reliably use OAuth auth from the fake auth plugin during real prompt execution

Desired end state:

- `bun run e2e:tui`
- `bun run e2e:account:add <label> <limit>`
- prompt in the live TUI

should reliably drive the same auth state observed by the watcher and by the provider request path.

## Account Metadata

Potential storage additions:

- `created_at`
- `updated_at`

Expected behavior:

- preserve `created_at` for existing accounts
- bump `updated_at` whenever stored credentials or metadata change

## Other Ideas

- optional confirm-before-switch behavior for rate-limited accounts
- account usage tracking and provider-side usage polling

### OpenAI Usage Endpoint Reference

```bash
curl --location 'https://chatgpt.com/backend-api/wham/usage' \
  --header 'Authorization: <token>'
```

Example response:

```json
{
  "user_id": "<user id>",
  "account_id": "<account id>",
  "email": "<user email>",
  "plan_type": "team",
  "rate_limit": {
    "allowed": true,
    "limit_reached": false,
    "primary_window": {
      "used_percent": 19,
      "limit_window_seconds": 18000,
      "reset_after_seconds": 10721,
      "reset_at": 1775869147
    },
    "secondary_window": {
      "used_percent": 19,
      "limit_window_seconds": 604800,
      "reset_after_seconds": 519936,
      "reset_at": 1776378362
    }
  },
  "code_review_rate_limit": null,
  "additional_rate_limits": null,
  "credits": {
    "has_credits": false,
    "unlimited": false,
    "overage_limit_reached": false,
    "balance": null,
    "approx_local_messages": null,
    "approx_cloud_messages": null
  },
  "spend_control": {
    "reached": false
  },
  "promo": null
}
```
