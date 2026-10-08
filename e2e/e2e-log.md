# E2E evidence: CPA-005 (#2) and CPA-008 (#4) against the enforcing backend

Run date: 2026-10-08, 20:12–20:23 UTC.

## What was tested

| Part | Version |
|---|---|
| Backend | `dhruvkelawala/CLIProxyAPI` `sumo/main` at **4033d211b98d1de49872687ddb4d3d0a9bbcc806** (merge of PR #8, CPA-003; includes #6 f25648a8 and #7 ac920227). Worktree at `/tmp/cpa-ship/e2e/backend`. Built for linux/arm64 with `CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build ./cmd/server`. Also built for darwin at `/tmp/cpa-ship/e2e/cliproxyapi`. |
| Frontend | `origin/sumo/main` at **73cddfdc62b7a1a2c1d91db2a0f94264c94c430c** (PR #9 merge; includes #7 c8d35cb). Worktree at `/tmp/cpa-ship/e2e/frontend`. Vite dev server on 127.0.0.1:18905. |
| Browser | playwright-core with the cached chromium_headless_shell-1243, 1280×900. Dark and light themes captured at every step via `emulateMedia` (the app's theme is `auto`). |

`GET /v8/management/client-profiles/capabilities` returned `enforcement: true`, `strict_requests: "enforced"` and `session_behavior: "fresh_session_required"`.

## Sandbox (synthetic only)

- The live gateway (PID 76515, `~/.local/share/cliproxyapi/...`, port 8317) was not touched. Every sandbox port was in 18900–18909.
- Docker container `cpa-e2e-strict` (colima). Its files were copied in with `docker cp` from `/tmp/cpa-ship/e2e/run`, because colima does not share /tmp. Only `127.0.0.1` ports are published: 18900 for the gateway and 18901, 18902 and 18909 for the fakes.
- **Why a container:** Claude OAuth files have no `base_url` override, so requests always go to `https://api.anthropic.com`, and Go on darwin ignores `SSL_CERT_FILE`. On Linux the binary trusts a synthetic CA (`SSL_CERT_FILE`). Each synthetic auth file sets `proxy_url` to its own fake upstream:
  - `fakeupstream` (Go, `harness/main.go`) acts as an HTTP CONNECT proxy and terminates TLS for `api.anthropic.com` with a leaf signed by the synthetic CA.
  - It logs every request to `upstream-<name>.jsonl`, with the credential suffix shown, and answers with a Messages response whose text is `served-by-<name>`.
  - It refuses any other CONNECT host.
  - `requests.proxy-url` points at a third fake, CATCHALL. It recorded **0** requests in both runs, so no upstream traffic left the sandbox.
- **Upstream A** is `claude-account-a.json` (account-a@synthetic.invalid) → :18901. **Upstream B** is `claude-account-b.json` → :18902. The tokens are `sk-ant-oat01-synthetic-account-{a,b}-not-real`, with `expired` set to 2030 so they never refresh, and a synthetic `account_uuid` so the OAuth profile fetch is skipped.
- Synthetic keys:
  - Management key: `e2e-synthetic-mgmt-key-not-real`.
  - Client keys: `t3-e2e-synthetic-client-key-01` ("T3 key") and `lg-e2e-synthetic-legacy-key-99` ("legacy key").
  - `oauth.providers.aistudio.ws-auth: true`, as the contract requires for key association.
- Each proof run starts from a fresh container: `harness/restart-backend.sh`.
- Requests go to `POST /v1/messages` with model `claude-sonnet-4-5-20250929`, via `harness/send.py`. Counts are per-upstream deltas of the fake logs, cross-checked against the `served-by-X` text in each response.

## CPA-005: Client routes, per-client subscription rules

Driver: `harness/e2e-005.mjs`. Transcripts: `driver-005.log` and `requests-005.log`. Raw logs: `logs-005/` (`upstream-*.jsonl`, `backend.out`, `config-after.yaml`).

| # | Step (all through the dashboard UI) | Result |
|---|---|---|
| 0 | Open Client routes. Is the "Rules are saved, not enforced yet" banner shown? | **Hidden** at the start and at the end. **PASS** (`005-01`) |
| 1 | New profile "MacBook · T3 Claude" → Create profile | Created. Both rules start Automatic. (`005-02`, `005-03`) |
| 2 | Profile and keys → Client keys → link `t3******01` with label "T3 desktop key" | Linked. Raw key values are absent from the DOM (`page.content()` checked). **PASS** (`005-04`, `005-05`) |
| – | 6 requests with the T3 key before any rule | A 3 / B 3. The pool is used. |
| 3 | Claude cell → both accounts show "Not prepared for strict routing" → **Prepare for strict routing** on A and B | `POST /client-profile-accounts/enroll`. The accounts become `available` with `account_ref` UUIDs. This is the enrollment step the contract requires. (`005-06`, `005-07`) |
| 4 | Pick "Only account-a@synthetic.invalid" → Save rule | Persisted as `claude:{mode:only, account_ref:<A>}` at revision 2. `target_states.claude=available`. (`005-08`, `005-09`) |
| 4b | Reload the page, then reconnect (log in again; remember-password was off) | The cell still reads "Only account-a@synthetic.invalid · Available". **PASS** (`005-10`) |
| 5 | 12 requests with the T3 key | **A 12 / B 0**, all HTTP 200. **PASS** |
| 5b | 4 streaming requests with the T3 key | **A 4 / B 0**. **PASS** |
| 5c | Canary: 4 requests with the legacy key (no profile) | A 2 / B 2, so B was enabled and in the pool. |
| 6 | Accounts page: the A card shows an "ONLY FOR MacBook · T3 Claude" chip. Toggle A **off**. | The account reads `target_unavailable`. The matrix shows "Only account-a… **will fail** · Disabled or unavailable", and the sheet shows a red warning. (`005-11` to `005-14`) |
| 6b | 6 requests with the T3 key while A is disabled | **6 × HTTP 503 `target_unavailable`. A 0 / B 0.** No fallback to B. **PASS** |
| 6c | 2 streaming requests, same state | 2 × 503. A 0 / B 0. **PASS** |
| 6d | Canary: 4 requests with the legacy key while A is disabled | B 4, so B is up and was still never used for the strict client. |
| 7 | Claude cell → Automatic → Save rule (A still disabled) | Saved. (`005-15`, `005-16`) |
| 7b | 6 requests with the T3 key | **B 6** (the pool, with A excluded). **PASS** |
| 8 | Accounts page: toggle A back **on**. Then 12 requests with the T3 key. | **A 6 / B 6**. Automatic uses the whole pool. **PASS** (`005-17`, `005-18`) |

**Totals for the CPA-005 run** (upstream logs): A 27, B 21, CATCHALL 0. These match the Accounts cards' success counters.

## CPA-008: Shared routing band

Driver: `harness/e2e-008.mjs`. Transcripts: `driver-008.log` and `requests-008.log`. Raw logs: `logs-008/`.

**Setup (UI):**
- "MacBook · T3 Claude" uses the T3 key with Claude set to **Only B**. A and B were enrolled with Prepare for strict routing.
- "Mini · Automatic" uses the legacy key with Claude set to **Automatic**.

| # | Band action (Client routes → Shared pool → Edit) | Automatic profile (legacy key) | Only-B profile (T3 key) | Verdict |
|---|---|---|---|---|
| 1 | Rotate evenly (initial `round-robin`) | 12 → **A 6 / B 6** | 6 → **B 6 / A 0** | PASS (`008-01`) |
| 2 | Weighted split. In Priorities & weights, set A weight 3 and B weight 1, then Save accounts (`PATCH /credentials/fields`; the auth files now hold weight 3 and 1). Then Save shared settings: `routing.strategy: round-robin -> weighted-round-robin`. | 20 → **A 15 / B 5** (exactly 3:1, matching the band's illustrative 75/25) | 6 → **B 6 / A 0** | PASS (`008-02` to `008-05`) |
| 3 | Priorities: B priority 5, A 0. Save accounts. | 8 → **B 8 / A 0** (only B's tier is used) | 4 → **B 4** | PASS (`008-06`) |
| – | B priority cleared. The blank field writes 0, which is the documented "restore default". | | | |
| 4 | Concentrate on one: `weighted-round-robin -> fill-first` | 8 → **A 8 / B 0** (lowest internal ID, `claude-account-a.json`) | 6 → **B 6 / A 0**, even though A is the pool favourite | PASS (`008-07`) |
| 5 | fill-first, with B toggled off on the Accounts page | 4 → A 4 | 6 → **6 × HTTP 503 `target_unavailable`, A 0 / B 0** | PASS (`008-08`) |
| 6 | Rotate evenly with "Keep conversations on one account" on, for 1h. Save. Then 9 requests across conv-one, conv-two and conv-three (`metadata.user_id`). | conv-one AAA, conv-two BBB, conv-three AAA (bound) | – | PASS (`008-09`) |
| 6b | Control: no save, reversed order (conv-two first) | conv-two **BB**, conv-one **AA**, conv-three AA. Bindings hold. | – | PASS |
| 6c | Change the TTL from 1h to 2h. The scope line beside Save reads "…Saving resets current conversation bindings." Save. Same reversed order. | conv-two **AA** (was B), conv-one **BB** (was A), conv-three AA. Backend log: `session-affinity: cache miss, new binding` for all three right after the reload. The bindings were reset as the band says. | – | PASS (`008-10`) |
| 6d | Only-B profile with sessions conv-one and conv-two | – | 4 → **B 4** | PASS |
| – | Were profiles changed by band saves? | | `MacBook · T3 Claude` stays at revision 2, `claude:{only, B}`, through every band and account save. | PASS |

**Totals for the CPA-008 run:** A 47, B 52, CATCHALL 0. The final persisted config has `routing.strategy: round-robin`, `session-affinity: true` and `session-affinity-ttl: "2h"`.

Two backend log excerpts back this up (see `logs-008/backend.out`):
- The `config changes detected: routing.strategy: … -> …` lines for each strategy save.
- The `session-affinity: cache hit` lines before the TTL save, followed by `cache miss, new binding` after it.

## Strict error envelope probe

`harness/probe-envelopes.sh` output is in `strict-error-envelopes.txt`. Setup: Only A, with A disabled through `PATCH /v8/management/credentials/status`.

| Route | HTTP | Body |
|---|---|---|
| POST /v1/messages | 503 | `{"type":"error","error":{"type":"api_error","message":"target_unavailable"}}` |
| POST /v1/messages/count_tokens | 503 | `{"type":"error","error":{"type":"api_error","message":"target_unavailable"}}` |
| POST /v1/chat/completions | 503 | `{"error":{"code":"target_unavailable","field":"claude"}}` |
| POST /v1/responses | 503 | `{"error":{"code":"target_unavailable","field":"claude"}}` |

There was zero upstream traffic in every case.

## Findings

1. **Backend, contract deviation (not fixed, as instructed).** `plans/client-profile-api.md` says business policy failures return 503 with `{"error":{"code":"machine_code","field":"optional_field"}}`. On Claude-format routes the gateway instead wraps the code in the Anthropic error envelope: `message:"target_unavailable"` replaces `code`, and `field` is lost. Status and strictness are correct. The OpenAI-format routes match the contract.
   - Repro: run `harness/probe-envelopes.sh` against the sandbox. By hand, with a profile whose Claude rule is Only X and X disabled:

     ```
     curl -H 'x-api-key: <profile key>' -H 'anthropic-version: 2023-06-01' -H 'content-type: application/json' \
       localhost:<port>/v1/messages -d '{"model":"claude-sonnet-4-5-20250929","max_tokens":8,"messages":[{"role":"user","content":"x"}]}'
     ```

     Compare with `/v1/chat/completions`.
2. **Backend observation.** Session-affinity bindings are keyed by session ID alone, not by profile. An Only-B request that reused a session ID bound to A by an Automatic client logged `cache hit but auth unavailable, reselected` and rebound that shared entry to B (`logs-008/backend.out`, around 20:23:17). Strictness still held. The only effect is on an Automatic client that shares the same session ID, which is unlikely with real per-conversation IDs.
3. **Backend, cosmetic.** The config-reload diff logger does not list `routing.session-affinity` or `session-affinity-ttl` changes, though the reload and the rebinding do happen.
4. **Frontend:** no functional bug found in the CPA-005/CPA-008 flows. Observations, not fixed:
   - Light theme: the long-standing fixed `.top-gradient-blur` (141px, backdrop blur) sits over the page title and the "New profile" button at scroll position 0, so they look washed out (`observation-light-top-gradient-blur.png`). It predates these features; the dark theme hides it since #8.
   - The Accounts page probes `/v8/management/config/oauth/{excluded-models,model-alias}` and gets 404 when those settings are unset. `getConfigValue` treats this as a default, but the browser console logs the 404s.
   - After "Prepare for strict routing", the editor pre-selects the newly prepared account as an unsaved draft.
   - Masked key labels show only the first and last 2 characters (`t3******01`), so two unnamed keys with the same ends would look identical in the picker.

## Not proven or limitations

- Codex rules: the sandbox has no Codex accounts, so Codex cells correctly showed "Automatic · will fail · No eligible account". Codex strictness was not exercised.
- Mobile and 360/728 widths were not re-shot here; only 1280 in dark and light.
- The backend ran in a Linux container rather than natively on macOS, from the same commit. The frontend was the dev server, not the single-file build.
- `bunx bun@1.3.14` fails on this host (bun 1.4.2: "could not determine executable to run for package bun"), so install and dev used `npx -y bun@1.3.14` at the same pinned version.
- Session-affinity tests used `metadata.user_id` as the session key. Other session channels (headers, Responses conversation IDs, WebSockets) were not exercised.
