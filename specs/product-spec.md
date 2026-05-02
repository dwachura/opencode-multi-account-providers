# Product Spec

## Purpose

This project adds multi-account support for OAuth-based model providers inside OpenCode.

The product goal is simple:

- let one provider keep multiple stored accounts
- let the user manage those accounts locally
- keep the active account in sync with OpenCode auth
- automatically continue work by rotating accounts when one is rate-limited

## Product Shape

The product is best understood as six user-facing areas:

1. Account management
2. Active auth management
3. Automatic continuity under rate limits
4. State synchronization and consistency
5. Provider adaptation
6. Safe retry attribution

## Scope

Current scope:

- OAuth-style provider auth
- shared multi-account storage per provider
- local TUI account management
- automatic account rotation after rate limits
- account identity extraction for supported providers

Out of scope for this base spec:

- non-OAuth auth flows
- usage analytics or billing features
- provider-specific quota prediction
- full parity for non-TUI local management flows

## OpenCode Context

The design of this plugin is heavily shaped by how OpenCode exposes plugins, auth, runtime hooks, and TUI behavior.

OpenCode plugin architecture relevant to this project:

- server plugins run in the OpenCode server context and are suited for request/runtime behavior
- TUI plugins run in the OpenCode TUI context and are suited for local commands, dialogs, and toasts
- SDK auth APIs are the supported write path for live provider auth
- provider OAuth APIs are the supported path for starting and completing provider login
- `auth.json` is useful as a read-side sync point for host auth state
- request setup and retry/failure handling happen in different runtime phases
- provider auth integrations still own final request-time credential use

Overall OpenCode-driven decisions:

1. OpenCode separates `server` and `tui` plugin entrypoints, so this project is intentionally split into two runtime sides.
2. OpenCode already owns provider auth and exposes host mutation APIs such as `auth.set(...)`, `auth.remove(...)`, `provider.auth(...)`, and `provider.oauth.authorize(...)` / `provider.oauth.callback(...)`, so this plugin manages account lists and active-account choice instead of re-implementing provider auth.
3. `command.execute.before` is not a true local-command completion boundary for this feature, so `/provider-accounts` is implemented as a TUI-local command/dialog instead of a server-side slash-command path.
4. OpenCode runtime hooks are split into phases: retry/failure information arrives through events, while next-request behavior is shaped in `chat.params`, so automatic rotation is intentionally split across those phases instead of treated as one atomic step.
5. OpenCode auth mutation and plugin-visible synced state are not the same thing, so flows that change auth wait for synced state instead of treating API completion as final success.
6. OpenCode/provider auth works differently across providers and does not provide one universal stable account identity for this plugin's use case, so provider-aware identity extraction and fingerprint-based joining are plugin-owned responsibilities.
7. OpenCode state is scoped by directory/workspace and can change outside this plugin, so the plugin uses host auth as the external source of truth and rebuilds local account state from it instead of inventing a fully separate auth model.

Core invariants this plugin must preserve:

- server and TUI behavior stay separate: server handles runtime work, TUI handles local account management
- `/provider-accounts` stays local and must not send a model request
- live auth changes go through OpenCode auth APIs, not direct `auth.json` writes
- plugin storage is not treated as live auth until host auth sync confirms it
- watcher-based sync owns auth-derived storage updates
- account identity must be stable enough to survive token refresh and account-list changes
- current account position is local state only and must not be used as a historical identity
- rotation is two-phase: retry handling marks/flags, next request setup applies auth change
- retry blame uses the account active when the request started, not whatever is active when the retry event arrives
- if retry attribution cannot be proven safely, the plugin skips exhaustion instead of guessing
- exhausted state is plugin policy, not provider auth state
- when all accounts are exhausted, the plugin fails clearly instead of silently retrying
- provider support quality depends on stable identity extraction
- runtime/helper flows must target the same OpenCode directory/workspace state
- async sync is expected, so flows must handle delay, timeout, and partial sync

## Major Flows And User Journeys

The plugin is built around five main journeys.

1. Build and inspect an account list.
2. Control which account is active.
3. Recover from rate limits automatically.
4. Keep plugin state synced with OpenCode auth.
5. Avoid unsafe changes when attribution or provider identity is not reliable.

### Build And Inspect Account List

The first account is captured from a normal OpenCode/provider login. The user authenticates through the existing provider auth flow, the plugin detects the resulting auth state, stores the account as managed state, and shows it in `/provider-accounts`.

Additional accounts are added from `/provider-accounts`. The user selects a provider, chooses `Connect account`, completes the provider OAuth flow, and the plugin captures the new account without removing existing accounts.

The same management flow lets the user inspect stored accounts, see which account is active, and see which accounts are exhausted.

Use cases:

- turn a normal single OpenCode login into the first managed provider account
- build a list of multiple accounts for the same provider
- understand which accounts exist and what state they are in

### Connect Without Disrupting Work

Adding an account does not always mean the user wants to switch to it. The connect flow supports two outcomes.

In preserve mode, the user is working under account A, connects account B, the plugin captures B, and then restores A as active.

In activate mode, the user connects a new account and keeps it active, so future requests use the newly connected account.

Use cases:

- add fallback capacity without disrupting the current working identity
- switch to a freshly added account immediately after onboarding

### Control Active Account

The user can manually choose which stored account OpenCode should use next. From the account list, the user selects an account, chooses `Set active`, the plugin updates OpenCode auth, and then waits until state confirms the switch.

Use case:

- manually choose which account OpenCode should use next

### Recover From Rate Limits

When a prompt hits a rate limit, the plugin detects the retry/rate-limit state, marks the responsible account exhausted, selects another usable account, and switches OpenCode auth to that account. Future retry/request work continues under the next account.

If every stored account is exhausted, the plugin stops with a clear failure instead of looping or retrying silently.

Use cases:

- keep work going when one account is rate-limited
- fail clearly when automatic recovery is no longer possible

### Reset Exhausted Accounts

The user can re-enable exhausted accounts from the provider account list. The reset flow clears selected exhausted accounts or all exhausted accounts, making them eligible for rotation again.

Use case:

- re-enable accounts after waiting for quota/window reset

### Disconnect Accounts

Disconnecting an inactive account removes it from stored state and leaves the active account unchanged.

Disconnecting the active account removes it locally, selects a remaining account as fallback, and switches OpenCode auth to that fallback account.

Disconnecting the last account removes stored account state and logs out provider auth through OpenCode.

Use cases:

- clean up unused accounts safely
- remove the current account without leaving provider auth in a broken state
- fully disconnect a provider from plugin-managed account state

### Stay Synced With OpenCode Auth

Auth may change outside the plugin UI. When that happens, the plugin observes host auth state and updates stored account state and active state accordingly.

Use case:

- keep plugin state aligned when OpenCode/provider auth changes elsewhere

### Stay Safe During Async Retries

A request can start under account A, auth can change before retry handling completes, and the retry failure can arrive later. The plugin attributes the failure to the account active when the request started, not whatever account is active when the retry event arrives.

Use case:

- prevent exhausting the wrong account during retries and rotations

### Handle Weak Provider Support Safely

If provider auth exists but stable identity cannot be extracted, the plugin skips or limits behavior instead of guessing unsafely.

Use case:

- avoid corrupt multi-account state for providers without reliable identity support

## Chapter 1: Account Management

This area covers the product experience of treating one provider as a set of stored accounts rather than a single login.

At a high level, the product should let the user:

- see which accounts exist for a provider
- add another account without losing previously stored ones
- inspect broad account state
- remove accounts that are no longer wanted
- reset exhausted state when an account becomes usable again

This is the main user-facing management area of the plugin.

### 1.1 Account Capture

Intent:

Bring a newly authenticated provider identity into the plugin as a managed stored account.

Chosen model and key decisions:

- capture is driven from observed host auth state, not from plugin-owned login state
- the stored account model includes stable identity, user-facing label, OAuth credentials, expiry, and optional provider metadata such as `accountId` and `enterpriseUrl`
- startup auth and later auth changes both use the same capture path

Problems addressed and failure modes considered:

- the plugin needs to support multiple captured accounts without re-implementing provider login flows
- provider auth composition alone is not a strong enough place to guarantee account capture

Constraints and limitations introduced:

- only OAuth-style auth is currently in scope
- capture depends on host auth being reflected into `auth.json`
- account capture quality depends on stable identity extraction being available for the provider

OpenCode SDK/app context:

- OpenCode/provider auth owns the real login flow, so this plugin captures accounts from observed host auth state instead of implementing provider login internally.
- OpenCode does not provide a built-in multi-account portfolio abstraction for one provider, so account capture had to become a plugin-owned layer on top of host auth.

### 1.2 Account Inventory

Intent:

Present the current set of stored accounts for a provider as a manageable account list.

Chosen model and key decisions:

- each provider is modeled as an ordered list of accounts plus `active` and `exhausted` state
- the same stored account list is shared by server behavior and local UI behavior
- SQLite was chosen as the persistent store for this shared account list

Problems addressed and failure modes considered:

- the plugin needs stable multi-account state, not a temporary in-memory list
- UI actions and runtime rotation need to operate on the same account list

Constraints and limitations introduced:

- active and exhausted state are represented relative to ordered account positions
- this keeps the local model compact, but historical/runtime logic cannot safely rely on positions alone

OpenCode SDK/app context:

- OpenCode exposes live auth state but not a native inventory of multiple stored accounts for the same provider.
- Server and TUI plugin sides are separate, so the plugin needs one shared persistent account list that both can read and change.

### 1.3 Account Deduplication

Intent:

Recognize when newly observed auth belongs to an already known account instead of creating duplicates.

Chosen model and key decisions:

- deduplication is based on a fingerprint derived from stable provider identity
- re-observing the same account updates stored credentials instead of adding another row
- token value itself is not the default production identity source

Problems addressed and failure modes considered:

- token refresh can change raw credentials while still representing the same real account
- storage order can change and cannot serve as a stable identity

Constraints and limitations introduced:

- deduplication quality depends directly on extractor quality
- generic token-based fallback identity is weaker and intentionally not the default production path

OpenCode SDK/app context:

- OpenCode/provider auth exposes credentials but does not provide a universal stable user/account key across providers for this use case.
- Because provider auth payloads can refresh while still representing the same real account, the plugin had to define its own stable identity layer above raw auth values.

### 1.4 Account Metadata Visibility

Intent:

Show enough account state for the user to understand what each stored account represents.

Chosen model and key decisions:

- visible metadata is intentionally narrow: identity cues plus current state
- the main exposed states are label/id, optional provider account id, active, and exhausted
- the UI is optimized for management decisions rather than detailed account inspection

Problems addressed and failure modes considered:

- users need enough information to distinguish accounts and understand current state
- the plugin should not grow into a full provider profile screen

Constraints and limitations introduced:

- the current model does not include richer metadata such as timestamps, usage history, or provider profile details
- account visibility is management-oriented, not audit-oriented

OpenCode SDK/app context:

- OpenCode TUI APIs are well-suited to compact local management dialogs, which favors concise state over a large profile-style screen.
- OpenCode/provider auth APIs are enough for management-oriented state, but they do not imply a rich provider-profile model for this plugin.

### 1.5 Account Removal

Intent:

Disconnect a stored account from the plugin without disturbing other retained accounts more than necessary.

Chosen model and key decisions:

- removal updates the local account list first, then applies auth side effects only when needed
- if the removed account was active and another account remains, auth is moved to the replacement account
- if no accounts remain, provider auth is removed through host APIs
- previous local state is restored if auth-side cleanup fails

Problems addressed and failure modes considered:

- removing accounts can desync stored account state and live provider auth state
- last-account removal is a different case from removing an inactive secondary account

Constraints and limitations introduced:

- removal is not a purely local action; it may require external auth mutation
- there is no true cross-system transaction, so rollback is snapshot-based

OpenCode SDK/app context:

- OpenCode exposes `auth.set(...)` and `auth.remove(...)`, but it does not expose a single atomic primitive for plugin account removal plus auth sync.
- Because plugin storage and host auth are separate layers, removal must account for partial failure between local mutation and host auth mutation.

### 1.6 Exhausted-Account Reset

Intent:

Return exhausted accounts to a usable state after the user decides they should be eligible again.

Chosen model and key decisions:

- exhaustion is stored directly and can be cleared selectively or globally
- reset is treated as a local eligibility change, not a provider-side recovery flow
- reset does not force an active-account change

Problems addressed and failure modes considered:

- exhausted accounts need to be excluded from automatic rotation while still remaining stored
- the user needs a way to re-enable accounts after waiting, manual recovery, or external quota reset

Constraints and limitations introduced:

- reset is trust-based; the plugin does not verify provider quota recovery before clearing exhaustion
- a reset account becomes rotation-eligible again whether or not provider capacity has actually recovered

OpenCode SDK/app context:

- OpenCode exposes request/auth behavior, not a built-in per-account exhaustion-and-recovery state model for multi-account providers.
- Since there is no shared quota-reset API in OpenCode for this feature, reset is a plugin-local policy action rather than a host-verified recovery flow.

## Chapter 2: Active Auth Management

This area covers choosing which stored account is currently active for a provider.

At a high level, the product should:

- expose the currently active account clearly
- allow the user to switch active account intentionally
- preserve a valid active account when possible after account changes
- clear provider auth when no stored account remains

This is the direct control area for which identity OpenCode should use next.

### 2.1 Current Active Account Visibility

Intent:

Make the provider's current live account obvious to the user.

Chosen model and key decisions:

- active account is stored directly as first-class provider state
- active visibility is shown in the local account-management UI
- a provider has either one active stored account or no active account

Problems addressed and failure modes considered:

- if active state existed only indirectly in host auth, the account UI would have no stable internal representation

Constraints and limitations introduced:

- plugin-visible active state must be continuously synced with host auth to stay trustworthy

OpenCode SDK/app context:

- OpenCode knows current live auth, but it does not provide an account-list-aware notion of "active account among many stored accounts" for this plugin.
- The local UI therefore needs explicit plugin-owned active state, while still remaining synced with host auth because host auth is what is actually live.

### 2.2 Manual Account Switching

Intent:

Provide deliberate user control over which stored account should become active next.

Chosen model and key decisions:

- switching uses host auth APIs rather than mutating local active state directly
- switch success is confirmed only after synced state reflects the expected account
- manual switch is defined as affecting subsequent requests, not in-flight requests

Problems addressed and failure modes considered:

- directly mutating local active state would create false success if live auth did not actually switch
- asynchronous auth reconciliation made immediate optimistic completion unsafe

Constraints and limitations introduced:

- switching is asynchronous and may need waiting/timeout handling
- the product deliberately does not try to rewire requests already in progress

OpenCode SDK/app context:

- OpenCode provides `auth.set(...)` as the supported live auth mutation path, so switching is modeled as a host auth write rather than a local-only state edit.
- OpenCode runtime hooks shape subsequent requests, not already-running requests, which is why switching is defined for the next request path rather than in-flight execution.

### 2.3 Active-Account Preservation During Account Changes

Intent:

Keep an intended active account stable when new accounts are connected or existing ones are updated.

Chosen model and key decisions:

- account connection offers two explicit modes: preserve current active account or activate the newly connected one
- preserve mode captures the new account and then restores the previously active account
- capture and activation are treated as separate behaviors

Problems addressed and failure modes considered:

- adding an account should not automatically disrupt the current live working identity in every case

Constraints and limitations introduced:

- preserve mode requires an additional auth transition after capture
- connect flow is more complex than a single login-equals-switch action

OpenCode SDK/app context:

- OpenCode provider OAuth flows naturally complete into a live authenticated state, which means a new connection tends to become current auth unless the plugin actively restores the previous one.
- TUI dialog APIs make explicit local branching flows possible, which enabled the product to separate "connect" from "activate".

### 2.4 Fallback Active-Account Selection After Removal

Intent:

Choose the next active identity when the currently active stored account is removed.

Chosen model and key decisions:

- active fallback is computed deterministically from the remaining ordered account list
- removal logic remaps active and exhausted references after account deletion
- auth is only resynced when removal actually changes the live active account

Problems addressed and failure modes considered:

- index-based storage shifts after removal and can corrupt active/exhausted state if not adjusted carefully
- removing the active account must not leave the provider in an invalid half-active state when another account exists

Constraints and limitations introduced:

- correctness depends on careful index remapping after every removal
- fallback behavior is ordering-based, not policy-rich or usage-aware

OpenCode SDK/app context:

- OpenCode does not provide a host-level rule for selecting a replacement active account from a plugin-managed account list after removal.
- Once the plugin chooses the fallback account, it must explicitly apply that decision through host auth APIs.

### 2.5 Provider Logout When No Account Remains

Intent:

Clear provider auth once the plugin no longer has any stored account to represent.

Chosen model and key decisions:

- last-account removal triggers provider logout through host auth APIs
- the plugin does not write live logout state directly into auth files
- empty local account state and cleared live auth are treated as the desired final state

Problems addressed and failure modes considered:

- direct file mutation would create a second low-level auth write path and invite drift

Constraints and limitations introduced:

- logout behavior depends on host/provider auth support being present and correct
- the plugin intentionally gives up lower-level direct control to preserve consistency

OpenCode SDK/app context:

- OpenCode exposes `auth.remove(...)` as the supported provider logout boundary.
- Because OpenCode owns live auth storage and downstream behavior, the plugin avoids direct `auth.json` mutation for logout and delegates to host APIs instead.

## Chapter 3: Automatic Continuity Under Rate Limits

This area covers the product behavior during provider exhaustion.

At a high level, the product should:

- detect when a request failed because of rate limiting
- mark the responsible account as exhausted
- select another usable stored account when one exists
- move future requests onto that next account
- fail clearly when no usable account remains

This is the continuity feature that turns stored accounts into practical fallback capacity.

### 3.1 Rate-Limit Detection

Intent:

Identify when a failed request should be treated as provider exhaustion rather than a generic error.

Chosen model and key decisions:

- rate-limit detection is based on retry/error message classification
- the classifier intentionally matches several common rate/quota phrasings instead of a single exact string

Problems addressed and failure modes considered:

- there is no strong typed shared rate-limit signal available for the plugin's retry workflow

Constraints and limitations introduced:

- detection is rule-based and depends on message wording
- provider behavior is approximated rather than perfectly normalized

OpenCode SDK/app context:

- OpenCode server plugins can observe retry/failure events, but the available signal for this workflow is not a rich shared typed rate-limit classification API.
- The plugin therefore derives rate-limit meaning from the event data OpenCode does expose.

### 3.2 Exhausted-Account Marking

Intent:

Record that a specific stored account should no longer be used for automatic continuation.

Chosen model and key decisions:

- exhaustion is persisted per account in storage
- exhausted accounts remain connected and visible; they are only excluded from automatic fallback selection
- exhaustion is recorded only after retry handling concludes the failure was rate-limit-related

Problems addressed and failure modes considered:

- the product must distinguish between "known account" and "eligible continuation account"

Constraints and limitations introduced:

- exhausted accounts may still be manually selected or remain the visible active account until another flow changes auth
- exhaustion is a local runtime state, not a provider-side state change

OpenCode SDK/app context:

- OpenCode owns current auth and retries, but it does not natively model "connected but excluded from automatic fallback" for a provider account list.
- Exhaustion therefore becomes plugin-owned persisted policy state layered on top of host auth.

### 3.3 Next-Usable-Account Selection

Intent:

Determine which remaining stored account is eligible to take over after exhaustion.

Chosen model and key decisions:

- candidate selection uses a simple circular next-account scan relative to the current active position
- exhausted accounts are skipped
- if there is no active account, selection scans from the start of the stored order

Problems addressed and failure modes considered:

- the plugin needs deterministic fallback behavior across more than two stored accounts

Constraints and limitations introduced:

- stored order affects rotation behavior
- there is no scoring, balancing, quota-awareness, or provider-specific optimization in the selection policy

OpenCode SDK/app context:

- OpenCode exposes request hooks and auth mutation, but not a built-in multi-account rotation scheduler.
- Candidate selection therefore has to be cheap, deterministic, and plugin-owned so it can run cleanly within runtime hook boundaries.

### 3.4 Automatic Account Rotation

Intent:

Move runtime auth onto another stored account so work can continue with minimal user intervention.

Chosen model and key decisions:

- retry handling only marks exhaustion and flags that rotation is needed
- the actual auth switch happens later during request setup, not directly inside retry event handling
- after auth switching, the plugin waits for synced state before considering the rotation complete

Problems addressed and failure modes considered:

- retry events, auth changes, and state reconciliation are asynchronous and were unsafe to collapse into one immediate action
- auth writes could complete before local state reflected the new active account

Constraints and limitations introduced:

- rotation is staged rather than instantaneous
- depending on provider-side request auth behavior, one wasted retry may still occur before new credentials are fully used

OpenCode SDK/app context:

- OpenCode lifecycle phases are split: retry/failure is seen in the event stream, while outgoing request behavior is shaped in `chat.params`.
- Because `auth.set(...)` is a host mutation boundary and request auth may be provider/runtime cached, rotation cannot be assumed to take effect immediately at the moment the retry event is observed.

### 3.5 Terminal All-Accounts-Exhausted Failure Handling

Intent:

End the flow clearly when there is no remaining usable account to rotate into.

Chosen model and key decisions:

- terminal exhaustion is surfaced as a clear failure condition
- the plugin stops the flow instead of silently continuing exhausted retries
- user-facing feedback is emitted when this terminal state is reached

Problems addressed and failure modes considered:

- without explicit terminal handling, fully exhausted account lists could loop or fail in unclear ways

Constraints and limitations introduced:

- the product stops once stored fallback capacity is exhausted; there is no deeper recovery layer beyond account rotation

OpenCode SDK/app context:

- OpenCode does not know the plugin's multi-account capacity, so it cannot tell when plugin-managed fallback options are exhausted.
- The plugin must therefore convert account-list exhaustion into a clear terminal condition instead of relying on generic host retry behavior.

## Chapter 4: State Synchronization And Consistency

This area covers keeping local plugin state aligned with OpenCode auth state.

At a high level, the product should:

- treat OpenCode auth as the integration point
- sync auth changes back into plugin-owned storage
- keep active-account state and stored-account state aligned
- avoid direct local assumptions that bypass live auth state
- make account-changing flows wait for synced state before considering them complete

This is the consistency layer that keeps UI actions, server behavior, and auth state from drifting apart.

### 4.1 Auth-State Ingestion

Intent:

Read the host application's provider auth state as the plugin's external source of truth.

Chosen model and key decisions:

- host auth is read from `auth.json`
- file reads are cached by mtime to avoid unnecessary repeated parsing
- only valid OAuth-shaped auth entries are accepted into plugin processing

Problems addressed and failure modes considered:

- external auth changes need to be read frequently enough to keep the plugin aligned without turning every read into heavy file parsing

Constraints and limitations introduced:

- the ingestion path depends on file mtime behavior and valid OAuth auth structure
- non-OAuth auth entries are intentionally ignored in the current product scope

OpenCode SDK/app context:

- OpenCode stores live auth in local state and exposes auth mutation APIs, but the plugin still needs a read-side integration point for observing host auth.
- `auth.json` is used as that observable point because OpenCode does not provide a dedicated plugin-facing account-list state feed.

### 4.2 Live Auth Change Detection

Intent:

Notice when provider auth has changed and react to that change.

Chosen model and key decisions:

- change detection is watcher-based rather than purely request-triggered
- watcher setup includes debounce behavior and retry behavior for startup/watch errors
- startup scan and live change handling use the same downstream reconciliation model

Problems addressed and failure modes considered:

- filesystem watching is noisy and startup timing can be unreliable
- auth can change outside direct plugin UI actions

Constraints and limitations introduced:

- change handling is eventually consistent rather than instantaneous
- some flows must wait for watcher-driven sync instead of assuming immediate state change

OpenCode SDK/app context:

- OpenCode auth can change outside this plugin's own UI flows, so request-triggered sync alone is insufficient.
- In the absence of a first-class auth-change callback tailored to this use case, watcher-based observation becomes the practical host integration strategy.

### 4.3 Storage Reconciliation

Intent:

Translate live auth state into the plugin's own persistent account model.

Chosen model and key decisions:

- reconciliation is watcher-owned and centralized
- reconciliation performs account upsert, active-state alignment, auth disappearance handling, and runtime timeline updates together
- both startup and ongoing changes follow this same reconciliation path

Problems addressed and failure modes considered:

- multiple product flows needed the same auth-to-storage translation rules
- duplicating reconciliation logic across features would create drift and contradictory state transitions

Constraints and limitations introduced:

- feature flows are expected to respect reconciliation as the owner of auth-derived truth
- direct shortcuts that mutate auth-derived local state are intentionally avoided

OpenCode SDK/app context:

- OpenCode gives lower-level auth state and mutation APIs, but not plugin-specific account-list sync rules.
- Because TUI and server runtimes are separate plugin sides, one centralized sync model is needed to keep their view of host auth consistent.

### 4.4 Active-State Confirmation After Mutations

Intent:

Wait until account-changing operations are reflected back into synced state before treating them as complete.

Chosen model and key decisions:

- completion is confirmed by waiting for the expected account fingerprint to appear as the synced active account
- the same reconciliation-wait pattern is used in both server-side and TUI-side flows

Problems addressed and failure modes considered:

- `auth.set(...)` returning was not sufficient proof that storage and runtime state had synced up
- this caused false-positive success for switch and rotation flows

Constraints and limitations introduced:

- mutation completion is timeout-based rather than guaranteed as one atomic step
- a flow can partially succeed externally while still being reported as locally unconfirmed

OpenCode SDK/app context:

- OpenCode `auth.set(...)` mutates host auth, but plugin-visible storage state converges indirectly through reconciliation rather than synchronously inside that API call.
- This is why API completion is treated as necessary but not sufficient proof of final success.

### 4.5 Auth Removal Reconciliation

Intent:

Handle the disappearance of provider auth without leaving stale active-account state behind.

Chosen model and key decisions:

- provider absence in host auth is treated as a meaningful reconciliation event
- when auth disappears, active state is cleared and runtime auth interval state is closed

Problems addressed and failure modes considered:

- without explicit absence handling, the plugin could retain stale active/runtime references after logout or auth deletion

Constraints and limitations introduced:

- stored historical accounts may remain in the account list even when live auth is gone; what is cleared is active live auth state, not necessarily stored account history

OpenCode SDK/app context:

- OpenCode host auth disappearance is observable state, but it is not automatically equivalent to deleting plugin-stored portfolio entries.
- The plugin therefore treats live auth removal as a reconciliation event that clears active live state while leaving stored account history under plugin control.

### 4.6 Drift Prevention Between UI State And Runtime State

Intent:

Reduce mismatch between what the user sees, what the plugin stores, and what runtime auth is actually using.

Chosen model and key decisions:

- UI actions do not assume final success until shared state reflects it
- shared storage plus auth reconciliation is the consistency mechanism between local UI and server runtime
- the plugin avoids directly editing auth files for live auth mutations

Problems addressed and failure modes considered:

- there were real divergence cases between live auth state, file state, watcher-derived storage, and local assumptions

Constraints and limitations introduced:

- the product accepts more waiting and indirection in exchange for consistency
- some actions intentionally feel less immediate because sync is verified instead of assumed

OpenCode SDK/app context:

- OpenCode TUI, server hooks, SDK auth APIs, and file-backed host auth sit at different layers and do not form one synchronous shared state container.
- That layered architecture is the main reason the plugin uses shared storage plus reconciliation instead of trusting immediate local assumptions.

## Chapter 5: Provider Adaptation

This area covers how the product supports different providers without owning provider-specific auth logic itself.

At a high level, the product should:

- rely on provider auth integrations for request-time credentials
- extract a stable account identity for each supported provider
- deduplicate accounts using that stable identity
- keep provider-specific logic narrow and explicit
- allow limited fallback behavior in controlled environments when needed

This is the compatibility layer that makes the rest of the product reusable across providers.

### 5.1 Provider Identity Extraction

Intent:

Derive a stable account identity from provider auth data.

Chosen model and key decisions:

- identity extraction is isolated behind a provider registry
- provider-specific extraction logic can be registered directly
- identity includes a stable behavioral `id` and optional user-facing label

Problems addressed and failure modes considered:

- providers do not expose stable account identity in one universal format

Constraints and limitations introduced:

- strong support requires provider-specific extraction where generic extraction is not reliable enough

OpenCode SDK/app context:

- OpenCode/provider auth differs across providers, and the platform does not supply one universal stable account identity model for this plugin's use case.
- The provider registry design follows from OpenCode's provider-oriented architecture and the need to adapt identity logic per provider.

### 5.2 Stable Account Identification

Intent:

Represent one real provider account with a stable identity inside the plugin.

Chosen model and key decisions:

- stable account identity is separated from display label
- behavioral identity is converted into a fingerprint used across storage and runtime attribution

Problems addressed and failure modes considered:

- labels are useful for UI but not stable enough for system behavior
- raw credential values are too unstable for long-lived identity

Constraints and limitations introduced:

- if provider identity extraction is weak or wrong, deduplication and attribution quality degrade with it

OpenCode SDK/app context:

- OpenCode auth exposes credentials and some metadata, but it does not provide a cross-provider stable managed-account key suitable for account storage and historical attribution.
- The plugin therefore had to separate display label from behavioral identity and normalize that identity into its own stable fingerprint.

### 5.3 Provider-Specific Account Deduplication

Intent:

Apply provider-aware identity rules so repeated auth observations map to the same logical account.

Chosen model and key decisions:

- OpenAI support uses strict extraction from `chatgpt_account_user_id`
- generic token-as-id extraction exists only as a separately enabled fallback path
- production-grade behavior prefers narrow strictness over broad loose compatibility

Problems addressed and failure modes considered:

- generic token-based identity is too unstable across refresh for strong production deduplication

Constraints and limitations introduced:

- provider support breadth is narrower by default
- better provider behavior requires dedicated extractor work rather than leaning on generic fallback

OpenCode SDK/app context:

- OpenCode's extensibility makes broad provider support possible, but it does not guarantee strong identity quality for generic providers.
- This pushed the plugin toward preferring narrow, high-confidence provider-specific extraction over broad, weak default behavior.

### 5.4 Provider Auth Handoff Integration

Intent:

Rely on upstream provider auth integrations to supply and consume live credentials at request time.

Chosen model and key decisions:

- this plugin manages which credentials are active, but not the final request-time auth resolution implementation
- live auth writes go through host auth APIs
- request-time correctness assumes provider auth integrations re-read live auth when requests happen

Problems addressed and failure modes considered:

- combining account-list management and provider auth resolution in one layer would expand scope and duplicate provider-specific logic

Constraints and limitations introduced:

- runtime behavior quality depends on upstream provider auth behavior
- if request auth is cached too aggressively outside this plugin, rotation can lag behind the active-account decision

OpenCode SDK/app context:

- OpenCode/provider integrations remain the layer that actually resolves credentials at request time.
- This plugin therefore manages which account should be active, but it depends on upstream OpenCode/provider auth behavior to honor that active selection when requests are sent.

### 5.5 Controlled Fallback Behavior For Less Specialized Providers

Intent:

Provide limited compatibility behavior for providers that do not yet have a strong dedicated identity strategy.

Chosen model and key decisions:

- a generic fallback extractor exists for controlled environments
- the fallback is explicit and lower-confidence by design, not the main supported production mode

Problems addressed and failure modes considered:

- some development and low-specialization scenarios need a temporary compatibility path before a strong extractor exists

Constraints and limitations introduced:

- fallback identity may treat the same real account as new after token rotation
- fallback support is intentionally weaker and should not be treated as equivalent to dedicated provider support

OpenCode SDK/app context:

- OpenCode's plugin model allows generic compatibility behavior, but the platform does not make generic identity extraction high-confidence by itself.
- The fallback path exists because extensibility is useful in controlled environments, while production defaults remain stricter because upstream guarantees are limited.

## Chapter 6: Safe Retry Attribution

This area covers assigning retry consequences to the account that actually caused the failed request.

At a high level, the product should:

- attribute rate-limit failures to the account active when the request started
- preserve attribution correctness even if auth changes before retry handling completes
- resolve historical account identity safely against current stored state
- skip exhaustion when attribution is no longer trustworthy

This is the safety layer that prevents incorrect exhaustion and incorrect rotation decisions.

### 6.1 Request-Time Account Attribution

Intent:

Tie each request to the account that was active when the request began.

Chosen model and key decisions:

- request context tracks `sessionID`, `providerID`, and request `startedAt`
- request start time is the anchor used for later exhaustion attribution

Problems addressed and failure modes considered:

- session-level current-account guessing failed once auth could rotate between request start and retry handling

Constraints and limitations introduced:

- attribution quality depends on request start being captured consistently and early enough

OpenCode SDK/app context:

- OpenCode exposes separate lifecycle points for request setup and later retry/failure observation.
- That lifecycle split is the reason request-time context must be captured early, before auth may change for later retries.

### 6.2 Auth Timeline Tracking

Intent:

Maintain enough auth-history context to reason about account changes over time.

Chosen model and key decisions:

- runtime auth history is modeled as per-provider intervals with `startAt`, `endAt`, account identity, and fingerprint
- the timeline is in-memory only
- watcher reconciliation owns opening and closing auth intervals

Problems addressed and failure modes considered:

- current active state alone cannot answer which account was active at an earlier request start time

Constraints and limitations introduced:

- historical attribution only exists for the lifetime of the running process
- the model favors runtime correctness over long-term historical replay

OpenCode SDK/app context:

- OpenCode does not provide a built-in historical auth-interval model for plugin-level retry attribution.
- Because host auth changes are observed over time and current auth alone is insufficient, the plugin maintains its own runtime auth timeline.

### 6.3 Historical Account Resolution

Intent:

Map a past request's account identity back onto the current stored account model.

Chosen model and key decisions:

- historical account references resolve back to current storage by fingerprint
- current storage position is intentionally not used as the historical join key

Problems addressed and failure modes considered:

- account removal and compaction can change indices, making index-based historical blame unsafe

Constraints and limitations introduced:

- if the historical fingerprint no longer maps to current storage, the plugin cannot safely continue attribution

OpenCode SDK/app context:

- OpenCode host auth history and plugin account storage are different layers, and local account ordering can change over time.
- That makes current array position an unsafe historical join key, which is why stable fingerprint-based resolution was chosen instead.

### 6.4 Retry-To-Account Correlation

Intent:

Decide which stored account should absorb the consequences of a retry failure.

Chosen model and key decisions:

- retry handling is split into two logical phases:
  - identify which account caused the failed request
  - flag later rotation for the next request setup phase
- correlation uses request context plus auth timeline, not whichever account is active when the retry event arrives

Problems addressed and failure modes considered:

- current-state blame was too coarse once auth changes and retries overlapped

Constraints and limitations introduced:

- the correlation model is more complex than naive current-active blame, but that complexity is accepted to avoid exhausting the wrong account

OpenCode SDK/app context:

- OpenCode provides retry information in events and request mutation in `chat.params`, but not one atomic primitive that both identifies responsibility and rotates auth in a single step.
- The plugin's two-phase correlation-and-rotation design follows directly from those host lifecycle boundaries.

### 6.5 Safe Skip Behavior When Attribution Is No Longer Trustworthy

Intent:

Decline to mark exhaustion when the plugin can no longer safely prove which account was responsible.

Chosen model and key decisions:

- exhaustion is skipped if no auth interval matches the request time
- exhaustion is skipped if the historical account no longer maps back to current storage
- safe skip is treated as an intentional product behavior, not just an error fallback

Problems addressed and failure modes considered:

- forcing an exhaustion decision under uncertain history would corrupt account state and future rotation behavior

Constraints and limitations introduced:

- some ambiguous retry failures will not trigger automatic exhaustion
- the product deliberately prefers under-automation to incorrect state mutation

OpenCode SDK/app context:

- OpenCode's async lifecycle and partial historical visibility mean the plugin cannot always prove which current stored account corresponds to a past failing request.
- Safe skip behavior exists because the host/runtime information model can become insufficient after later state changes, and forcing a decision would be less correct than declining to mutate state.

## Core Product Rules

- One provider may have many stored accounts.
- One provider has at most one active account at a time.
- Exhaustion is tracked per stored account, not just per provider.
- Auth changes must be reflected back into stored state before flows are treated as complete.
- Rotation decisions must be attributed to the account active when the failed request started.
- The product should prefer safe, explicit failure over silent auth drift.

## Primary User Outcomes

- Users can keep multiple provider accounts connected.
- Users can switch between accounts without redoing setup each time.
- Users can recover from per-account rate limits without manual re-login.
- Users can inspect and maintain account state from a local management UI.
- OpenCode auth state and plugin state remain aligned enough for predictable behavior.

## Non-Goals

- replacing provider auth plugins
- implementing provider-specific login UX beyond integration points already exposed by OpenCode
- forecasting usage windows or remaining quota
- hiding all provider/runtime inconsistencies behind heavy compatibility code

## Related Docs

- `README.md`
- `specs/decisions/001-plugin-runtime-split.md`
- `specs/backlog/README.md`
- `specs/findings/opencode-retry-mechanism.md`
- `specs/findings/openai-api-rate-limitting.md`
