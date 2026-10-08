# CPA-006: Make account and client-route controls accessible in both themes

- **Status:** DONE — part 1 merged in #5; part 2 merged from `cpa-006-accessibility-part2`.
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
- [x] `bunx bun@1.3.14 test tests/accountAccessibility.test.ts` exits 0.
- [x] `bunx bun@1.3.14 run verify` exits 0.
- [x] A browser keyboard pass reaches every changed control, activates Copy with Enter/Space, and returns focus from dialogs.
- [x] Record measured ratios for both themes and screenshots at 360px/728px.
- [x] No decorative redesign, unrelated CSS cleanup or new DOM test framework.

## Stop conditions and maintenance
Treat source-only contrast measurements as leads until computed rendered styles are checked. If a token change affects unrelated screens, use a narrower operational-text token/component change and document the tradeoff. Do not describe passing static markup tests as passing keyboard interaction. Recheck both themes when upstream theme tokens change.

## Progress: part 1 (independent of CPA-004/005)

Implemented on `cpa-006-accessibility-controls`: contrast tokens, accessible model Copy buttons (`AuthFileModelList` in `AuthFileModelsModal.tsx`), `tests/accountAccessibility.test.ts` with a test-only WCAG helper (`tests/helpers/wcagContrast.ts`) that parses the real token values from `themes.scss`/`components.scss`.

**Was pending until part 2 (now done, see below):** steps 3-5 for the Accounts card/sheet/page and the Client routes: switches, profile selects, disclosures, error text, focus return after closing the details sheet, 728px screenshots of those screens, and migrating the remaining `var(--text-tertiary)` text uses to `--text-operational-muted` (including `AuthFileCard.module.scss`, deliberately not touched here).

### Measured contrast (WCAG 2.x, computed from token values; light = default `:root`)

| Combination | Before | After |
| --- | --- | --- |
| Light: white on primary button (`--primary-color` #8b8680), the Login button | 3.61 | 5.59 on #6d6760 (hover #625d57: 6.52) |
| Dark: primary button, white on #8b8680 | 3.61 | dark text #151412 on #8b8680: 5.10 (hover #9a948e: 6.14) |
| Light: white on danger button (#c65746) | 4.33 | 4.89 on #bd4d3c (hover #a94434: 5.89) |
| Dark: white on danger button (#c65746) | 4.33 | dark text on #d4604d: 4.89 (hover #de7261: 5.86) |
| Dark: tertiary text vs page / card / dialog / hover (#9c958d) | 6.22 / 5.81 / 5.02 / 5.28 | unchanged, already passing; operational token aliases it |
| Light: `--text-secondary` vs page / card / dialog | 5.30 / 4.81 / 5.50 | unchanged |
| Light: `--text-secondary` vs hover fill (`--bg-tertiary`) | 4.48 | unchanged (0.02 short; not asserted, not used for body text) |
| Light: primary fill vs page / card / dialog / hover fill | 3.43 / 3.11 / n/a / 2.90 (old fill) | 5.30 / 4.81 / 5.50 / 4.48 |
| Dark: primary fill vs page / card / dialog / hover fill (`--bg-hover`) | 5.10 / 4.76 / 4.12 / 3.94 (old fill) | unchanged, all >= 3.94; the first attempt (#6d6760 fill) was 2.66 on dialogs and 2.55 on hover fills and was rejected |
| Light: danger fill (#bd4d3c) vs page / card / dialog / hover fill | 4.25 / 3.97 / n/a / 3.61 (old fill) | 4.65 / 4.22 / 4.82 / 3.93 |
| Dark: danger fill (#d4604d) vs page / card / dialog / hover fill | 4.25 / 3.97 / 3.43 / 3.29 (old fill) | 4.89 / 4.57 / 3.95 / 3.78 |
| Focus ring (`--text-secondary`) vs dialog/card/hover | n/a (browser default) | >= 4.48 light, >= 8 dark (>= 3 asserted) |

Computed in a real browser (Chrome via Playwright, mock API with synthetic data): the Login button resolves to white on `rgb(109,103,96)` = 5.59:1 in light, and `rgb(21,20,18)` on `rgb(139,134,128)` = 5.10:1 in dark. In the Models dialog, light/dark text measured: model id 12.31 / 15.65, display name and type 5.04 / 5.81, Copy button 4.81 / 17.18.

### Trade-off decisions

- `--text-tertiary` is also used (about 116 places) for decorative fills (status dots, timeline bars, plugin markers) as well as text. Darkening it globally would change those unrelated screens, and a light-theme value that reaches 4.5:1 on the hover surface is nearly identical to `--text-secondary`, collapsing the hierarchy. A separate `--text-operational-muted` token was added instead (light #6a645d, dark = `--text-tertiary`), and the `--text-muted` alias now points to it. Screens opt in as they are reworked; remaining raw `--text-tertiary` text is not yet audited.
- `--primary-color` is also the accent for focus borders, toggles and charts, so it was left alone. Buttons get their own `--btn-primary-*` and `--btn-danger-*` (`-bg`, `-bg-hover`, `-fg`) tokens, with fallbacks to the old colours. Light keeps white text on a darker fill. Dark keeps the original fill (#8b8680, hover #9a948e) with dark text (#151412), because a darker dark-theme fill fell below 3:1 on dialogs and hover fills. Tests assert text >= 4.5:1 and fill >= 3:1 (default and hover) on page, card, dialog, `--bg-tertiary` and `--bg-hover` surfaces in all three themes.
- `[data-theme='dark'] .btn { color: #fff }` had equal specificity to `.btn.btn-primary` and silently overrode the button text colour in dark; it now excludes primary and danger buttons.
- The row hover highlight in the models dialog was removed (it implied the row was clickable). The excluded-model hint is exposed to assistive tech by visually hidden text referenced from the Copy button with `aria-describedby`.
- Excluded model rows no longer use `opacity: 0.55` (it dropped text below 4.5:1); the Disabled badge and secondary text colour carry the state.
- Placeholder text and `--text-quaternary` were not changed or audited.

### Browser verification (mock Management API, synthetic data, headless Chrome)

Keyboard pass in light, dark and 360px: opening Models with Enter moves focus into the dialog; Tab reaches each `Copy model ID <id>` button before Close; Enter and Space on a Copy button each wrote the model id to the real clipboard and showed the existing success toast; Escape closed the dialog and focus returned to the Models button; no horizontal overflow at 360px. Screenshots in `/tmp/cpa-ship/screens/cpa-006/`. The clipboard-failure toast path, 728px layout, and the excluded-model `aria-describedby` hint in a browser (the mock did not mark a model as excluded; covered by static markup only) were not exercised. The keyboard pass above predates the contrast/hover revision; the revision was re-checked for computed button colours, the absence of row hover and dark-theme screenshots (`*-v2.png`). Static markup tests only assert labels and structure, not keyboard behavior.

## Progress: part 2 (Accounts, Client routes, shared band; after CPA-004/005/008 and the Linear-style dark theme)

Checked against `sumo/main` at 73cddfd with a mock v8 backend (synthetic data), headless Chrome via Playwright. Evidence is in `/tmp/cpa-ship/screens/cpa-006b/` (`measured-contrast.log`, `contrast-and-audit.log`, `keyboard-pass.log`, `reduced-motion.log`, screenshots at 360px and 728px in both themes).

### What the rendered audit found and what changed

Every visible text node on Accounts and Client routes was measured from computed styles (light and dark; 360/728/1280px; 100% and 200% text). Before: 44 failing nodes per Accounts view in light and 19 in dark, and 4 on Client routes (sidebar group labels). After: 0 everywhere. Client routes itself was already clean apart from the shared sidebar labels and one 4.48:1 band option.

- **Step 1, contrast.** New narrow tokens `--text-operational-success` and `--text-operational-danger` (light #0a6b4b / #a63d2c, dark = `--viz-success` / #e5604f); `--viz-*` and `--error-color` stay for fills and dots. Accounts text (`AuthFileCard`, quota, toolbar, tabs, vault header/pulse, details sheet, OAuth panels, excluded-model picker) moved from `--text-tertiary`/`--text-quaternary`/`--viz-*`/`--danger-color` to the operational tokens. Disabled account cards no longer dim all content with `opacity: 0.68` (it took text to 1.4-2.6:1); the surface tint plus the Disabled label carry the state. Sidebar group labels (`color-mix` at 42%, 2.4:1 light / 3.9:1 dark) use `--text-operational-muted`. Provider badge pairs below 4.5:1 were fixed (claude light text, gemini/meta dark text). Light toolbar segments, the priority pill and the shared-band options used `--text-secondary` on the hover tone (4.46-4.48:1) and now use the operational token. The details-sheet link is `--text-primary` and underlined instead of `--primary-color` (3.1:1).
- **Step 3, controls.**
  - `ToggleSwitch` (shared) is now `role="switch"`, has a visible `:focus-visible` ring (it had none: the input is 0x0) and an off-state boundary ring of 3:1 or more (the neutral track was ~1.2:1). Account switch names already reflect state ("...: enabled" / "...: disabled") and update on Space.
  - The unchecked `SelectionCheckbox` boundary (`--border-color`, ~1.3:1) now uses the operational muted token (5.1-5.7:1).
  - The shared `Select` trigger gets a 2px `:focus-visible` outline (it only had an 18% primary ring).
  - "Use only this subscription for…" had an accessible name that did not contain its visible text (WCAG 2.5.3). The aria text now starts with the visible text in all five locales. The Sort select name includes the current value ("Sort: Default"). The four icon-only card actions have explicit `aria-label`s (they only had `title`).
  - Client routes matrix cells had an `aria-label` that hid the visible rule text. Their name is now built from the visible pill text plus hidden context (`matrix.cell_context`, `matrix.cell_change`; `matrix.cell_label` and `describeCellText` removed). The provider name on narrow screens is visually hidden on wide screens instead of `display: none`/`aria-hidden`, so the name stays complete. Example: "Mini · T3 Claude: Claude Automatic Claude A 100% Change rule".
  - Focus return: a confirmation opened from a sheet (unsaved changes) did not return focus when it closed, because `ConfirmationModal` unmounts and `Modal` never restores focus (focus fell to `<body>`); it now remembers and restores the opener. Escape on that confirmation also re-ran the sheet's close guard and re-opened the confirmation, because Sheet and Modal both listened for Escape and Tab on `document`; only the topmost dialog (`src/components/ui/dialogStack.ts`) now reacts.
  - Copy feedback for model IDs and prefix text said "Link copied to clipboard"; it now uses `notification.copied` (all five locales).
- **Step 4, 360px and motion.** The closed mobile drawer's links were focusable off-screen (ten invisible Tab stops before content); it is `visibility: hidden` until open (hidden after the slide-out). No horizontal overflow and no clipped actions at 360px at 200% text-only zoom on either page. Under `prefers-reduced-motion: reduce` the dialog scale/fade, the drawer slide and the switch thumb no longer animate (sheets and the pulse bars already did not); only 150-300ms colour/opacity transitions remain.
- **Known item.** `RoutingTuningPanel` used `styles.link`, which is `String.prototype.link` in Bun tests (SCSS modules load as strings) and printed React's "Invalid value for prop `className` on <a>". Renamed to `styles.providersLink`; a test scans `src` for the other colliding names.

### Measured (computed fg on composited bg; threshold 4.5 text, 3 boundary)

| Element | Light | Dark |
| --- | --- | --- |
| Login button (white text) | 5.59 (was 3.61 before part 1) | 4.70 on the new #5e6ad2 |
| Sidebar group label | 5.04 (was 2.36) | 6.13 (was 3.87) |
| Card file name / meta / health label | 5.13 (was 2.38) | 5.67 (was 3.2) |
| Card success / failure count | 5.73 / 5.54 (was 2.23 / 3.8) | 6.45 / 5.37 (was 3.5 on a disabled card / 4.14) |
| Delete All | 5.99 (was 4.11) | 5.55 (was 4.4) |
| Claude provider badge | 4.95 (was 3.97) | 5.61 |
| Inactive toolbar segment | 4.69 (was 4.48) | 5.19 |
| Matrix pill / caption / key count | 13.55 / 5.04 / 5.04 | 17.9 / 5.63 / 5.63 |
| Shared band label / Edit button | 12.31 / 11.46 | 17.18 / 16.87 |
| Switch off-state ring, select-checkbox boundary | 4.87, 5.13 (need 3) | 5.42, 5.67 |
| Client cell focus ring (primary) | 3.11 | 3.89 |

The 3.11 light focus ring on `--primary-color` is the narrowest passing value; it is 2.90:1 on the hover fill (`--bg-tertiary`), where cells do not sit. Client routes sheets keep their primary-coloured focus outlines.

### Browser verification (keyboard, clipboard, focus return; light and dark at 360px and 728px)

Tab and Shift+Tab reach: the Accounts switch, Models, Account details, Use only…, the sheet switches and checkboxes, the shared band Edit/Hide, matrix cells, the profile button, the connection select and the keys disclosure. Space toggled the account switch (name flipped to "...: disabled" and back). Enter opened Models and Space/Enter on `Copy model ID <id>` wrote the id to the real clipboard with the "Copied to clipboard" toast; with `writeText` rejected and `execCommand` false the "Copy failed" error toast appeared. Escape closed Models, Account details, Use only…, the policy sheet and the profile sheet, and focus returned to each opener (Models, Account details, Use only…, the matrix cell, the profile button). With an unsaved pin edit, Escape asked for confirmation, Escape on the confirmation left the sheet open with focus back on the checkbox, and "Discard changes" (Enter) closed both with focus back on "Use only…". Escape inside the connection select closed only the list. The shared band toggled with Enter and Space (`aria-expanded` and the name flipped Edit/Hide). Contrast was re-measured with each sheet open: 0 failing.

### Not verified or deliberately left alone

- Static markup tests (`tests/accountAccessibility.test.ts`, `tests/clientProfilesRendering.test.ts`) check names, structure and token math, not focus or clipboard behaviour; those are covered only by the browser pass above, which is manual and not automated in CI.
- A screen reader was not run; names were checked with Chrome's accessibility tree snapshot.
- The mobile drawer does not close on Escape (pre-existing, outside the changed controls). Placeholder text and `--text-quaternary` outside Accounts were not audited. The `--text-secondary` token itself is 4.48:1 on `--bg-tertiary` in light; only the components that sit on that tone were moved.
- Text zoom was simulated by doubling computed font sizes (text-only 200%) and a 360px viewport (about 355% page zoom); native browser zoom was not driven.
- Nothing was checked against a real CLIProxyAPI backend; the mock serves synthetic accounts and profiles.

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
