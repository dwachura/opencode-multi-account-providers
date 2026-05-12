# Backlog

This backlog decomposes the multi-account provider plugin into independently refinable user stories.

Priority means implementation order, not product importance.

| Story | Priority | Depends On |
| --- | --- | --- |
| [Define Accounts From TUI OAuth](./01-tui-oauth-account-definition/README.md) | P0 | Completed server storage, OAuth APIs, TUI/server bridge |
| [Provider Identity Extraction](./02-provider-identity-extraction/README.md) | P0 | Provider registry shape |
| [Host Auth Sync](./03-host-auth-sync/README.md) | P0 | Server storage, identity extraction |
| [Account Deduplication](./04-account-deduplication/README.md) | P0 | Server storage, identity extraction |
| [Multi-Account Inventory](./05-multi-account-inventory/README.md) | P0 | Server storage, auth sync, deduplication |
| [Manual Active Account Switcher](./06-manual-active-account-switcher/README.md) | P1 | Inventory, stored credentials, host auth APIs, sync confirmation |
| [Local TUI Manager](./07-local-tui-manager/README.md) | P1 | Inventory, active state |
| [Connect Extra Accounts](./08-connect-extra-accounts/README.md) | P1 | TUI manager, auth sync, deduplication, active switching |
| [Disconnect And Remove Accounts](./09-disconnect-remove-accounts/README.md) | P1 | Inventory, active switching, host auth APIs |
| [Reset Exhausted Accounts](./10-reset-exhausted-accounts/README.md) | P1 | Exhausted-account tracking |
| [Exhausted-Account Tracking](./11-exhausted-account-tracking/README.md) | P1 | Server storage, inventory |
| [Rate-Limit Detection](./12-rate-limit-detection/README.md) | P2 | Server plugin hooks |
| [Safe Retry Attribution](./13-safe-retry-attribution/README.md) | P2 | Request tracking, auth timeline, account identity |
| [On-The-Fly Account Rotation](./14-on-the-fly-account-rotation/README.md) | P2 | Exhaustion tracking, attribution, active switching, sync confirmation |
| [All-Accounts-Exhausted Failure](./15-all-accounts-exhausted-failure/README.md) | P2 | Rotation, exhausted state |
| [Logging And Toasts](./16-logging-and-toasts/README.md) | P2 | Runtime/TUI flows |
| [Provider Config And Fallback Identity](./17-provider-config-and-fallback-identity/README.md) | P3 | Provider registry |

## Milestones

| Milestone | Stories |
| --- | --- |
| M1 Account Definition | 01, 02, 03, 04, 05 |
| M2 Manual MVP | 06, 07, 08, 09, 10, 11 |
| M3 Runtime Automation | 12, 13, 14, 15, 16 |
| M4 Extension | 17 |
