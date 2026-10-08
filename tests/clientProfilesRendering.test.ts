import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import { ClientRoutesMatrix } from '@/features/clientProfiles/components/ClientRoutesMatrix';
import { PolicyPill } from '@/features/clientProfiles/components/PolicyPill';
import { PolicyPreview } from '@/features/clientProfiles/components/PolicyPreview';
import { PolicySheet } from '@/features/clientProfiles/components/PolicySheet';
import { ProfileSheet } from '@/features/clientProfiles/components/ProfileSheet';
import { AccountClientLinks } from '@/features/clientProfiles/components/AccountClientLinks';
import { EnforcementNotice, FailureNotice } from '@/features/clientProfiles/components/Notices';
import { SharedPoolSlot } from '@/features/clientProfiles/components/SharedPoolSlot';
import { buildAccountClientLinks } from '@/features/clientProfiles/accountLinks';
import {
  buildPoolPreview,
  buildProfileRows,
  credentialRefForAuthFile,
} from '@/features/clientProfiles/model';
import type { AuthFileItem } from '@/types';
import type {
  ClientProfileAccount,
  ClientProfilesCapabilities,
  ClientProfilesSnapshot,
} from '@/types/clientProfiles';

const RAW_CLIENT_KEY = 'sk-raw-client-key-fixture-0001';
const RAW_TOKEN = 'oauth-access-token-fixture';
const A_REF = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B_REF = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const P1 = '10000000-0000-4000-8000-000000000001';
const P2 = '10000000-0000-4000-8000-000000000002';
const P3 = '10000000-0000-4000-8000-000000000003';

const files: AuthFileItem[] = [
  {
    id: 'a.json',
    name: 'a.json',
    type: 'claude',
    status: 'active',
    note: 'Claude A',
    access_token: RAW_TOKEN,
  },
  {
    id: 'b.json',
    name: 'b.json',
    type: 'claude',
    status: 'disabled',
    disabled: true,
    note: 'Claude B',
  },
  { id: 'c.json', name: 'c.json', type: 'codex', status: 'pending', note: 'Codex seat' },
];

const account = (
  file: AuthFileItem,
  extra: Partial<ClientProfileAccount>
): ClientProfileAccount => ({
  credentialRef: credentialRefForAuthFile(file) as string,
  accountRef: null,
  provider: String(file.type),
  label: `${file.type} credential`,
  available: true,
  state: 'available',
  enrollmentSupported: true,
  targetSupported: true,
  ...extra,
});

const snapshot: ClientProfilesSnapshot = {
  revision: '"r1"',
  profiles: [
    {
      profileRef: P1,
      label: 'Mini · T3 Claude',
      revision: 1,
      policies: { claude: { mode: 'automatic' }, codex: { mode: 'automatic' } },
    },
    {
      profileRef: P2,
      label: 'MacBook · T3 Claude',
      revision: 1,
      policies: { claude: { mode: 'only', accountRef: A_REF }, codex: { mode: 'automatic' } },
    },
    {
      profileRef: P3,
      label: 'MacBook · T3 Claude B',
      revision: 1,
      policies: { claude: { mode: 'only', accountRef: B_REF }, codex: { mode: 'automatic' } },
    },
  ],
  keys: [{ keyRef: 'k1', label: 'MacBook key', profileRef: P3, revision: 1 }],
  accounts: [
    account(files[0], { accountRef: A_REF }),
    account(files[1], { accountRef: B_REF, available: false, state: 'unavailable' }),
    account(files[2], { state: 'not_enrolled' }),
  ],
  targetStates: {
    [P1]: { claude: 'automatic', codex: 'automatic' },
    [P2]: { claude: 'available', codex: 'automatic' },
    [P3]: { claude: 'target_unavailable', codex: 'automatic' },
  },
};

const capabilities: ClientProfilesCapabilities = {
  contractVersion: 1,
  management: true,
  enforcement: false,
  strictRequests: 'rejected',
  providers: ['claude', 'codex'],
  modes: ['automatic', 'only'],
  sessionBehavior: 'fresh_session_required',
  bindingRequires: [],
  enrollmentStores: ['file'],
  enrollmentStorage: [],
  unsupported: [],
};

const render = (element: ReactElement) =>
  renderToStaticMarkup(createElement(MemoryRouter, null, element));
/** Translated text as it appears in static markup (HTML-escaped). */
const t = (key: string, options?: Record<string, unknown>) =>
  String(i18n.t(key, options))
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
const noop = () => {};
const rows = buildProfileRows(snapshot, files, 'round-robin');

let previousLanguage = 'en';
beforeAll(async () => {
  previousLanguage = i18n.language;
  await i18n.changeLanguage('en');
});
afterAll(async () => {
  await i18n.changeLanguage(previousLanguage);
});

describe('client routes matrix', () => {
  // Rendered lazily: the language switches to English in beforeAll.
  const matrix = () =>
    render(
      createElement(ClientRoutesMatrix, {
        rows,
        contexts: { [P2]: 'macbook_tunnel', [P1]: 'mini_local' },
        onOpenCell: noop,
        onOpenProfile: noop,
      })
    );

  test('every cell is a labelled button naming provider, profile and policy', () => {
    expect(matrix()).toContain(
      `aria-label="${t('client_routes.matrix.cell_label', {
        provider: 'Claude',
        profile: 'MacBook · T3 Claude',
        policy: `${t('client_routes.pill.only', { account: 'Claude A' })}, ${t('client_routes.pill.available')}`,
      })}"`
    );
    expect(matrix().match(/<button/g)).toHaveLength(3 + 6);
  });

  test('Automatic shows an illustrative share; Only is a strong pill; a disabled target will fail', () => {
    expect(matrix()).toContain(
      t('client_routes.pill.share', { account: 'Claude A', percent: 100 })
    );
    expect(matrix()).toContain(t('client_routes.pill.only', { account: 'Claude B' }));
    expect(matrix()).toContain(t('client_routes.pill.will_fail'));
    expect(matrix()).toContain(t('client_routes.states.target_unavailable'));
  });

  test('connection context is configured topology; unset stays unset', () => {
    expect(matrix()).toContain(t('client_routes.connection.path_macbook_tunnel'));
    expect(matrix()).toContain(t('client_routes.connection.unset'));
    expect(matrix()).not.toMatch(/served by/i);
  });

  test('never renders raw keys or OAuth metadata', () => {
    expect(matrix()).not.toContain(RAW_TOKEN);
    expect(matrix()).not.toContain(RAW_CLIENT_KEY);
  });
});

describe('policy pills and previews', () => {
  test('unknown pool availability is labelled, not guessed', () => {
    const unknownPool = buildPoolPreview('claude', null, 'round-robin');
    const markup = render(
      createElement(PolicyPill, {
        cell: { kind: 'automatic', provider: 'claude', pool: unknownPool, willFail: false },
      })
    );
    expect(markup).toContain(t('client_routes.pill.pool_unknown'));
  });

  test('a removed Only target will fail and names no substitute', () => {
    const markup = render(
      createElement(PolicyPill, {
        cell: {
          kind: 'only',
          provider: 'claude',
          accountRef: 'gone',
          account: null,
          accountLabel: null,
          state: 'target_removed',
          willFail: true,
        },
      })
    );
    expect(markup).toContain(
      t('client_routes.pill.only', { account: t('client_routes.pill.removed_account') })
    );
    expect(markup).toContain(t('client_routes.states.target_removed'));
  });

  test('Only preview: configured target plus strict failure behaviour', () => {
    const ok = render(
      createElement(PolicyPreview, {
        kind: 'only',
        providerName: 'Claude',
        accountLabel: 'Claude A',
        state: 'available',
      })
    );
    expect(ok).toContain(t('client_routes.preview.configured_target'));
    expect(ok).toContain(
      t('client_routes.preview.only_ok', { provider: 'Claude', account: 'Claude A' })
    );
    expect(ok).toContain(t('client_routes.preview.only_note'));
    const fail = render(
      createElement(PolicyPreview, {
        kind: 'only',
        providerName: 'Claude',
        accountLabel: 'Claude B',
        state: 'target_unavailable',
      })
    );
    expect(fail).toContain(
      t('client_routes.preview.only_fail', {
        provider: 'Claude',
        reason: t('client_routes.states.target_unavailable'),
      })
    );
  });

  test('Automatic preview lists the eligible pool and why others are excluded', () => {
    const markup = render(
      createElement(PolicyPreview, {
        kind: 'automatic',
        providerName: 'Claude',
        pool: buildPoolPreview('claude', files, 'round-robin'),
      })
    );
    expect(markup).toContain('Claude A');
    expect(markup).toContain(t('config_management.routing_presentation.reason.disabled'));
    expect(markup).toContain(t('client_routes.preview.shares_note'));
  });
});

describe('editor sheet', () => {
  const sheet = (profileIndex: number) =>
    render(
      createElement(PolicySheet, {
        open: true,
        profile: snapshot.profiles[profileIndex],
        provider: 'claude',
        snapshot,
        capabilities,
        files,
        pool: buildPoolPreview('claude', files, 'round-robin'),
        context: 'macbook_tunnel',
        onClose: noop,
        onDirtyChange: noop,
        onOpenProfile: noop,
      })
    );

  test('offers Automatic and Only options; disabled targets stay selectable with a will-fail warning', () => {
    const markup = sheet(2);
    expect(markup).toContain(t('client_routes.editor.question', { provider: 'Claude' }));
    expect(markup.match(/type="radio"/g)).toHaveLength(3);
    expect(markup).toContain(t('client_routes.editor.will_fail_desc', { account: 'Claude B' }));
    expect(markup).toContain(t('client_routes.editor.session_note'));
  });

  test('enforcement off: a strict profile with keys warns that requests are rejected', () => {
    expect(sheet(2)).toContain(t('client_routes.editor.strict_keys_warning', { count: 1 }));
  });

  test('unenrolled accounts get a one-click prepare action instead of a radio', () => {
    const markup = render(
      createElement(PolicySheet, {
        open: true,
        profile: snapshot.profiles[0],
        provider: 'codex',
        snapshot,
        capabilities,
        files,
        pool: buildPoolPreview('codex', files, 'round-robin'),
        context: null,
        onClose: noop,
        onDirtyChange: noop,
        onOpenProfile: noop,
      })
    );
    expect(markup).toContain(t('client_routes.editor.enroll'));
    expect(markup).toContain(
      t('client_routes.editor.needs_enrollment_desc', { account: 'Codex seat' })
    );
    expect(markup.match(/type="radio"/g)).toHaveLength(1);
  });

  test('a profile that disappeared explains instead of offering a save', () => {
    const markup = render(
      createElement(PolicySheet, {
        open: true,
        profile: null,
        provider: 'claude',
        snapshot,
        capabilities,
        files,
        pool: buildPoolPreview('claude', files, 'round-robin'),
        context: null,
        onClose: noop,
        onDirtyChange: noop,
        onOpenProfile: noop,
      })
    );
    expect(markup).toContain(t('client_routes.errors.not_found'));
    expect(markup).not.toContain(t('client_routes.editor.save'));
  });
});

describe('profile sheet keys', () => {
  test('key values never reach the DOM, only labels and masked choices', () => {
    const markup = render(
      createElement(ProfileSheet, {
        open: true,
        mode: 'edit',
        profile: snapshot.profiles[2],
        snapshot,
        capabilities,
        context: null,
        apiKeys: [RAW_CLIENT_KEY],
        wsAuth: true,
        apiBase: 'http://127.0.0.1:1',
        onContextChange: noop,
        onClose: noop,
        onDirtyChange: noop,
      })
    );
    expect(markup).toContain('MacBook key');
    expect(markup).toContain(t('client_routes.keys.value_hidden'));
    expect(markup).not.toContain(RAW_CLIENT_KEY);
    expect(markup).toContain(t('client_routes.profile.delete_blocked', { count: 1 }));
  });
});

describe('notices, shared pool slot and account links', () => {
  test('enforcement off is a calm notice that does not announce active selection', () => {
    const markup = render(createElement(EnforcementNotice));
    expect(markup).toContain(t('client_routes.enforcement.title'));
    expect(markup).not.toContain('role="alert"');
  });

  test('a stale save explains and offers Reload; it never claims success', () => {
    const markup = render(
      createElement(FailureNotice, {
        failure: { kind: 'stale', error: { status: 412, code: 'stale_revision', field: null } },
        onReload: noop,
      })
    );
    expect(markup).toContain(t('client_routes.errors.stale'));
    expect(markup).toContain(t('client_routes.errors.reload'));
    expect(markup).toContain('role="alert"');
    expect(markup).not.toContain(t('client_routes.editor.saved'));
  });

  test('the shared pool slot is read-only and links to Config', () => {
    const markup = render(
      createElement(SharedPoolSlot, {
        automaticClientCount: 3,
        strategy: 'fill-first',
        affinity: false,
      })
    );
    expect(markup).toContain(t('client_routes.shared_pool.strategies.fill_first'));
    expect(markup).toContain('href="/config?field=routingStrategy"');
    expect(markup).not.toContain('<input');
  });

  test('account cards show pinned clients and will-fail when the account is off', () => {
    const links = buildAccountClientLinks(files, snapshot);
    const b = links.get(files[1]);
    expect(b?.pinned.map((pin) => pin.label)).toEqual(['MacBook · T3 Claude B']);
    const markup = render(
      createElement(AccountClientLinks, {
        links: b as NonNullable<typeof b>,
        accountName: 'Claude B',
        disabled: false,
        onUseOnlyFor: noop,
      })
    );
    expect(markup).toContain('MacBook · T3 Claude B');
    expect(markup).toContain(t('client_routes.pill.will_fail'));
    expect(markup).toContain(t('client_routes.accounts.use_only'));
    expect(links.get(files[2])?.action).toBe('enroll');
  });
});

describe('client routes locales', () => {
  const flatten = (value: unknown, prefix = ''): Record<string, string> =>
    value && typeof value === 'object'
      ? Object.entries(value).reduce<Record<string, string>>(
          (all, [key, child]) => ({ ...all, ...flatten(child, prefix ? `${prefix}.${key}` : key) }),
          {}
        )
      : { [prefix]: String(value) };
  const baseKey = (key: string) => key.replace(/_(zero|one|two|few|many|other)$/, '');
  const tokens = (text: string) => (text.match(/\{\{[^}]+\}\}/g) ?? []).sort().join('|');

  test('every client routes string exists in all five locales with the same placeholders', async () => {
    const read = async (locale: string) =>
      flatten(
        (await Bun.file(`src/i18n/locales/${locale}.json`).json()) as Record<string, unknown>
      );
    const en = await read('en');
    const enKeys = Object.keys(en).filter(
      (key) => key.startsWith('client_routes.') || key.endsWith('.client_routes')
    );
    for (const locale of ['zh-CN', 'zh-TW', 'ru', 'vi']) {
      const other = await read(locale);
      const otherBases = new Set(Object.keys(other).map(baseKey));
      const missing = enKeys.filter((key) => !(key in other) && !otherBases.has(baseKey(key)));
      expect({ locale, missing }).toEqual({ locale, missing: [] });
      const mismatched = enKeys.filter((key) => {
        const match = other[key] ?? other[baseKey(key)] ?? other[`${baseKey(key)}_other`];
        return match !== undefined && tokens(match) !== tokens(en[key]);
      });
      expect({ locale, mismatched }).toEqual({ locale, mismatched: [] });
    }
  });
});
