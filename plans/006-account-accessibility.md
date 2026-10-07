# CPA-006: Make account and client-route controls accessible in both themes

- **Status:** TODO
- **Tracking issue:** https://github.com/dhruvkelawala/CLIProxyAPI/issues/5
- **Issue:** https://github.com/dhruvkelawala/Cli-Proxy-API-Management-Center/issues/3
- **Priority:** P2
- **Effort:** 0.5–1 day (rough)
- **Risk:** Low
- **Planned at:** 6abace9ffb83a9ac349464ded04bb4e7f7cb309e (v1.25.4), 2026-10-07
- **Branch:** create a topic branch from `sumo/main`; retain existing Go module/package identity.
- **Depends on:** [CPA-004](https://github.com/dhruvkelawala/Cli-Proxy-API-Management-Center/issues/1), [CPA-005](https://github.com/dhruvkelawala/Cli-Proxy-API-Management-Center/issues/2)

Read this ticket and AGENTS.md before editing. Drift check: `git diff --stat 6abace9ffb83a9ac349464ded04bb4e7f7cb309e..HEAD -- src/styles/themes.scss src/styles/components.scss src/features/authFiles/components/AuthFileModelsModal.tsx src/features/authFiles/components/AuthFileCard.module.scss src/features/clientProfiles/ src/i18n/locales/ tests/accountAccessibility.test.ts plans/`. If relevant source changed, re-read the cited behavior before following the steps. Keep changes focused; update plans/README.md when finished.

## Outcome
Operational text, account controls and model-copy actions meet keyboard and contrast requirements without replacing the dashboard's visual style.

## Context and current state
The existing light-theme Login button has measured white 16px/600 text contrast of 3.61:1. Tertiary text tokens measure below 3:1 against light page/card tokens; authenticated final rendered styles have not yet been verified. `AuthFileModelsModal.tsx:59` uses a clickable div for model copying, without button semantics, a tab stop or keyboard action. Existing meter animation honors reduced motion; cosmetic detector matches are not a reason to rewrite it.

The Accounts and Client routes work is CPA-004/005. Reuse the shared UI components and theme tokens. Tests currently use Bun/static markup; static markup does not prove focus or browser interactions.

## Steps
1. Measure computed foreground/background combinations for normal operational text and enabled primary buttons in both themes. Strengthen only the failing token/component combinations; normal text must reach 4.5:1 and relevant controls/focus indicators 3:1.
2. Replace clickable model rows with accessible Copy buttons while retaining model text selection/readability and clipboard error feedback.
3. Inspect switches, account/profile selects, dialogs, disclosures, errors and focus return after closing sheets. Ensure accessible names reflect current state and all locale keys exist.
4. Check 360px layout and text zoom for overflow or hidden actions, plus reduced-motion behavior.
5. Add static semantic tests for actual button/switch labels and pure contrast calculations where useful. Record real browser keyboard and clipboard interaction proof.

## Verification and done criteria
- [ ] `bunx bun@1.3.14 test tests/accountAccessibility.test.ts` exits 0.
- [ ] `bunx bun@1.3.14 run verify` exits 0.
- [ ] A browser keyboard pass reaches every changed control, activates Copy with Enter/Space, and returns focus from dialogs.
- [ ] Record measured ratios for both themes and screenshots at 360px/728px.
- [ ] No decorative redesign, unrelated CSS cleanup or new DOM test framework.

## Stop conditions and maintenance
Treat source-only contrast measurements as leads until computed rendered styles are checked. If a token change affects unrelated screens, use a narrower operational-text token/component change and document the tradeoff. Do not describe passing static markup tests as passing keyboard interaction. Recheck both themes when upstream theme tokens change.

## Scope

Files/directories in scope:

- `src/styles/themes.scss`
- `src/styles/components.scss`
- `src/features/authFiles/components/AuthFileModelsModal.tsx`
- `src/features/authFiles/components/AuthFileCard.module.scss`
- `src/features/clientProfiles/`
- `src/i18n/locales/`
- `tests/accountAccessibility.test.ts (new)`
- `plans/`

Do not change T3 source, live gateway configuration or unrelated files. Match existing repository conventions. Open a PR against the fork's `sumo/main` when publishing authorized implementation work; do not target upstream `main` by accident.
