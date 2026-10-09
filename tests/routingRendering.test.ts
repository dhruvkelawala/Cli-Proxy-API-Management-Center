import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, RouterProvider, createMemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import { MoreDisclosure } from '@/components/flow';
import { SidebarMoreGroup } from '@/components/layout/SidebarMoreGroup';
import {
  buildSidebarNav,
  flattenNavItems,
  type SidebarIconKey,
} from '@/components/layout/navModel';
import { RoutingSection } from '@/features/clientProfiles/routing/RoutingSection';
import { RoutingMore } from '@/features/clientProfiles/routing/RoutingMore';
import { RoutingPage } from '@/features/clientProfiles/RoutingPage';
import {
  buildOrder,
  describeClientRoutes,
  profilesSupportNoticeKey,
  type QuotaSummary,
} from '@/features/clientProfiles/routing/routingOrder';
import { credentialRefForAuthFile } from '@/features/clientProfiles/model';
import type { AuthFileItem } from '@/types';
import type { ClientProfilesSnapshot } from '@/types/clientProfiles';

const render = (element: ReactElement) =>
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
const when = () => 'Sun 2:17 AM';

const RAW_TOKEN = 'oauth-access-token-fixture';
const work: AuthFileItem = {
  id: 'work.json',
  name: 'work.json',
  type: 'claude',
  status: 'active',
  note: 'Work',
  priority: 10,
  access_token: RAW_TOKEN,
};
const personal: AuthFileItem = {
  id: 'personal.json',
  name: 'personal.json',
  type: 'claude',
  status: 'active',
  note: 'Personal',
};
const weekly = (left: number, inHours: number): QuotaSummary => ({
  status: 'ready',
  sessionLeft: 70,
  sessionResetAt: null,
  weekLeft: left,
  weekResetAt: Date.now() + inHours * 3_600_000,
});

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
      policies: { claude: { mode: 'only', accountRef: 'acct-work' }, codex: { mode: 'automatic' } },
    },
  ],
  keys: [{ keyRef: 'k1', label: 'MacBook key', profileRef: 'p-mbp', revision: 1 }],
  accounts: [
    {
      credentialRef: credentialRefForAuthFile(work) as string,
      accountRef: 'acct-work',
      provider: 'claude',
      label: 'claude',
      available: true,
      state: 'available',
      enrollmentSupported: true,
      targetSupported: true,
    },
  ],
  targetStates: { 'p-mbp': { claude: 'available' } },
};

const model = (simulateOut: string | null = null) =>
  buildOrder({
    files: [work, personal],
    provider: 'claude',
    strategy: 'fill-first',
    sessionAffinity: true,
    inventory: snapshot.accounts,
    quotaFor: (file) => (file === work ? weekly(54, 100) : weekly(78, 38)),
    simulateOut,
  });

const hero = (overrides: Partial<Parameters<typeof RoutingSection>[0]> = {}) => {
  const m = overrides.model ?? model();
  return render(
    createElement(RoutingSection, {
      provider: 'claude',
      name: 'Claude',
      primary: true,
      model: m,
      routes: describeClientRoutes(
        { ...snapshot, profiles: [snapshot.profiles[0]] },
        'claude',
        m.order
      ),
      hubLabel: 'Gateway',
      saving: false,
      simulateOut: null,
      formatWhen: when,
      joinNames: join,
      onReorder: noop,
      onPreview: noop,
      ...overrides,
    })
  );
};

let previousLanguage = 'en';
beforeAll(async () => {
  previousLanguage = i18n.language;
  await i18n.changeLanguage('en');
});
afterAll(async () => {
  await i18n.changeLanguage(previousLanguage);
});

describe('Routing hero', () => {
  test('the headline is the outcome sentence, with the fallback under it', () => {
    const markup = hero();
    expect(markup).toContain(`<h1`);
    expect(markup).toContain(t('routing.title_first', { account: 'Work' }));
    expect(markup).toContain(t('routing.follow_backup', { account: 'Work', backup: 'Personal' }));
    expect(markup).toContain('aria-live="polite"');
  });

  test('accounts are an ordered, keyboard-reorderable list with health and weekly quota', () => {
    const markup = hero();
    expect(markup).toContain(
      `role="list" aria-label="${t('routing.list_label', { provider: 'Claude' })}"`
    );
    expect(markup.match(/role="listitem"/g)).toHaveLength(2);
    expect(markup.match(/tabindex="0"/g)?.length).toBeGreaterThanOrEqual(2);
    expect(markup).toContain(t('routing.reorder_hint'));
    expect(markup).toContain(t('routing.rank.first'));
    expect(markup).toContain(t('routing.rank.backup'));
    expect(markup).toContain(t('routing.health.available'));
    expect(markup).toContain('role="meter"');
    expect(markup).toContain('aria-valuenow="54"');
    expect(markup).toContain(t('routing.quota.week_left_reset', { percent: 78, when: when() }));
    expect(markup).toMatch(/aria-label="First: Work\. Available\. 54% left this week/);
  });

  test('resets-sooner hint offers "Make Personal first"; preview is a pressed toggle', () => {
    const markup = hero();
    expect(markup).toContain(t('routing.make_first', { account: 'Personal' }));
    expect(markup).toContain(t('routing.preview_start', { account: 'Work' }));
    expect(markup).toContain('aria-pressed="false"');
    const previewing = hero({ model: model('work.json'), simulateOut: 'work.json' });
    expect(previewing).toContain(t('routing.title_fallback', { out: 'Work', account: 'Personal' }));
    expect(previewing).toContain(t('routing.follow_preview'));
    expect(previewing).toContain(t('routing.preview_end'));
    expect(previewing).toContain('aria-pressed="true"');
  });

  test('one line for clients following the order; the old one-line Codex text is gone', () => {
    const markup = hero();
    expect(markup).toContain(t('routing.clients.one', { names: 'Mini' }));
    expect(markup).not.toContain('Nothing to choose');
  });

  test('a locked client is listed with its account', () => {
    const m = model();
    const markup = hero({ routes: describeClientRoutes(snapshot, 'claude', m.order) });
    expect(markup).toContain(t('routing.clients.locked', { client: 'MacBook', account: 'Work' }));
  });

  test('saving announces itself and disables "Make first"; raw credentials never render', () => {
    const markup = hero({ saving: true });
    expect(markup).toContain(t('routing.saving'));
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Make Personal first/);
    expect(markup).not.toContain(RAW_TOKEN);
  });
});

describe('Routing More', () => {
  const more = () =>
    render(
      createElement(RoutingMore, {
        band: createElement('p', null, 'SHARED BAND'),
        routes: describeClientRoutes(snapshot, 'claude', model().order),
        snapshot,
        files: [work, personal],
        onEditRule: noop,
        onOpenProfile: noop,
      })
    );

  test('holds the shared band, per-client locks with the strict warning, and client keys', () => {
    const markup = more();
    expect(markup).toContain('SHARED BAND');
    expect(markup).toContain(t('routing.more_sections.locks'));
    expect(markup).toContain(t('routing.rule.claude', { rule: t('routing.rule.follows') }));
    expect(markup).toContain(
      t('routing.rule.claude', { rule: t('routing.rule.only', { account: 'Work' }) })
    );
    expect(markup).toContain(
      t('routing.rule.strict_warning', { client: 'MacBook', account: 'Work' })
    );
    expect(markup).toContain(t('routing.rule.codex', { rule: t('routing.rule.automatic') }));
    expect(markup).toContain(t('routing.keys.count', { count: 1 }));
    expect(markup).toContain(t('routing.keys.none'));
    expect(markup).toContain(t('routing.keys.new_client'));
    expect(markup).toContain(`aria-label="${t('routing.rule.change_aria', { client: 'Mini' })}"`);
    expect(markup).toContain('data-cell="p-mbp:claude"');
  });

  test('without client profiles only the band shows', () => {
    const markup = render(
      createElement(RoutingMore, {
        band: createElement('p', null, 'SHARED BAND'),
        routes: null,
        snapshot: null,
        files: null,
        onEditRule: noop,
        onOpenProfile: noop,
      })
    );
    expect(markup).toContain('SHARED BAND');
    expect(markup).not.toContain(t('routing.more_sections.locks'));
    expect(markup).not.toContain(t('routing.more_sections.clients'));
  });
});

describe('MoreDisclosure', () => {
  const disclosure = (props: Partial<Parameters<typeof MoreDisclosure>[0]> = {}) =>
    render(
      createElement(
        MoreDisclosure,
        { label: 'More', summary: 'Concentrate on one', ...props },
        createElement('p', null, 'RARE OPTIONS')
      )
    );
  const attr = (markup: string, name: string) => markup.match(new RegExp(`${name}="([^"]+)"`))?.[1];

  test('collapsed by default: a button controlling an inert, labelled region', () => {
    const markup = disclosure();
    expect(markup).toContain('aria-expanded="false"');
    const controls = attr(markup, 'aria-controls');
    expect(markup).toMatch(new RegExp(`id="${controls}" role="region" aria-labelledby="[^"]+"`));
    expect(markup).toMatch(/role="region"[^>]*inert=""/);
    expect(markup).toContain('Concentrate on one');
    // Content stays mounted so drafts inside survive collapsing.
    expect(markup).toContain('RARE OPTIONS');
  });

  test('open drops inert and the summary; forced open explains why it stays open', () => {
    const open = disclosure({ defaultOpen: true });
    expect(open).toContain('aria-expanded="true"');
    expect(open).not.toMatch(/role="region"[^>]*inert=""/);
    expect(open).not.toContain('Concentrate on one');
    const forced = disclosure({ forcedOpen: true, forcedNote: 'Save or discard first.' });
    expect(forced).toContain('aria-expanded="true"');
    expect(forced).toContain('aria-disabled="true"');
    expect(forced).toContain('Save or discard first.');
  });
});

describe('Routing page shell', () => {
  test('renders a loading state and a collapsed More before data arrives', () => {
    // The unsaved-changes guard needs a data router.
    const router = createMemoryRouter([{ path: '/', element: createElement(RoutingPage) }]);
    const markup = renderToStaticMarkup(createElement(RouterProvider, { router }));
    expect(markup).toContain(t('routing.loading'));
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain(`>${t('routing.more')}<`);
  });
});

describe('sidebar navigation rendering', () => {
  const icons = new Proxy({}, { get: () => null }) as Record<SidebarIconKey, null>;
  const nav = buildSidebarNav({ icons, supportsPlugin: false, authFilesCount: 3 });
  const group = (open: boolean, activePath: string | null, showLabels = true) =>
    render(
      createElement(SidebarMoreGroup, {
        open,
        onToggle: noop,
        showLabels,
        label: i18n.t('nav.more'),
        items: nav.more,
        activeLink: activePath
          ? (flattenNavItems(nav.more).find((item) => item.path === activePath) ?? null)
          : null,
        renderItem: (item) =>
          createElement('a', { key: 'path' in item ? item.path : item.id, 'data-item': '' }, 'x'),
        renderLink: (item) => createElement('a', { key: item.path, 'data-pinned': item.path }, 'x'),
      })
    );

  test('primary labels read Overview, Routing, Accounts and Quota', () => {
    expect(flattenNavItems(nav.primary).map((item) => i18n.t(item.labelKey ?? ''))).toEqual([
      'Overview',
      'Routing',
      'Accounts',
      'Quota',
    ]);
  });

  test('More is a disclosure: collapsed list is inert; the active More page stays visible', () => {
    const collapsed = group(false, '/config');
    expect(collapsed).toContain('aria-expanded="false"');
    expect(collapsed).toContain('aria-controls="sidebar-nav-more"');
    expect(collapsed).toMatch(/class="nav-more-inner" inert=""/);
    expect(collapsed).toContain('data-pinned="/config"');
    expect(collapsed.match(/data-item=""/g)).toHaveLength(nav.more.length);

    const expanded = group(true, '/config');
    expect(expanded).toContain('aria-expanded="true"');
    expect(expanded).not.toContain('inert=""');
    expect(expanded).not.toContain('data-pinned');
  });

  test('in the collapsed rail the toggle is named by aria-label', () => {
    expect(group(false, null, false)).toContain(`aria-label="${t('nav.more')}"`);
    expect(group(false, null, true)).not.toContain('aria-label=');
  });
});

describe('review fixes: rendering', () => {
  test('turned-off accounts show below as Off and are not reorderable cards', () => {
    const m = buildOrder({
      files: [
        work,
        personal,
        { ...personal, id: 'old.json', name: 'old.json', note: 'Old', disabled: true },
      ],
      provider: 'claude',
      strategy: 'fill-first',
      sessionAffinity: true,
    });
    const markup = hero({ model: m });
    expect(markup.match(/role="listitem"/g)).toHaveLength(2);
    expect(markup).toContain(`aria-label="${t('routing.off_list_label', { provider: 'Claude' })}"`);
    expect(markup).toMatch(/Off<\/span><span[^>]*>Old<\/span>/);
  });

  test('a fill-first tie is labelled First/Backup with the tie explained', () => {
    const m = buildOrder({
      files: [{ ...work, priority: 0 }, personal],
      provider: 'claude',
      strategy: 'fill-first',
      sessionAffinity: true,
    });
    const markup = hero({ model: m });
    expect(markup).not.toContain(`>${t('routing.rank.shared')}<`);
    expect(markup).toContain(
      t('routing.follow_tie', { accounts: 'Personal and Work', account: 'Personal' })
    );
  });

  test('notices render in the main view, after the provider sections, not inside More', () => {
    const page = readFileSync(
      new URL('../src/features/clientProfiles/RoutingPage.tsx', import.meta.url),
      'utf8'
    );
    expect(page).toContain('<div className={styles.notices}>{notices}</div>');
    expect(page.indexOf('<div className={styles.notices}>{notices}</div>')).toBeLessThan(
      page.indexOf('<MoreDisclosure')
    );
  });

  test('More flags a Codex Only rule that will fail', () => {
    const withCodexLock: ClientProfilesSnapshot = {
      ...snapshot,
      profiles: [
        {
          ...snapshot.profiles[0],
          policies: { claude: { mode: 'automatic' }, codex: { mode: 'only', accountRef: 'gone' } },
        },
      ],
      targetStates: { 'p-mini': { codex: 'target_removed' } },
    };
    const markup = render(
      createElement(RoutingMore, {
        band: null,
        routes: describeClientRoutes(withCodexLock, 'claude', []),
        snapshot: withCodexLock,
        files: null,
        onEditRule: noop,
        onOpenProfile: noop,
      })
    );
    expect(markup).toContain(t('routing.rule.codex_will_fail', { client: 'Mini' }));
    // Clients and keys stay available even without the Accounts list.
    expect(markup).toContain(t('routing.keys.new_client'));
  });

  test('unsupported and incompatible gateways get their own notices in the main view', () => {
    expect(profilesSupportNoticeKey('ready', null)).toBeNull();
    expect(profilesSupportNoticeKey('unsupported', 'not_found')).toBe(
      'routing.profiles_unsupported'
    );
    expect(profilesSupportNoticeKey('unsupported', 'incompatible_contract')).toBe(
      'routing.profiles_incompatible'
    );
    const page = readFileSync(
      new URL('../src/features/clientProfiles/RoutingPage.tsx', import.meta.url),
      'utf8'
    );
    // Notices go to the main view; More takes no notices prop.
    expect(page.slice(page.indexOf('<RoutingMore'))).not.toContain('notices=');
  });
});
