import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import { RoutingSection } from '@/features/clientProfiles/routing/RoutingSection';
import {
  buildOrder,
  describeClientRoutes,
  describeClientsLine,
  describeServing,
  isSingleAccount,
  planReorder,
  routingProviders,
  type QuotaSummary,
} from '@/features/clientProfiles/routing/routingOrder';
import {
  makeGuardedUndo,
  reorderInFlight,
  runExclusiveReorder,
  runReorder,
  type ReorderEffects,
} from '@/features/clientProfiles/routing/reorderFlow';
import { credentialRefForAuthFile } from '@/features/clientProfiles/model';
import type { AuthFileItem } from '@/types';
import type { ClientProfilesSnapshot } from '@/types/clientProfiles';

const account = (
  id: string,
  type: string,
  note: string,
  extra: Partial<AuthFileItem> = {}
): AuthFileItem => ({ id, name: id, type, status: 'active', note, ...extra });

const work = account('claude-work.json', 'claude', 'Work', { priority: 10 });
const personal = account('claude-personal.json', 'claude', 'Personal');
const codexA = account('codex-a.json', 'codex', 'dhruv@example.test', { priority: 10 });
const codexB = account('codex-b.json', 'codex', 'Team seat');
const gemini = account('gemini.json', 'gemini', 'Gemini key');
const antigravity = account('ag.json', 'antigravity', 'AG');
const ALL = [codexA, gemini, personal, work, antigravity, codexB];

const orderOf = (files: AuthFileItem[], provider: string) =>
  buildOrder({ files, provider, strategy: 'fill-first', sessionAffinity: true });

const render = (element: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(createElement(MemoryRouter, null, element));
const esc = (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
const t = (key: string, options?: Record<string, unknown>) => esc(String(i18n.t(key, options)));
const noop = () => {};
const join = (names: string[]) => names.join(' and ');
const when = () => 'Tue 9:06 PM';

let previousLanguage = 'en';
beforeAll(async () => {
  previousLanguage = i18n.language;
  await i18n.changeLanguage('en');
});
afterAll(async () => {
  await i18n.changeLanguage(previousLanguage);
});

describe('provider sections', () => {
  test('one section per provider with accounts: Claude, Codex, then the rest alphabetically', () => {
    expect(routingProviders(ALL)).toEqual(['claude', 'codex', 'antigravity', 'gemini']);
    expect(routingProviders([codexA])).toEqual(['codex']);
    expect(routingProviders([gemini, codexA])).toEqual(['codex', 'gemini']);
    expect(routingProviders([])).toEqual([]);
    // Unrecognisable accounts get no section.
    expect(routingProviders([account('x.json', '', 'X')])).toEqual([]);
  });

  test('a provider whose accounts are all turned off still gets a section (to list them as Off)', () => {
    const off = account('codex-off.json', 'codex', 'Old', { disabled: true });
    expect(routingProviders([work, off])).toEqual(['claude', 'codex']);
    const model = orderOf([work, off], 'codex');
    expect(model.order).toEqual([]);
    expect(model.off.map((a) => a.label)).toEqual(['Old']);
    expect(describeServing(model, join, when, 'Codex').title).toEqual({
      key: 'routing.title_all_off',
      values: { provider: 'Codex' },
    });
  });

  test('single vs multiple accounts per provider', () => {
    expect(isSingleAccount(orderOf(ALL, 'claude'))).toBe(false);
    expect(isSingleAccount(orderOf([work, codexA], 'codex'))).toBe(true);
    expect(isSingleAccount(orderOf(ALL, 'codex'))).toBe(false);
    // A turned-off second account does not make it "multiple".
    const offB = { ...codexB, disabled: true };
    expect(isSingleAccount(orderOf([codexA, offB], 'codex'))).toBe(true);
  });

  test('one Codex account: "Codex uses <account>." and no backup', () => {
    expect(describeServing(orderOf([work, codexA], 'codex'), join, when, 'Codex')).toEqual({
      title: {
        key: 'routing.title_single',
        values: { provider: 'Codex', account: 'dhruv@example.test' },
      },
      follow: { key: 'routing.follow_single', values: { provider: 'Codex' } },
    });
    expect(i18n.t('routing.title_single', { provider: 'Codex', account: 'a@b.c' })).toBe(
      'Codex uses a@b.c.'
    );
  });

  test('each provider builds its order from its own accounts only', () => {
    expect(orderOf(ALL, 'claude').order.map((a) => a.label)).toEqual(['Work', 'Personal']);
    expect(orderOf(ALL, 'codex').order.map((a) => a.label)).toEqual([
      'dhruv@example.test',
      'Team seat',
    ]);
  });
});

describe('per-provider write isolation', () => {
  type Patch = [string, unknown];
  const effects = (patches: Patch[]): ReorderEffects => ({
    connectionRevision: () => 1,
    patchAccount: async (name, patch) => {
      patches.push([name, patch]);
    },
    isPageOpen: () => true,
    setOverrides: noop,
    setSaving: noop,
    reloadFiles: async () => null,
    notifyAccountsChanged: noop,
    notify: noop,
    t: (key) => key,
    firstLabelIn: () => null,
  });

  test('a Codex reorder writes only Codex priorities', async () => {
    const patches: Patch[] = [];
    const codex = orderOf(ALL, 'codex');
    const outcome = await runReorder(
      codex.order,
      ['codex-b.json', 'codex-a.json'],
      effects(patches)
    );
    expect(outcome).toBe('saved');
    expect(patches).toEqual([['codex-b.json', { priority: 20 }]]);
    expect(patches.every(([name]) => name.startsWith('codex-'))).toBe(true);
  });

  test('a Claude reorder writes only Claude priorities', async () => {
    const patches: Patch[] = [];
    await runReorder(
      orderOf(ALL, 'claude').order,
      ['claude-personal.json', 'claude-work.json'],
      effects(patches)
    );
    expect(patches).toEqual([['claude-personal.json', { priority: 20 }]]);
  });

  test('ids from another provider are never planned or written', async () => {
    const codex = orderOf(ALL, 'codex').order;
    expect(planReorder(codex, ['claude-work.json', 'codex-a.json'])).toEqual([]);
    expect(planReorder(codex, ['codex-b.json', 'codex-a.json', 'claude-work.json'])).toEqual([]);
    expect(planReorder(codex, ['codex-b.json', 'codex-b.json'])).toEqual([]);
    const patches: Patch[] = [];
    expect(
      await runReorder(codex, ['claude-work.json', 'claude-personal.json'], effects(patches))
    ).toBe('noop');
    expect(patches).toEqual([]);
  });

  test('one reorder at a time per provider: Claude writing does not block Codex', async () => {
    let release = () => {};
    const claude = runExclusiveReorder(
      41,
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      'claude'
    );
    expect(reorderInFlight(41, 'claude')).not.toBeNull();
    expect(reorderInFlight(41, 'codex')).toBeNull();
    let codexRan = false;
    expect(
      await runExclusiveReorder(
        41,
        async () => {
          codexRan = true;
        },
        'codex'
      )
    ).toBe(true);
    expect(codexRan).toBe(true);
    // A second Claude reorder waits its turn.
    expect(await runExclusiveReorder(41, async () => undefined, 'claude')).toBe(false);
    release();
    await claude;
  });

  test("Undo for one provider only waits on that provider's save", async () => {
    let release = () => {};
    const claude = runExclusiveReorder(
      51,
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      'claude'
    );
    let applied = false;
    const codexUndo = makeGuardedUndo({
      connectionRevision: () => 51,
      isPageOpen: () => true,
      apply: async () => {
        applied = true;
      },
      scope: 'codex',
    });
    expect(await codexUndo()).toBe('applied');
    expect(applied).toBe(true);
    release();
    await claude;
  });
});

describe('Routing section rendering', () => {
  const weekly = (left: number): QuotaSummary => ({
    status: 'ready',
    sessionLeft: 80,
    sessionResetAt: null,
    weekLeft: left,
    weekResetAt: Date.now() + 40 * 3_600_000,
  });
  const section = (
    files: AuthFileItem[],
    provider: string,
    name: string,
    primary: boolean,
    routes: ReturnType<typeof describeClientRoutes> | null = null
  ) =>
    render(
      createElement(RoutingSection, {
        provider,
        name,
        primary,
        model: buildOrder({
          files,
          provider,
          strategy: 'fill-first',
          sessionAffinity: true,
          quotaFor: () => weekly(61),
        }),
        routes,
        hubLabel: 'Gateway',
        saving: false,
        simulateOut: null,
        formatWhen: when,
        joinNames: join,
        onReorder: noop,
        onPreview: noop,
      })
    );

  test('a single Codex account has no reorder controls, Make first or preview', () => {
    const markup = section([work, codexA], 'codex', 'Codex', false);
    expect(markup).toContain(
      t('routing.title_single', { provider: 'Codex', account: 'dhruv@example.test' })
    );
    expect(markup.match(/role="listitem"/g)).toHaveLength(1);
    expect(markup).not.toContain('data-grip');
    expect(markup).not.toContain('data-reorderable="true"');
    expect(markup).not.toContain(t('routing.reorder_hint'));
    expect(markup).not.toContain(t('routing.hint.drag'));
    expect(markup).not.toContain('Make ');
    expect(markup).not.toContain('Preview:');
    // Health and quota with the reset time, like any card.
    expect(markup).toContain(t('routing.health.available'));
    expect(markup).toContain('aria-valuenow="61"');
    expect(markup).toContain(t('routing.rank.only'));
  });

  test('two Codex accounts get the full flow: reorder, Make first, preview', () => {
    const markup = section(ALL, 'codex', 'Codex', false);
    expect(markup.match(/data-grip=""/g)).toHaveLength(2);
    expect(markup).toContain(t('routing.reorder_hint'));
    expect(markup).toContain(t('routing.preview_start', { account: 'dhruv@example.test' }));
    expect(markup).toContain(t('routing.rank.first'));
    expect(markup).toContain(t('routing.rank.backup'));
    expect(markup).toContain(`aria-label="${t('routing.list_label', { provider: 'Codex' })}"`);
  });

  test('the first section carries the page headline; later ones a smaller h2', () => {
    const first = section(ALL, 'claude', 'Claude', true);
    const later = section(ALL, 'codex', 'Codex', false);
    expect(first).toMatch(/<h1[^>]*>/);
    expect(first).not.toMatch(/<h2[^>]*data-level/);
    expect(later).toMatch(/<h2[^>]*data-level="section"/);
    expect(later).not.toContain('<h1');
    // Each section is labelled by its own headline and names its provider in the eyebrow.
    expect(later).toMatch(/<section[^>]*aria-labelledby="[^"]+"[^>]*data-provider="codex"/);
    expect(later).toContain('>Codex</p>');
  });

  test("a section's clients line comes from each profile's rule for that provider", () => {
    const CODEX_REF = 'acct-codex';
    const snapshot: ClientProfilesSnapshot = {
      revision: '"r"',
      profiles: [
        {
          profileRef: 'p-mini',
          label: 'Mini · Claude',
          revision: 1,
          policies: { claude: { mode: 'automatic' }, codex: { mode: 'automatic' } },
        },
        {
          profileRef: 'p-mbp',
          label: 'MacBook · Claude',
          revision: 1,
          policies: {
            claude: { mode: 'automatic' },
            codex: { mode: 'only', accountRef: CODEX_REF },
          },
        },
      ],
      keys: [],
      accounts: [
        {
          credentialRef: credentialRefForAuthFile(codexA) as string,
          accountRef: CODEX_REF,
          provider: 'codex',
          label: 'codex',
          available: true,
          state: 'available',
          enrollmentSupported: true,
          targetSupported: true,
        },
      ],
      targetStates: { 'p-mbp': { codex: 'available' } },
    };
    const codexModel = buildOrder({
      files: ALL,
      provider: 'codex',
      strategy: 'fill-first',
      sessionAffinity: true,
      inventory: snapshot.accounts,
    });
    const codexRoutes = describeClientRoutes(snapshot, 'codex', codexModel.order);
    expect(describeClientsLine(codexRoutes, join).copies).toEqual([
      { key: 'routing.clients.one', values: { names: 'Mini' } },
      {
        key: 'routing.clients.locked',
        values: { client: 'MacBook', account: 'dhruv@example.test' },
      },
    ]);
    // One account: clients "use this account", not "this order".
    expect(describeClientsLine(codexRoutes, join, true).copies[0]).toEqual({
      key: 'routing.clients.single_one',
      values: { names: 'Mini' },
    });
    // Claude: both follow. Providers without profile rules: every client follows.
    expect(describeClientsLine(describeClientRoutes(snapshot, 'claude', []), join).copies).toEqual([
      { key: 'routing.clients.two', values: { names: 'Mini and MacBook' } },
    ]);
    expect(
      describeClientRoutes(snapshot, 'gemini', []).map((route) => [route.shortName, route.locked])
    ).toEqual([
      ['Mini', false],
      ['MacBook', false],
    ]);
  });
});
