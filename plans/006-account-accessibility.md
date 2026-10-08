# CPA-006: Make account and client-route controls accessible in both themes

- **Status:** IN PROGRESS (part 1 done: contrast tokens + model Copy buttons; part 2 pending CPA-004/005)
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

## Progress: part 1 (independent of CPA-004/005)

Implemented on `cpa-006-accessibility-controls`: contrast tokens, accessible model Copy buttons (`AuthFileModelList` in `AuthFileModelsModal.tsx`), `tests/accountAccessibility.test.ts` with a test-only WCAG helper (`tests/helpers/wcagContrast.ts`) that parses the real token values from `themes.scss`/`components.scss`.

**Still pending (needs CPA-004 / CPA-005):** steps 3-5 for the Accounts card/sheet/page and the Client routes: switches, profile selects, disclosures, error text, focus return after closing the details sheet, 728px screenshots of those screens, and migrating the remaining `var(--text-tertiary)` text uses to `--text-operational-muted` (including `AuthFileCard.module.scss`, deliberately not touched here).

### Measured contrast (WCAG 2.x, computed from token values; light = default `:root`)

| Combination | Before | After |
| --- | --- | --- |
| Light: white on primary button (`--primary-color` #8b8680), the Login button | 3.61 | 5.59 (hover 6.52) |
| Dark: white on primary button | 3.61 (hover lighter, worse) | 5.59 (hover 4.62) |
| White on danger button (#c65746) | 4.33 | 4.89 (#bd4d3c) |
| Light: tertiary text vs page / card / dialog / hover (`--text-tertiary` #a29c95) | 2.58 / 2.34 / 2.68 / 2.18 | operational token #6a645d: 5.55 / 5.04 / 5.75 / 4.69 |
| Dark: tertiary text vs page / card / dialog / hover (#9c958d) | 6.22 / 5.81 / 5.02 / 5.28 | unchanged, already passing; operational token aliases it |
| Light: `--text-secondary` vs page / card / dialog | 5.30 / 4.81 / 5.50 | unchanged |
| Light: `--text-secondary` vs hover fill (`--bg-tertiary`) | 4.48 | unchanged (0.02 short; not asserted, not used for body text) |
| Primary button fill vs card (non-text control boundary), light / dark | 3.11 / 4.76 (old fill) | 4.81 / 3.08 (>= 3 asserted) |
| Focus ring (`--text-secondary`) vs dialog/card/hover | n/a (browser default) | >= 4.48 light, >= 8 dark (>= 3 asserted) |

Computed in a real browser (Chrome via Playwright, mock API with synthetic data): Login button resolves to `rgb(255,255,255)` on `rgb(109,103,96)` = 5.59:1 in both themes. In the Models dialog, light/dark text measured: model id 12.31 / 15.65, display name and type 5.04 / 5.81, Copy button 4.81 / 17.18.

### Trade-off decisions

- `--text-tertiary` is also used (about 116 places) for decorative fills (status dots, timeline bars, plugin markers) as well as text. Darkening it globally would change those unrelated screens, and a light-theme value that reaches 4.5:1 on the hover surface is nearly identical to `--text-secondary`, collapsing the hierarchy. A separate `--text-operational-muted` token was added instead (light #6a645d, dark = `--text-tertiary`), and the `--text-muted` alias now points to it. Screens opt in as they are reworked; remaining raw `--text-tertiary` text is not yet audited.
- `--primary-color` is also the accent for focus borders, toggles and charts, so it was left alone. The button gets its own `--btn-primary-bg`, `--btn-primary-bg-hover` and `--btn-primary-fg` tokens, with a `var(--primary-color)` fallback. Dark hover moves lighter (#7a746d) and still passes at 4.62:1.
- Excluded model rows no longer use `opacity: 0.55` (it dropped text below 4.5:1); the Disabled badge and secondary text colour carry the state.
- Placeholder text and `--text-quaternary` were not changed or audited.

### Browser verification (mock Management API, synthetic data, headless Chrome)

Keyboard pass in light, dark and 360px: opening Models with Enter moves focus into the dialog; Tab reaches each `Copy model ID <id>` button before Close; Enter and Space on a Copy button each wrote the model id to the real clipboard and showed the existing success toast; Escape closed the dialog and focus returned to the Models button; no horizontal overflow at 360px. Screenshots in `/tmp/cpa-ship/screens/cpa-006/`. The clipboard-failure toast path and 728px layout were not exercised. Static markup tests only assert labels and structure, not keyboard behavior.

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
