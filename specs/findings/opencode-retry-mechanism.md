# opencode Retry Mechanism Findings

## Summary

opencode exposes enough event data for external plugins to react to LLM retry/rate-limit behavior without intercepting every provider HTTP response.

The most useful event is `session.status` with `status.type === "retry"`. `session.error` is still useful, but it is emitted for final failures after retry handling has completed.

## Relevant Events

### `session.status`

During retryable LLM failures, opencode sets session status to `retry`:

```ts
{
  type: "session.status",
  properties: {
    sessionID: string,
    status: {
      type: "retry",
      attempt: number,
      message: string,
      next: number
    }
  }
}
```

Fields:

- `attempt`: retry attempt number.
- `message`: human-readable retry reason.
- `next`: Unix timestamp in milliseconds for the next retry.

This is the best signal for reacting while opencode is actively backing off.

### `session.error`

When retries are exhausted or the error is not retryable, opencode publishes `session.error`.

For provider API failures, the event has this shape:

```ts
{
  type: "session.error",
  properties: {
    sessionID?: string,
    error?: {
      name: "APIError",
      data: {
        message: string,
        statusCode?: number,
        isRetryable: boolean,
        responseHeaders?: Record<string, string>,
        responseBody?: string,
        metadata?: Record<string, string>
      }
    }
  }
}
```

This is useful for final failure handling, logging, or account/provider health tracking.

## Rate Limit Detection

A plugin should treat these as strong rate-limit signals:

- `session.error` where `error.name === "APIError"` and `error.data.statusCode === 429`.
- `session.status` retry messages containing `rate limit`, `too many requests`, or related provider text.
- `session.status` retry messages containing `Provider is overloaded`, which opencode may emit for retryable provider overload conditions.

For final API errors, retry timing metadata may be available in headers:

```ts
event.properties.error.data.responseHeaders?.["retry-after"]
event.properties.error.data.responseHeaders?.["retry-after-ms"]
```

## Internal Backoff Behavior

opencode retry scheduling uses provider error metadata when available:

- `retry-after-ms` is interpreted as milliseconds.
- `retry-after` is interpreted as seconds when numeric.
- `retry-after` can also be parsed as an HTTP date.
- If retry headers are absent, opencode uses exponential backoff.
- Without headers, backoff is capped at 30 seconds.
- With retry headers, the cap is the max 32-bit signed integer timeout.

## Plugin Strategy

For a plugin that wants to react to rate limits without raw response interception:

- Listen to `event` hook.
- Use `session.status` with `status.type === "retry"` for live retry/backoff state.
- Use `session.error` with `APIError` and `statusCode === 429` for final rate-limit failure state.
- Prefer `status.next` over re-computing backoff in the plugin.
- Use `responseHeaders` and `responseBody` only from final `session.error`; they are not present on `session.status` retry events.

Example plugin logic:

```ts
import type { Plugin } from "@opencode-ai/plugin"

export const RateLimitPlugin: Plugin = async () => ({
  event: async ({ event }) => {
    if (event.type === "session.status" && event.properties.status.type === "retry") {
      const message = event.properties.status.message.toLowerCase()
      if (message.includes("rate") || message.includes("too many requests") || message.includes("overloaded")) {
        console.log("LLM retrying", {
          sessionID: event.properties.sessionID,
          attempt: event.properties.status.attempt,
          message: event.properties.status.message,
          retryAt: new Date(event.properties.status.next).toISOString(),
        })
      }
    }

    if (event.type === "session.error" && event.properties.error?.name === "APIError") {
      const error = event.properties.error.data
      if (error.statusCode === 429) {
        console.log("LLM rate limit failed finally", {
          sessionID: event.properties.sessionID,
          message: error.message,
          retryAfter: error.responseHeaders?.["retry-after"],
          retryAfterMs: error.responseHeaders?.["retry-after-ms"],
          body: error.responseBody,
        })
      }
    }
  },
})
```

## Limitations

- `session.status` retry events do not include raw HTTP status, response headers, or response body.
- `session.error` exposes response headers/body only for final API errors.
- Successful LLM responses are not exposed as raw HTTP responses through plugin events.
- Full raw response logging still requires wrapping provider `options.fetch` or core changes.
