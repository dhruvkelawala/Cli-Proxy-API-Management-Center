# CPA-008: Expose shared load-balancing strategies with priority, weights and session affinity

- **Status:** In review (UI steps 1-4 implemented on `cpa-008-shared-load-balancing`; step 5 fixture proof pending backend CPA-003)
- **Issue:** https://github.com/dhruvkelawala/Cli-Proxy-API-Management-Center/issues/4
- **Tracking issue:** https://github.com/dhruvkelawala/CLIProxyAPI/issues/5
- **Priority:** P2; follow strict subscription selection
- **Effort:** 2–3 days, rough
- **Risk:** Medium; UI scope can be mistaken for a client-only policy
- **Planned at:** df8299d5781570ea4544d94b7d3add8ca8a7f5f7, 2026-10-08; dashboard source baseline v1.25.4, backend v8.0.15
- **Depends on:** [CPA-004](https://github.com/dhruvkelawala/Cli-Proxy-API-Management-Center/issues/1), [CPA-005](https://github.com/dhruvkelawala/Cli-Proxy-API-Management-Center/issues/2), [CPA-006](https://github.com/dhruvkelawala/Cli-Proxy-API-Management-Center/issues/3)
- **Branch:** create `cpa-008-shared-load-balancing` from the fork's `sumo/main`

Read this plan and AGENTS.md before editing. Strict account enforcement in CPA-002/003 and its UI in CPA-005 come first. This optional follow-up does not block the CPA-007 core rollout.

Drift check: `git diff --stat df8299d5781570ea4544d94b7d3add8ca8a7f5f7..HEAD -- src/features/config/ src/features/authFiles/ src/features/clientProfiles/ src/hooks/useVisualConfig.ts src/services/api/config.ts src/services/api/authFiles.ts src/stores/useConfigStore.ts src/i18n/locales/ tests/ plans/`. Dependency changes are expected: reconcile their implemented contracts before continuing. Stop if the backend selection semantics below no longer match.

## Outcome

Put existing shared routing strategy, account priority, weights and conversation affinity together in a clear dashboard flow. Administrators can choose even rotation, weighted distribution or fill-first, understand which accounts participate, and see why an example assignment would use A or B.

Automatic uses the shared pool. Only a named subscription remains a strict client-profile constraint: pool balancing must never permit another account to substitute. Account enablement stays separate.

## Current state and evidence

This engine already exists. Do not rebuild it or introduce new backend strategy names.

- `src/features/config/components/sections/SectionNetwork.tsx:122` already edits `routingStrategy` with options `round-robin`, `weighted-round-robin`, `fill-first`. Its `Select` follows `onChange({ routingStrategy: nextValue as VisualConfigValues['routingStrategy'] })`.
- The same section already exposes session-affinity and its TTL. `src/features/config/searchIndex.ts` maps these controls to existing config fields.
- `src/features/authFiles/components/AuthFileDetailsSheet.tsx:209` already has Priority and Weight inputs. Weight uses `MAX_CREDENTIAL_WEIGHT` and links to `/config?field=routingStrategy`.
- `src/features/authFiles/hooks/useAuthFilesPrefixProxyEditor.ts` and `src/services/api/authFiles.ts` own account field validation/patching. `tests/authFileWeight.test.ts` proves numeric weight writes, blank restores the default through null, and invalid/oversized weights fail before PATCH.
- `src/hooks/useVisualConfig.ts`, `src/features/config/hooks/useConfigDocument.ts`, `src/services/api/config.ts` and `src/stores/useConfigStore.ts` own config editing, revision-aware saving and cache invalidation. Reuse this pipeline.
- `tests/visualConfigRoutingStrategy.test.ts` proves weighted strategy parsing and YAML serialization. Its test pattern imports `describe, expect, test` from `bun:test` and uses React `renderToStaticMarkup` for hook/render checks.
- In `../CLIProxyAPI/sdk/cliproxy/auth/selector.go`, `highestPriorityAuths` filters to the highest eligible numeric tier for cold selection. `WeightedRoundRobinSelector.Pick` filters non-positive weights, then uses smooth weighted round-robin. `FillFirstSelector.Pick` returns `available[0]`; candidates are sorted by internal ID, not UI drag order.
- `SessionAffinitySelector.Pick` retains an eligible established binding across priority tiers. New binding or genuine failover selects from the highest eligible tier. `../CLIProxyAPI/config.example.yaml:139` documents this behavior.

The approved illustration is `plans/008-load-balancing-concept.html`. Its A/B accounts and failure controls are synthetic. It is not an API contract or live routing proof. Its simplified Primary/Backup tiers illustrate priority; preserve arbitrary existing numeric priorities in production.

## Behavior contract

| Control | Required behavior |
|---|---|
| Automatic / Use shared pool | Existing global strategy selects from the permitted eligible pool. |
| Only A or Only B | CPA-003 constraint remains authoritative for all applicable requests. Unavailable target means an error, never pool fallback. |
| Rotate evenly | Serialize `round-robin`; balance cold assignments within the highest eligible tier. |
| Weighted split | Serialize `weighted-round-robin`; positive integer weights distribute selections within that tier. |
| Concentrate on one | Serialize `fill-first`; choose the first eligible account in stable internal ID order. To deliberately prefer A, give it higher priority. |
| Priority | Larger numeric value wins for new assignments. Equal-priority accounts share work; lower eligible tiers provide fallback. Do not silently replace existing values with 10/0. |
| Weight | Default 1, maximum 1,000,000. Non-positive values exclude from weighted scheduling, including weighted affinity candidates; they do not disable the account for other strategies. |
| Keep conversations on one account | Existing session-affinity setting. Healthy existing bindings persist even when a higher-priority account recovers. |

With affinity enabled, weights usually distribute new conversation bindings or other cold selections. A 3:1 ratio is roughly 75:25 of scheduler assignments with stable eligibility, not a guaranteed fraction of requests, tokens, cost or elapsed time. Missing session identity and inherited session bindings can change observed traffic.

A global strategy edit affects Automatic traffic across provider pools on the shared Mini gateway, including traffic arriving from the MacBook. It is not a preference for the machine viewing the dashboard. Account priority/weight edits affect every Automatic client using that credential. Show this scope beside the save action.

Recommend round-robin plus session affinity for coding, but preserve the saved configuration on upgrade. The current deployment's fill-first setting must not change merely because the new UI loads.

## Scope

Allowed implementation paths:

- `src/features/config/`
- `src/features/authFiles/`
- `src/features/clientProfiles/` from CPA-005, for the policy/shared-settings connection
- `src/hooks/useVisualConfig.ts`
- `src/services/api/config.ts`, `src/services/api/authFiles.ts`
- `src/stores/useConfigStore.ts`
- `src/i18n/locales/`
- `tests/visualConfigRoutingStrategy.test.ts`, `tests/authFileWeight.test.ts`
- `tests/routingPresentation.test.ts`, `tests/routingSettingsState.test.ts`, `tests/routingSettingsRendering.test.ts`, new if needed
- `plans/`

Do not change backend scheduling, T3, deployment/tunnels, production config, OAuth files, client credentials, unrelated theme/layout files or API versions. No per-client strategy, selected pool, scoped weight or Prefer/fallback mode in this ticket.

Match React/TypeScript feature ownership, existing Input/Select/Toggle components, SCSS Modules and theme tokens. Keep all strings and accessible labels in en, zh-CN, zh-TW and ru. Preserve v8 management APIs, hash routing and the single-file artifact.

## Implementation steps

1. Reconcile CPA-004/005/006, read the existing config/account save flows, and map the shared routing controls into the resulting Accounts/Client routes UI. Use the existing config page as the shared settings owner, with context links or a reused editor beside Automatic selection. Avoid a second unsynchronized copy of the settings state. Only policy editors show the strict target and error behavior; balance controls are hidden or disabled as irrelevant there.
   - Verify: `bunx bun@1.3.14 test tests/visualConfigRoutingStrategy.test.ts tests/authFileWeight.test.ts` exits 0 before edits. Read the CPA-002 API contract and CPA-003 fixture results; verify prerequisites are complete.
2. Add a small feature-owned presentation model for strategy explanations, priority participation and conditional weight controls. Preview configured ratios under an explicit all-eligible assumption. Disabled, non-positive-weight and lower-priority exclusions need different reasons. Unknown live eligibility stays Unknown; do not reconstruct a full scheduler in the browser.
   - Verify: `bunx bun@1.3.14 test tests/routingPresentation.test.ts` exits 0 for 1:1, 3:1, distinct tiers, zero weight, disabled account, unknown availability and strict-policy presentation.
3. Connect controls to existing typed save operations. Preserve untouched strategy, TTL, priority and other metadata. Global config and account patches are separate saves: do not claim atomic success if only one succeeded. Show each saved state accurately, retain failed drafts and prevent stale completion after connection/profile changes. Keep advanced zero-weight semantics discoverable.
   - Verify: `bunx bun@1.3.14 test tests/routingSettingsState.test.ts tests/visualConfigRoutingStrategy.test.ts tests/authFileWeight.test.ts` exits 0, including failed/partial saves and no automatic default migration.
4. Add the shared-gateway scope notice, illustrative preview labeling and clear fallback explanation. Changing selection or strategy in an illustration never sends inference requests. Reuse the existing strict-policy UI rather than adding a new wire mode. Translate every new label/hint and preserve keyboard/focus and narrow-screen controls.
   - Verify: `bunx bun@1.3.14 test tests/routingSettingsRendering.test.ts` and `bunx bun@1.3.14 run verify` exit 0. Browser evidence at 360px/728px in both themes shows strategy changes, inactive weights, strict target, unknown eligibility, and failure states without overflow or secret fields.
5. Use the disposable routing fixture from CPA-001 and implemented policies from CPA-003 to prove this UI is reporting real saved settings. Under each of the three global strategies, an Only-B profile must still hit B exclusively with A enabled. Make B unavailable: receive a clear failure and record zero A traffic. Automatic fixture requests demonstrate strategy/tier behavior. Editing shared settings must not rewrite an Only profile.
   - Verify: run the fixture's documented command from CPA-001 and capture synthetic requests/responses plus account recorder counts. All strict cases record zero traffic to the other account; persisted config/profile reads match successful saves.

## Done criteria

- [ ] All three existing strategy values survive read/edit/save/reload without coercion or automatic migration.
- [ ] Weights, priority tiers and affinity explanations match backend semantics; a healthy existing binding is not claimed to move on priority edits.
- [ ] Preview labels describe configured/illustrative assignment shares, never actual served-by attribution, tokens or cost.
- [ ] Global edits clearly identify all affected Automatic clients/providers and both-machine shared scope.
- [ ] Weight values 0 or below are distinguished from account disablement; arbitrary numeric priorities are preserved.
- [ ] Failed/partial saves and stale responses do not produce false success.
- [ ] Only-B remains strict under all global strategies and failure cases in the isolated fixture.
- [ ] Focused tests and `bunx bun@1.3.14 run verify` pass; screenshots cover both themes and widths.
- [ ] Changed files remain in scope; no new backend API, T3 fork or production modification.
- [ ] Update this issue and the pickup/tracking status with implementation evidence.

## Implementation status

Implemented (steps 1-4, UI only):

- `src/features/config/routing/SharedRoutingBand.tsx` exports `SharedRoutingBand({ automaticClientCount? })`: strategy choice, "Keep conversations on one account" with TTL, and a "Priorities & weights" side sheet. It is not mounted anywhere yet; the Client routes page (CPA-005) mounts it. The Config page keeps its own Network editor, which now shows the same explanations.
- Saved strategy and affinity are read from `useConfigStore` and written as touched-field patches through `applyConfigPatch` (connection-revision aware), so an untouched fill-first is never rewritten. Priority and weight use `authFilesApi.patchFields` with the credential editor's field semantics. The two saves are separate, report their own state, retain failed drafts and ignore completions after a connection switch.
- Verification: `tests/routingSettingsState.test.ts`, `tests/routingSettingsRendering.test.ts`, `tests/routingPresentation.test.ts` and `bunx bun@1.3.14 run verify`. Browser evidence against a synthetic mock (360px/728px, light/dark) is kept outside the repo.

Pending:

- Step 5 (fixture proof that Only-B stays strict under all three strategies and that failures record zero traffic to A) needs the CPA-001 fixture and the CPA-003 strict policies. Not run, not faked.
- Mounting on the Client routes page and the real Automatic client count belong to CPA-005.
- `../CLIProxyAPI` was not available in this workspace; selector semantics were taken from this plan and were not re-read in the backend source.

## Stop conditions and later work

Stop if CPA-002/003/005 are incomplete, a supported backend does not have the documented strategy semantics, or the change requires an API contract or scheduler modification. Do not fabricate per-client settings by changing shared auth priorities/weights.

Per-client/provider selected pools, strategy overrides and weights need a separate persisted backend policy contract after strict enforcement. Affinity and retry state must respect those pools across fast/native scheduling, Home mode and WebSockets. These are deferred, not silently included here.

Quota-aware and least-busy routing remain deferred until quota freshness and in-flight request telemetry are reliable. Existing quota windows alone do not establish either capability. Actual served-by attribution and durable token/cost history remain separate work.

Publish authorized implementation through a topic PR against this fork's `sumo/main`. Preserve upstream license and attribution. Run the strict fixture again after future scheduler/upstream upgrades.
