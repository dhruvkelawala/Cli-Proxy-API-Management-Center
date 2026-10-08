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
import { buildAccountClientLinks } from '@/features/clientProfiles/accountLinks';
import {
  CollapsibleSharedRoutingBand,
  SharedBandDisclosure,
} from '@/features/clientProfiles/components/CollapsibleSharedRoutingBand';
import { isSharedBandOpen, sharedBandSummaryParts } from '@/features/clientProfiles/sharedBand';
import type { SharedRoutingBandState } from '@/features/config/routing/SharedRoutingBand';
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

/** CPA-003: enforcement on, strict requests enforced. */
const enforcedCapabilities: ClientProfilesCapabilities = {
  ...capabilities,
  enforcement: true,
  strictRequests: 'enforced',
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

  test('a saved unavailable target stays visible and selected with its will-fail warning', () => {
    const markup = sheet(2);
    expect(markup).toContain(t('client_routes.editor.question', { provider: 'Claude' }));
    // Automatic, Only Claude A, and the saved Only Claude B.
    expect(markup.match(/type="radio"/g)).toHaveLength(3);
    expect(markup).toContain(t('client_routes.editor.will_fail_desc', { account: 'Claude B' }));
    expect(markup).toContain(t('client_routes.editor.session_note'));
  });

  test('an unavailable account is not offered as a new Only choice (the gateway returns 422)', () => {
    const markup = sheet(0);
    // Automatic and Only Claude A only; Claude B is explained, not selectable.
    expect(markup.match(/type="radio"/g)).toHaveLength(2);
    expect(markup).toContain(t('client_routes.editor.status_will_fail'));
    expect(markup).toContain(
      t('client_routes.editor.unavailable_choice_desc', { account: 'Claude B' })
    );
    expect(markup).not.toContain(t('client_routes.editor.will_fail_desc', { account: 'Claude B' }));
  });

  test('session note matches the contract: saving ends existing sessions', () => {
    expect(t('client_routes.editor.session_note')).toContain('ends');
    expect(t('client_routes.editor.session_note')).not.toContain('keep their old rule');
  });

  test('enforcement off: a strict profile with keys warns that requests are rejected', () => {
    expect(sheet(2)).toContain(t('client_routes.editor.strict_keys_warning', { count: 1 }));
  });

  test('CPA-003 enforcement on: no not-enforced warning in the editor', () => {
    const markup = render(
      createElement(PolicySheet, {
        open: true,
        profile: snapshot.profiles[2],
        provider: 'claude',
        snapshot,
        capabilities: enforcedCapabilities,
        files,
        pool: buildPoolPreview('claude', files, 'round-robin'),
        context: null,
        onClose: noop,
        onDirtyChange: noop,
        onOpenProfile: noop,
      })
    );
    expect(markup).not.toContain(t('client_routes.editor.strict_keys_warning', { count: 1 }));
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

describe('notices and account links', () => {
  test('enforcement off is a calm notice that does not announce active selection', () => {
    const markup = render(createElement(EnforcementNotice, { capabilities }));
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

  test('a refused Only rule names the provider from the error field', () => {
    const markup = render(
      createElement(FailureNotice, {
        failure: {
          kind: 'target_invalid',
          error: { status: 422, code: 'target_unavailable', field: 'policies.codex' },
        },
      })
    );
    expect(markup).toContain(
      t('client_routes.errors.target_invalid_provider', {
        provider: 'Codex',
        reason: i18n.t('client_routes.states.target_unavailable'),
      })
    );
    const noField = render(
      createElement(FailureNotice, {
        failure: {
          kind: 'target_invalid',
          error: { status: 422, code: 'target_unavailable', field: null },
        },
      })
    );
    expect(noField).toContain(
      t('client_routes.errors.target_invalid', {
        reason: i18n.t('client_routes.states.target_unavailable'),
      })
    );
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

describe('collapsible shared routing band', () => {
  const savedState = (overrides: Partial<SharedRoutingBandState> = {}): SharedRoutingBandState => ({
    saved: { strategy: 'round-robin', sessionAffinity: false, sessionAffinityTtl: '' },
    dirty: false,
    attention: false,
    ...overrides,
  });
  const disclosure = (open: boolean, forced: boolean, state: SharedRoutingBandState | null) =>
    render(
      createElement(
        SharedBandDisclosure,
        {
          open,
          forced,
          summary: sharedBandSummaryParts(i18n.t, state),
          onToggle: noop,
        },
        createElement('p', null, 'BAND CONTENT')
      )
    );
  const attr = (markup: string, name: string) => markup.match(new RegExp(`${name}="([^"]+)"`))?.[1];

  test('collapsed by default: one summary row and an Edit disclosure controlling a hidden region', () => {
    const markup = render(createElement(CollapsibleSharedRoutingBand, { automaticClientCount: 3 }));
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain(t('client_routes.shared_band.edit'));
    expect(markup).toContain(`aria-label="${t('client_routes.shared_band.edit_aria')}"`);
    const controls = attr(markup, 'aria-controls');
    expect(controls).toBeTruthy();
    expect(markup).toMatch(new RegExp(`id="${controls}"[^>]*hidden=""`));
  });

  test('the summary names the saved strategy and conversation affinity', () => {
    const parts = sharedBandSummaryParts(i18n.t, savedState());
    expect(parts).toEqual([
      i18n.t('client_routes.shared_band.label'),
      i18n.t('config_management.routing_settings.strategy.round_robin'),
      i18n.t('client_routes.shared_band.affinity_off'),
    ]);
    expect(
      sharedBandSummaryParts(
        i18n.t,
        savedState({
          saved: { strategy: 'fill-first', sessionAffinity: true, sessionAffinityTtl: '1h' },
        })
      )[2]
    ).toBe(i18n.t('client_routes.shared_band.affinity_on_ttl', { ttl: '1h' }));
    expect(sharedBandSummaryParts(i18n.t, null)[1]).toBe(
      i18n.t('client_routes.shared_band.loading')
    );
  });

  test('expanded shows the band inline with a Hide control', () => {
    const markup = disclosure(true, false, savedState());
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain(t('client_routes.shared_band.hide'));
    expect(markup).toContain('BAND CONTENT');
    expect(markup).not.toContain('hidden=""');
  });

  test('unsaved edits or a save error force it open and explain why it cannot collapse', () => {
    expect(isSharedBandOpen(false, savedState())).toBe(false);
    expect(isSharedBandOpen(false, savedState({ dirty: true }))).toBe(true);
    expect(isSharedBandOpen(false, savedState({ attention: true }))).toBe(true);
    expect(isSharedBandOpen(false, null)).toBe(false);
    const markup = disclosure(true, true, savedState({ dirty: true }));
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain(t('client_routes.shared_band.locked'));
    expect(markup).not.toContain('hidden=""');
  });
});

describe('CPA-003 enforcement', () => {
  test('the not-enforced banner shows while enforcement is off and hides once enforced', () => {
    expect(render(createElement(EnforcementNotice, { capabilities }))).toContain(
      t('client_routes.enforcement.title')
    );
    expect(render(createElement(EnforcementNotice, { capabilities: enforcedCapabilities }))).toBe(
      ''
    );
  });

  test('profile keys drop the strict-rejection warning once enforced', () => {
    const keysSheet = (caps: ClientProfilesCapabilities) =>
      render(
        createElement(ProfileSheet, {
          open: true,
          mode: 'edit',
          profile: snapshot.profiles[2],
          snapshot,
          capabilities: caps,
          context: null,
          apiKeys: [RAW_CLIENT_KEY],
          wsAuth: true,
          apiBase: 'http://127.0.0.1:1',
          onContextChange: noop,
          onClose: noop,
          onDirtyChange: noop,
        })
      );
    expect(keysSheet(capabilities)).toContain(t('client_routes.keys.strict_warning'));
    expect(keysSheet(enforcedCapabilities)).not.toContain(t('client_routes.keys.strict_warning'));
  });
});
