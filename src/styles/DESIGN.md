# Flow design language

Every page of the management center uses one calm style ("Flow"). Routing (`#/client-routes`) is
the reference implementation; Overview (`#/`), Accounts (`#/auth-files`) and Quota (`#/quota`)
follow it, and so do the rarely opened pages under the sidebar's More (Quick Start, AI Providers,
OAuth, Logs, Config, Plugins, Plugin Store, Management Center info, the two model-rule editors)
and the login screen. New pages reuse what is listed here rather than invent new pieces.

## Principles

1. **The headline is a sentence that states the outcome.** "New conversations go to Work.",
   not "Client routes". It changes when the outcome changes, and the line under it says what
   happens next ("If Work runs out, they switch to Personal automatically.").
2. **One centred reading column.** About 700px wide, generous top space, nothing pinned to the
   edges. Wide screens get more air, not more columns.
3. **A live diagram is the hero.** Show the thing working (who sends, where it goes, what is
   waiting) before any controls. Interaction happens on the diagram itself where possible.
4. **Secondary text is quiet.** `--text-secondary` for explanations, the operational muted
   tone for captions; small uppercase eyebrows for labels.
5. **Hairlines over boxes.** Separate with `--hairline` rules; a bordered card only where the
   thing is an object you can grab (an account in the order).
6. **Colour only for state.** Green working, amber degraded or locked, red failing. Everything
   else is greyscale.
7. **Indigo (`--accent-indigo`) sparingly**: the live path, the account receiving traffic,
   focus rings and a pressed toggle. Never decoration.
8. **One meaningful animation per view.** On Routing it is the traffic: dots travelling along
   live paths, and cards gliding when the order changes. Everything else is a short state
   transition, not motion for its own sake.
9. **Soft easing.** `--ease-out-strong`; 200ms for hovers, ~300ms for state changes,
   `--dur-glide` (360ms) for movement. No bounce.
10. **Respect `prefers-reduced-motion`.** No travelling dots, no glide, no fades; the final
    state appears at once. Use `usePrefersReducedMotion()` in components and a
    `@media (prefers-reduced-motion: reduce)` block in every module that transitions.
11. **Rare options live under one "More" per page.** Daily tasks stay visible; everything else
    collapses into a single `MoreDisclosure` at the bottom, with a one-line summary of the
    saved state. It is forced open while it holds unsaved edits or an error.
12. **Plain language, in every locale.** Say "Work is out", not "credential unavailable".
    All copy goes through i18n (en, zh-CN, zh-TW, ru, vi), including accessible names.

## Tokens

Existing theme tokens (`src/styles/themes.scss`) stay the source of colour. Flow adds three:

| Token             | Use                                                |
| ----------------- | -------------------------------------------------- |
| `--accent-indigo` | the single accent (live path, serving card, focus) |
| `--hairline`      | separators and quiet card borders                  |
| `--dur-glide`     | movement duration (reorder glide)                  |

## Shared components (`src/components/flow/`)

| Component              | File                 | What it is                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PageHeader`           | `PageHeader.tsx`     | Eyebrow, sentence title, quiet subtitle (optionally announced), optional actions. The title fades in softly when its sentence changes. `level={2}` makes it a later section's headline on the same page (an h2, one step smaller).                                                                                                                                                                                                                                                                                                                             |
| `FlowDiagram`          | `FlowDiagram.tsx`    | Sources → hub → destinations in order. Primary on a solid accent path, backups dashed, unusable faint; dots travel along live routes. Cards reorder by drag or ↑/↓/Home/End and glide. Generic over the card.                                                                                                                                                                                                                                                      |
| `flowLayout`           | `flowLayout.ts`      | Pure geometry for the diagram (wide and narrow layouts, paths, drop index, `moveItem`).                                                                                                                                                                                                                                                                                                                                                                            |
| `QuotaRail`            | `QuotaRail.tsx`      | Hairline meter of what is left with a caption such as "54% left this week · resets Tue 9:06 PM". Unknown is never drawn as empty.                                                                                                                                                                                                                                                                                                                                  |
| `StatusDot`            | `StatusDot.tsx`      | A coloured dot (the only colour) plus a plain-language label. Tones: ok, warn, bad, off, unknown.                                                                                                                                                                                                                                                                                                                                                                  |
| `MoreDisclosure`       | `MoreDisclosure.tsx` | The page's single "More": a button with `aria-expanded`/`aria-controls`, a labelled region with an animated height, content kept mounted (inert while closed), optional summary and forced-open note.                                                                                                                                                                                                                                                              |
| `DeviceGlyph`          | `DeviceGlyph.tsx`    | Laptop outline for client sources.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `TrafficFlow`          | `TrafficFlow.tsx`    | Gateway → providers → accounts, read-only. One time window throughout (Overview uses the last 30 minutes, labelled once): path thickness is the share of traffic, travelling dots are volume for accounts serving now (none for backups or accounts that cannot serve), red flecks are failures. Nested list for assistive technology, SVG `aria-hidden`.                                                                                                          |
| `trafficLayout`        | `trafficLayout.ts`   | Pure geometry for TrafficFlow (wide three-column and narrow one-column layouts, paths, `strokeFor`, `dotsFor`).                                                                                                                                                                                                                                                                                                                                                    |
| `StepFlow`             | `StepFlow.tsx`       | A short row of steps (OAuth: browser → sign in → account added). The step under way is indigo and one dot travels toward the next while it waits; done steps get a green check, a failed one a red cross. `<ol>` with `aria-current="step"`; drawing `aria-hidden`; reduced motion drops the dot. Pure `nodeStateOf` / `linkStateOf` in `stepFlowModel.ts`.                                                                                                        |
| `flowPage.module.scss` | (styles)             | The shared page vocabulary: `.page` (760px column) and `.wide` (960px workspace, Logs), `.lead`, `.section`, `.sectionLabel`, `.quiet`, `.caption`, `.actions`, hairline `.list`/`.row`, definition `.facts`/`.fact`, `.textButton` (+ `.textButtonStrong`, `.textDanger`), `.textLink`, dot `.note` (`data-tone="bad"`/`"ok"`), `.moreWrap`/`.moreBody`/`.moreSection`, and `.quietButtons`, which turns legacy `<Button>`s inside a container into text buttons. |
| `ActionMenu`           | `ActionMenu.tsx`     | A button that opens a short menu (`aria-haspopup="menu"`, `role="menuitem"`, ↑/↓/Home/End, Escape returns focus). `primary` for a page's one filled action (Accounts' "Add account"), `quiet` for an overflow.                                                                                                                                                                                                                                                     |

Related: `usePrefersReducedMotion` (`src/hooks/`), and the sidebar's primary list plus one
collapsible More group (`src/components/layout/navModel.ts`).

## Page recipe

```
<div class="page">                 // centred column, max-width ~700px
  <PageHeader eyebrow title subtitle live />
  <FlowDiagram … />                // or another live view: the hero
  quiet lines: a hint, one or two text-button actions, footnotes
  <MoreDisclosure label="More" summary="…">rare settings</MoreDisclosure>
</div>
```

Text buttons (underlined with a hairline, indigo when pressed) are the default action style on
Flow pages; filled buttons are reserved for saving forms (a sheet, an editor's top bar, the
login form, Config's floating save bar), plus at most one primary `ActionMenu` per page.

### Sentences are models

Each page's sentence comes from a small React-free function next to the page that returns i18n
key descriptors (`{ key, values }`), so it can be tested without rendering:
`describeOverview`, `describeProviders` / `describeQuickStart` (`providersHeadline.ts`),
`describeConfig` (`configHeadline.ts`), `describeLogs` (`logs/model/logsHeadline.ts`),
`describeOAuth` (`pages/oauthFlow.ts`), `describeSystem` (`pages/systemHeadline.ts`),
`describePlugins` / `describeStore` (`pluginsHeadline.ts`) and `describeModelRuleEditor`
(`modelRulesHeadline.ts`). Blocking states (disconnected, loading, failed) come before counts.

### More stays open while it holds something

Only something under way holds a More open (`forcedOpen`, with a one-line `forcedNote`): a sign-in
or Vertex import in progress (OAuth), or a custom address ticked but still empty (login). An error
or a finished result does not; it can be read and dismissed. Search that filters a list sits above
the list, never behind a More. Errors that point at the address (network, 404, old backend) open
the login page's Connection on their own.

### Sentences follow the latest thing

When several things could be described (OAuth sign-ins), something still under way wins over a
result, and among equals the latest started wins. Changing counts and times are not announced:
PageHeader's `live` is off where the subtitle ticks (Logs). A failed step says so in words.

### Retrofitting an older page

Most of these pages keep their logic and components. The restyle is: replace the old title with
`PageHeader`, wrap the page in `flowPage.page`, move rarely used controls into the page's More,
then add a short "Flow layer" at the end of the page's own module that flattens boxed cards to
hairline rows (`border: 0; border-bottom: 1px solid var(--hairline); background: none`), turns
pill badges into coloured words and drops card hover fills. Use `.quietButtons` on a container
rather than rewriting each `<Button>`.

## Pages

| Page               | Main view                                                                                                                                                                                                         | Under More                                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Overview           | The state sentence (`describeOverview`), TrafficFlow, 5-hour and weekly rails per account, one line of totals                                                                                                     | Throughput chart, per-provider requests and success rate, account health, gateway settings, links             |
| Accounts           | The state sentence, search, one row per account grouped by provider (Claude in routing order), Add account; provider tabs only for 7+ accounts                                                                    | Show filter, sort, list/cards, page size, batch selection, model rules, scoped Delete                         |
| Routing            | One section per provider with accounts (Claude, Codex, then the rest), each with its sentence and a FlowDiagram of clients → gateway → that provider's accounts; the first carries the page headline, later ones an h2 after a hairline. One account: a single solid path and nothing to reorder                                                                                                                                                   | Shared strategy, session affinity, per-client rules, client keys                                              |
| Quota              | Per-account quota cards and the windows timeline (only providers with accounts get a tab)                                                                                                                         | Sort                                                                                                          |
| AI Providers       | "3 provider keys configured." / "No API keys yet."; one hairline row per key grouped by provider (state, switch, View/Edit/Delete menu); "Add a key" menu                                                         | Every provider with search, sort, model filter and the full table; quick-fill sponsors; sync time and Refresh |
| Quick Start        | The sponsor's state sentence and its set-up form                                                                                                                                                                  | Sync time and Refresh                                                                                         |
| OAuth              | "Sign in a new account." following the latest sign-in; StepFlow; Claude, Codex, Antigravity rows with one short line and a "Sign in" button; the sign-in under way unfolds under its row (errors are dismissible) | Muse, Kimi (both), xAI, Devin, plugin providers, Vertex JSON import                                           |
| Logs               | Whether logs can be read and if they are live (not announced on each read); the viewer (search, level, filters, refresh, live, fullscreen, which brings Download and Clear and makes the rest inert)              | Download and clear the loaded lines; error request logs (read only while open)                                |
| Config             | "Your gateway settings are in sync." (or unsaved/invalid counts); search; quiet section tabs; the active section (Common first)                                                                                   | Visual ↔ YAML source switch; reload                                                                           |
| Plugins            | How many plugins run; search; one row per plugin with switch, Edit config, Delete                                                                                                                                 | Global status, folder, counts; refresh                                                                        |
| Plugin Store       | What is available or updatable; the trust note; search; status filters; one row per plugin                                                                                                                        | Global status, folder, count; refresh                                                                         |
| Management Center  | Gateway version (with Check for updates), connection, UI version, build time, model count                                                                                                                         | Models by family with refresh; links; clear local login data (asks first)                                     |
| Model-rule editors | A sentence about the chosen provider's rules; provider chips; the rules; Save in the top bar                                                                                                                      | (none; they are short forms)                                                                                  |
| Login              | "Sign in to your gateway." naming the address it will use; management key; remember; Login                                                                                                                        | Connection: the detected address and a custom one (opens itself on address errors)                            |

An account row opens its details sheet, which starts with how the account is doing (status, pool,
cooldown, quota, pinned clients) and its one-off actions (models, refresh, download, delete).
Quota outside the Quota page comes from the shared cache through `useAccountQuota`, which re-reads
anything older than five minutes once per visit (`quotaFreshness`).
