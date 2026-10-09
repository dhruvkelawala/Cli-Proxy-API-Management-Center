# Flow design language

The management center is moving, page by page, to one calm style ("Flow"). Routing
(`#/client-routes`) is the reference implementation; Overview (`#/`), Accounts (`#/auth-files`)
and Quota (`#/quota`) follow it. The remaining pages follow in later phases and should reuse what
is listed here rather than invent new pieces.

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

| Token             | Use                                               |
| ----------------- | ------------------------------------------------- |
| `--accent-indigo` | the single accent (live path, serving card, focus) |
| `--hairline`      | separators and quiet card borders                 |
| `--dur-glide`     | movement duration (reorder glide)                 |

## Shared components (`src/components/flow/`)

| Component        | File                 | What it is                                                                                                                                                                                                 |
| ---------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PageHeader`     | `PageHeader.tsx`     | Eyebrow, sentence title, quiet subtitle (optionally announced), optional actions. The title fades in softly when its sentence changes.                                                                      |
| `FlowDiagram`    | `FlowDiagram.tsx`    | Sources → hub → destinations in order. Primary on a solid accent path, backups dashed, unusable faint; dots travel along live routes. Cards reorder by drag or ↑/↓/Home/End and glide. Generic over the card. |
| `flowLayout`     | `flowLayout.ts`      | Pure geometry for the diagram (wide and narrow layouts, paths, drop index, `moveItem`).                                                                                                                    |
| `QuotaRail`      | `QuotaRail.tsx`      | Hairline meter of what is left with a caption such as "54% left this week · resets Tue 9:06 PM". Unknown is never drawn as empty.                                                                         |
| `StatusDot`      | `StatusDot.tsx`      | A coloured dot (the only colour) plus a plain-language label. Tones: ok, warn, bad, off, unknown.                                                                                                          |
| `MoreDisclosure` | `MoreDisclosure.tsx` | The page's single "More": a button with `aria-expanded`/`aria-controls`, a labelled region with an animated height, content kept mounted (inert while closed), optional summary and forced-open note.      |
| `DeviceGlyph`    | `DeviceGlyph.tsx`    | Laptop outline for client sources.                                                                                                                                                                         |
| `TrafficFlow`    | `TrafficFlow.tsx`    | Gateway → providers → accounts, read-only. Path thickness is the share of traffic in the window; travelling dots are recent volume (none for accounts that cannot serve); red flecks are failures. Nested list for assistive technology, SVG `aria-hidden`. |
| `trafficLayout`  | `trafficLayout.ts`   | Pure geometry for TrafficFlow (wide three-column and narrow one-column layouts, paths, `strokeFor`, `dotsFor`).                                                                                           |
| `ActionMenu`     | `ActionMenu.tsx`     | A button that opens a short menu (`aria-haspopup="menu"`, `role="menuitem"`, ↑/↓/Home/End, Escape returns focus). `primary` for a page's one filled action (Accounts' "Add account"), `quiet` for an overflow. |

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
Flow pages; filled buttons are reserved for saving forms inside More or sheets, plus at most one
primary `ActionMenu` per page.

## Pages

| Page     | Main view                                                                                                    | Under More                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Overview | The state sentence (`describeOverview`), TrafficFlow, 5-hour and weekly rails per account, one line of totals | Throughput chart, gateway settings and versions, links to other pages                        |
| Accounts | The state sentence, search, provider tabs (only providers with accounts), one row per account, Add account   | Show filter, sort, list/cards, page size, batch selection, model rules, scoped Delete        |
| Routing  | The order sentence, FlowDiagram of clients → gateway → accounts                                              | Shared strategy, session affinity, per-client rules, client keys                             |
| Quota    | Per-account quota cards and the windows timeline (only providers with accounts get a tab)                    | Sort                                                                                         |

An account row opens its details sheet, which starts with how the account is doing (status, pool,
cooldown, quota, pinned clients) and its one-off actions (models, refresh, download, delete).
Quota outside the Quota page comes from the shared cache through `useAccountQuota`, which re-reads
anything older than five minutes once per visit (`quotaFreshness`).
