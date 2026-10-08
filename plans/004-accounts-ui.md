# CPA-004: Make account labels, enablement, availability and preference clear

- **Status:** IN REVIEW — implemented on branch `cpa-004-account-presentation`; awaiting PR review and merge into `sumo/main`.
- **Tracking issue:** https://github.com/dhruvkelawala/CLIProxyAPI/issues/5
- **Issue:** https://github.com/dhruvkelawala/Cli-Proxy-API-Management-Center/issues/1
- **Priority:** P1
- **Effort:** 1–2 days (rough)
- **Risk:** Low
- **Planned at:** 6abace9ffb83a9ac349464ded04bb4e7f7cb309e (v1.25.4), 2026-10-07
- **Branch:** create a topic branch from `sumo/main`; retain existing Go module/package identity.
- **Depends on:** None; ready to pick up

Read this ticket and AGENTS.md before editing. Drift check: `git diff --stat 6abace9ffb83a9ac349464ded04bb4e7f7cb309e..HEAD -- src/features/authFiles/ src/features/dashboard/hooks/useDashboardOverview.ts src/components/layout/MainLayout.tsx src/i18n/locales/ tests/authFile tests/accountPresentation.test.ts plans/`. If relevant source changed, re-read the cited behavior before following the steps. Keep changes focused; update plans/README.md when finished.

## Outcome
An Accounts page makes it clear which credentials are enabled, currently available and preferred for new automatic sessions. An intentionally disabled account reads Off by choice. Selecting a bulk checkbox cannot be mistaken for choosing an inference account.

## Context and current state
The gateway is shared between a Mini and a MacBook through a localhost tunnel. Account administration affects that shared service; a per-thread choice belongs to a client profile, not to the checkbox. The second Claude account was disabled because selection was unclear.

The current code already uses email/project identity before filenames:
- `AuthFileCard.tsx:137`: `SelectionCheckbox` calls `onToggleSelect(file.name)` for bulk actions.
- `AuthFileDetailsSheet.tsx:177`: two expanded read-only JSON areas precede Prefix/Priority controls around line 195.
- `AuthFilesPage.tsx:485`: `files.filter((file) => file.disabled !== true).length` counts enabled credentials as active.
- `useDashboardOverview.ts:245` subtracts disabled and unavailable credentials, producing a different active count.
- The enable switch label stays Enabled even when off; notes disappear in compact mode.

Use existing identity helpers, notes, status guards and theme/UI components. There is no new backend requirement for this ticket. See the illustrative `plans/dashboard-concept.html`; its client policies are proposals, not available features.

## Steps
1. Create a small account-presentation model that separates Enabled/Disabled from availability/cooldown/error/unknown and pool preference. Replace ambiguous active totals with consistent named counts across Accounts and overview.
2. Put friendly purpose/note and routing controls before Advanced metadata. Keep account purpose in compact mode and preserve unsaved-change protection and stale-response guards.
3. Label switches from their actual state. Keep deliberately disabled credentials neutral and outside the Problem filter. Label bulk selection explicitly.
4. Explain Prefix, Priority and session-affinity limits. Do not imply priority changes move healthy existing sessions or that a selected checkbox changes a thread's account.
5. Add persistent shared-gateway context. Connection identity should come from safe configured/display metadata, not a hard-coded personal hostname. Missing quota stays Unknown; no invented token/cost history.
6. Add regression cases using `tests/authFileStatusIdentity.test.ts`, `authFileProblemStatus.test.ts` and `authFileIdentity.test.ts` patterns. Update all four locales.

## Verification and done criteria
- [x] `bunx bun@1.3.14 test tests/accountPresentation.test.ts tests/authFileStatusIdentity.test.ts tests/authFileProblemStatus.test.ts tests/authFileIdentity.test.ts` exits 0.
- [x] Enabled-but-unavailable and deliberately-disabled fixtures produce consistent counts on both pages.
- [x] Bulk selection does not alter routing; switch text and compact notes match the account state.
- [x] `bunx bun@1.3.14 run verify` exits 0.
- [x] Browser inspection at 360px and 728px covers Accounts/detail/compact views in both themes with synthetic data. Save screenshots without credential fields.
- [x] Single-file build and hash routing remain intact.

## Boundaries and stop conditions
Do not implement client-profile policy controls until CPA-002/003 exist. Do not add v0 APIs, move unrelated feature folders, rewrite the theme or weaken management authentication. If friendly labels require new backend metadata beyond the existing note field, specify that dependency rather than editing backend code in this ticket.

## Scope

Files/directories in scope:

- `src/features/authFiles/`
- `src/features/dashboard/hooks/useDashboardOverview.ts`
- `src/components/layout/MainLayout.tsx`
- `src/i18n/locales/`
- `tests/authFile*.test.ts`
- `tests/accountPresentation.test.ts (new)`
- `plans/`

Do not change T3 source, live gateway configuration or unrelated files. Match existing repository conventions. Open a PR against the fork's `sumo/main` when publishing authorized implementation work; do not target upstream `main` by accident.

## Implementation notes

- Model: `src/features/authFiles/accountPresentation.ts` separates enablement (the `disabled` flag is authoritative; status only when the flag is absent), availability (available, cooling down, needs attention, unknown — exactly the Problem filter for the two failing states) and per-provider pool preference (highest usable priority tier, default 0; unknown availability counts as usable). The Accounts header and the dashboard overview both use `summarizeAccounts`.
- Cards show purpose (note) and a state line in both regular and compact views; switch text and accessible names follow the actual state; deliberately disabled accounts read "Off by choice" without a warning banner. Bulk checkboxes are labelled "for bulk actions" and never call the Management API.
- The details sheet orders Account (purpose) → Routing (priority, weight, prefix, with session-affinity limits) → Connection & behavior, with raw JSON collapsed under "Advanced metadata".
- Shared-gateway context comes from the configured management base (`gatewayDisplayHost`: host[:port] only) in the Accounts header and the sidebar brand subtitle.
- Friendly labels use the existing `note` field only; no backend metadata was added. The auth-file list does not expose `prefix`, so pool preference is per provider and does not model prefix-scoped pools.
- Verification: focused tests and `bunx bun@1.3.14 run verify` passed; screenshots were captured against a synthetic mock Management API (Accounts, compact, details sheet, dashboard; light/dark; 360px/728px).
