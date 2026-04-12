# Backlog

## TUI Account Management

The local `/provider-accounts` flow exists, but one major piece is still deferred:

- guided `Connect account` flow inside the TUI

Current expectation for that work:

- reuse the normal `opencode auth login <provider>` flow
- keep OAuth implementation outside this plugin
- detect capture completion and refresh the dialog

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
