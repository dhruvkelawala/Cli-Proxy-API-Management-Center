# CPA-005: Let the dashboard choose and enforce a subscription for each client

- **Status:** DONE — merged in #9; end-to-end proof against the enforcing backend (CLIProxyAPI `4033d21`) recorded on issue #2.
- **Tracking issue:** https://github.com/dhruvkelawala/CLIProxyAPI/issues/5
- **Issue:** https://github.com/dhruvkelawala/Cli-Proxy-API-Management-Center/issues/2
- **Priority:** P1
- **Effort:** 1–2 days (rough)
- **Risk:** Medium
- **Planned at:** 6abace9ffb83a9ac349464ded04bb4e7f7cb309e (v1.25.4), 2026-10-07
- **Branch:** create a topic branch from `sumo/main`; retain existing Go module/package identity.
- **Depends on:** [CPA-002](https://github.com/dhruvkelawala/CLIProxyAPI/issues/2), [CPA-003](https://github.com/dhruvkelawala/CLIProxyAPI/issues/3), [CPA-004](https://github.com/dhruvkelawala/Cli-Proxy-API-Management-Center/issues/1)

Read this ticket and AGENTS.md before editing. Drift check: `git diff --stat 6abace9ffb83a9ac349464ded04bb4e7f7cb309e..HEAD -- src/features/clientProfiles/ src/services/api/clientProfiles.ts src/types/ src/router/MainRoutes.tsx src/components/layout/MainLayout.tsx src/features/authFiles/components/ src/i18n/locales/ tests/clientProfile plans/`. If relevant source changed, re-read the cited behavior before following the steps. Keep changes focused; update plans/README.md when finished.

## Outcome
Provide a real **Use only this subscription** control. Saving it persists a server-enforced policy; it is not a cosmetic selection, a bulk checkbox, or a client-only preference.

A Client routes page lets an administrator create/edit named provider-specific client profiles using Automatic or Only account A/B. It explains the scope and error behavior. A read-only preview distinguishes configured target, eligible pool and unknown actual account.

## Context and current state
Client API keys presently grant gateway access without account binding. CPA-002/003 add the contract and enforcement; this UI must consume that documented contract, not guess paths or serialize raw backend fields in components. The deployment uses one Mini gateway and a MacBook tunnel. Policies apply to requests using a client profile; a machine key can cover several applications/sessions. Existing T3 provider instances can use dedicated profile credentials without T3 source changes.

`src/services/api/client.ts` owns bearer auth/error/events; `src/services/api/authFiles.ts` exemplifies normalized endpoint modules. Routes use `MainRoutes.tsx`, ProtectedRoute and MainLayout. Feature code belongs under `src/features/`. All new strings and accessible labels need en, zh-CN, zh-TW and ru translations.

## Steps
1. Add a typed domain API module matching `plans/client-profile-api.md` from CPA-002. Probe feature support; an older backend/404 shows Unsupported and disables writes rather than inventing local policies.
2. Build a clear Use only this subscription action and list/editor controls for client label, provider, profile mode and durable account reference. Show disabled/missing targets with an explanation. Never display raw client/OAuth credentials in ordinary list or preview views.
3. Show the policy's exact scope: all matching provider requests using this profile. Keep Codex policy independent. Defer Prefer/fallback until its backend semantics have a separate ticket.
4. Preview Automatic as an eligible pool and Only as a configured target. A disabled target means the profile will fail; never silently switch it. Do not say Served by without reliable actual attribution. Registry models are availability advertisements, not inference proof.
5. Add safe connection context: local Mini access versus MacBook localhost tunnel into the same gateway. Topology is configured information, not proof that a remote machine/tunnel is currently online. Unknown/stale health stays labeled.
6. Preserve mutation recovery, logout/connection cache isolation and unsaved changes. Explain whether edits require a new session/reconnection according to CPA-002/003.
7. Link accounts to the profiles that reference them using the safe API projection.

## Verification and done criteria
- [x] `bunx bun@1.3.14 test tests/clientProfilesApi.test.ts tests/clientProfilesState.test.ts tests/clientProfilesRendering.test.ts` exits 0 with new tests.
- [x] Synthetic cases cover supported/unsupported backend, Automatic, Only, disabled/deleted target, unknown quota, failed save and stale completion after connection switch.
- [x] `bunx bun@1.3.14 run verify` exits 0.
- [ ] **Pending CPA-003.** End-to-end browser/API proof: choose subscription B for a client while A stays enabled; subsequent requests under that client reach only B. Disable/exhaust B in the fixture and assert a clear failure with zero A traffic.
- [x] Selection is persisted on the proxy (contract writes; verified against the mock, not a real proxy), survives page refresh/reconnect, and does not require disabling other subscriptions.
- [x] Both themes/mobile layout work and the artifact remains single-file.
- [x] No raw keys in list/preview DOM, screenshots or error output.

## Stop conditions and maintenance
Stop if the backend API/capability does not exist or enforcement remains unproven. Avoid ad hoc fetch, optimistic success after failed saves, a public account-selection header, remote machine agents, or T3 source edits. Maintain parity with the management contract; keep policy explanations beside the module that owns their presentation.

## Scope

Files/directories in scope:

- `src/features/clientProfiles/ (new)`
- `src/services/api/clientProfiles.ts (new)`
- `src/types/`
- `src/router/MainRoutes.tsx`
- `src/components/layout/MainLayout.tsx`
- `src/features/authFiles/components/`
- `src/i18n/locales/`
- `tests/clientProfile*.test.ts (new)`
- `plans/`

Do not change T3 source, live gateway configuration or unrelated files. Match existing repository conventions. Open a PR against the fork's `sumo/main` when publishing authorized implementation work; do not target upstream `main` by accident.

## Implementation notes (2026-10-08)

- API: `src/services/api/clientProfiles.ts` (contract v1; snake_case normalized on read, serialized on write; If-Match on every profile/key write). State: `src/stores/useClientProfilesStore.ts` (connection-scoped, stale completions dropped, no optimistic writes). Feature: `src/features/clientProfiles/` (Client routes page at `#/client-routes`, rule editor sheet, profile & keys sheet, Accounts card links and "Use only this subscription for…" sheet). Shared strategy/priority/weight editing is CPA-008's `SharedRoutingBand`, embedded at the top of the page.
- Enforcement is `false` until CPA-003: the page shows a calm notice that rules are stored but strict requests are rejected (HTTP 503); it never announces active account selection.
- Contract dependencies the UI relies on beyond the documented fields: Accounts cards link to the inventory by deriving `credential_ref` as `credential_` + SHA-256(auth ID) (fails safe: no match = no chips). Which legacy key is associated cannot be read back (fingerprints are not exposed), so associations show labels only and the picker lists all `access.api-keys` masked; a duplicate association is explained from the 422.
- Connection context (Mini local vs MacBook tunnel) is an operator note stored in this browser per gateway; the backend has no field for it. It is labelled as configured topology, never live health.
- Verification: focused tests, `bunx bun@1.3.14 run verify`, and a browser pass against a synthetic contract mock (both themes, 360/1280, keyboard: open from cell, choose, save, Escape returns focus to the cell; 412 keeps the draft and offers Reload; refused save leaves the saved rule unchanged).
- Pending: end-to-end proof that requests reach only B (CPA-003); real-backend browser pass once CPA-002 merges.

