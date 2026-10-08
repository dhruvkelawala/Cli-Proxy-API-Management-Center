import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import {
  isAccountDisabled,
  presentAccounts,
  resolveAccountAvailability,
  summarizeAccounts,
} from '../src/features/authFiles/accountPresentation';
import { isProblemAuthFile } from '../src/features/authFiles/constants';
import { buildCredentialHealth } from '../src/features/dashboard/hooks/useDashboardOverview';
import { gatewayDisplayHost } from '../src/utils/connection';
import type { AuthFileItem } from '../src/types';

const authFile = (overrides: Partial<AuthFileItem> = {}): AuthFileItem => ({
  name: 'credential.json',
  type: 'claude',
  status: 'active',
  ...overrides,
});

const credentialCooldown = (remainingSeconds: number) => ({
  receivedAtMs: 0,
  records: [
    {
      scope: 'credential' as const,
      reason: 'quota',
      retryAt: '2026-10-08T10:07:00Z',
      remainingSeconds,
    },
  ],
});

// Synthetic fleet shared by the Accounts page and the dashboard overview.
const claudeA = authFile({
  name: 'claude-a.json',
  email: 'claude-a@example.test',
  priority: 10,
  note: 'Work subscription',
});
const claudeB = authFile({
  name: 'claude-b.json',
  email: 'claude-b@example.test',
  disabled: true,
  status: 'disabled',
  statusMessage: 'disabled via management API',
});
const claudeCooling = authFile({
  name: 'claude-c.json',
  email: 'claude-c@example.test',
  status: 'error',
  unavailable: true,
  statusMessage: 'quota exhausted (429)',
  priority: 20,
  cooldownSnapshot: credentialCooldown(420),
});
const codex = authFile({ name: 'codex.json', type: 'codex', email: 'codex@example.test' });
const fleet = [claudeA, claudeB, claudeCooling, codex];

describe('account availability', () => {
  test('separates deliberate disablement from availability', () => {
    expect(isAccountDisabled(claudeB)).toBe(true);
    expect(resolveAccountAvailability(claudeB)).toBeNull();
    expect(isAccountDisabled(authFile({ status: ' DISABLED ' }))).toBe(true);
    expect(isAccountDisabled(claudeA)).toBe(false);
  });

  test('an optimistic re-enable reads enabled with unknown availability until refresh', () => {
    const reenabled = { ...claudeB, disabled: false };
    expect(isAccountDisabled(reenabled)).toBe(false);
    expect(resolveAccountAvailability(reenabled)).toBe('unknown');
    expect(presentAccounts([claudeA, reenabled]).get(reenabled)).toMatchObject({
      poolRole: 'backup',
    });
  });

  test('names enabled availability states', () => {
    expect(resolveAccountAvailability(claudeA)).toBe('available');
    expect(resolveAccountAvailability(claudeCooling)).toBe('coolingDown');
    expect(
      resolveAccountAvailability(
        authFile({ unavailable: true, status: 'error', next_retry_after: '2026-10-08T10:07:00Z' })
      )
    ).toBe('coolingDown');
    expect(resolveAccountAvailability(authFile({ unavailable: true, status: 'error' }))).toBe(
      'attention'
    );
    expect(resolveAccountAvailability(authFile({ status: 'error' }))).toBe('attention');
    expect(resolveAccountAvailability(authFile({ statusMessage: 'token revoked' }))).toBe(
      'attention'
    );
    expect(resolveAccountAvailability(authFile({ status: 'refreshing' }))).toBe('unknown');
    expect(resolveAccountAvailability(authFile({ status: undefined }))).toBe('unknown');
  });

  test('elapsed cooldown evidence is not reported as cooling down', () => {
    expect(
      resolveAccountAvailability(
        authFile({ unavailable: true, status: 'error', cooldownSnapshot: credentialCooldown(0) })
      )
    ).toBe('attention');
  });

  test('needs-attention states are exactly the Problem filter', () => {
    const cases = [
      ...fleet,
      authFile({ unavailable: true }),
      authFile({ status: 'error' }),
      authFile({ statusMessage: 'ok' }),
      authFile({ statusMessage: 'quota exhausted' }),
      authFile({ status: 'pending' }),
      authFile({ disabled: true, unavailable: true, statusMessage: 'quota exhausted' }),
      authFile({ disabled: false, status: 'disabled', unavailable: true }),
    ];
    for (const file of cases) {
      const availability = resolveAccountAvailability(file);
      expect(availability === 'coolingDown' || availability === 'attention').toBe(
        isProblemAuthFile(file)
      );
    }
  });
});

describe('named account counts', () => {
  test('counts enabled, available, needs-attention and disabled separately', () => {
    expect(summarizeAccounts(fleet)).toEqual({
      total: 4,
      enabled: 3,
      disabled: 1,
      available: 2,
      coolingDown: 1,
      attention: 0,
      needsAttention: 1,
      unknown: 0,
    });
  });

  test('the dashboard overview reports the same counts as the Accounts page', () => {
    const accounts = summarizeAccounts(fleet);
    const health = buildCredentialHealth(fleet);
    expect(health.total).toBe(accounts.total);
    expect(health.available).toBe(accounts.available);
    expect(health.needsAttention).toBe(accounts.needsAttention);
    expect(health.unknown).toBe(accounts.unknown);
    expect(health.disabled).toBe(accounts.disabled);
    expect(health.available + health.needsAttention + health.unknown + health.disabled).toBe(
      health.total
    );
    expect(health.byType).toEqual([
      { type: 'claude', count: 3 },
      { type: 'codex', count: 1 },
    ]);
  });

  test('a deliberately disabled account never counts as needing attention', () => {
    const counts = summarizeAccounts([
      authFile({ disabled: true, unavailable: true, statusMessage: 'quota exhausted' }),
    ]);
    expect(counts.disabled).toBe(1);
    expect(counts.needsAttention).toBe(0);
  });
});

describe('pool preference', () => {
  test('describes each account role inside its provider pool', () => {
    const claudeD = authFile({ name: 'claude-d.json', email: 'claude-d@example.test' });
    const roles = presentAccounts([...fleet, claudeD]);
    expect(roles.get(claudeA)).toMatchObject({ poolRole: 'preferred', provider: 'claude' });
    expect(roles.get(claudeD)).toMatchObject({ poolRole: 'backup' });
    // Higher priority does not make an unavailable account preferred.
    expect(roles.get(claudeCooling)).toMatchObject({ poolRole: 'skipped' });
    expect(roles.get(claudeB)).toMatchObject({ poolRole: 'excluded', availability: null });
    expect(roles.get(codex)).toMatchObject({ poolRole: 'sole', provider: 'codex' });
  });

  test('a stale warning without unavailable keeps the account in the pool, like the backend', () => {
    const healthy = authFile({ name: 'healthy.json', priority: 0 });
    const warned = authFile({
      name: 'warned.json',
      priority: 0,
      statusMessage: 'request failed earlier',
      unavailable: false,
    });
    const roles = presentAccounts([healthy, warned]);
    expect(roles.get(healthy)).toMatchObject({ poolRole: 'shared', peers: 1 });
    expect(roles.get(warned)).toMatchObject({
      poolRole: 'shared',
      peers: 1,
      availability: 'attention',
    });
    // Counts still treat the warning as needing attention (== Problem filter).
    expect(summarizeAccounts([healthy, warned]).needsAttention).toBe(1);
  });

  test('an error status alone does not skip the account; unavailable does', () => {
    const errored = authFile({ name: 'errored.json', status: 'error', priority: 9 });
    const other = authFile({ name: 'other.json', priority: 1 });
    expect(presentAccounts([errored, other]).get(errored)).toMatchObject({
      poolRole: 'preferred',
      availability: 'attention',
    });
    const blocked = { ...errored, unavailable: true };
    expect(presentAccounts([blocked, other]).get(blocked)).toMatchObject({ poolRole: 'skipped' });
    expect(presentAccounts([blocked, other]).get(other)).toMatchObject({ poolRole: 'sole' });
  });

  test('role copy only claims what the listed accounts show', () => {
    const en = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8')) as {
      auth_files: Record<string, string>;
    };
    const roleCopy = Object.entries(en.auth_files)
      .filter(([key]) => key.startsWith('pool_'))
      .map(([, value]) => value);
    for (const copy of roleCopy) expect(copy).not.toMatch(/usable|preferred for/i);
    expect(en.auth_files.pool_attention).toBe('May still be selected');
  });

  test('equal top priorities share new sessions', () => {
    const one = authFile({ name: 'one.json', priority: 3 });
    const two = authFile({ name: 'two.json', priority: 3 });
    const three = authFile({ name: 'three.json', priority: 3 });
    const roles = presentAccounts([one, two, three]);
    expect(roles.get(one)).toMatchObject({ poolRole: 'shared', peers: 2 });
    expect(roles.get(three)).toMatchObject({ poolRole: 'shared', peers: 2 });
  });

  test('a lone available account is the only one serving its pool', () => {
    const roles = presentAccounts([claudeA, claudeB, claudeCooling]);
    expect(roles.get(claudeA)).toMatchObject({ poolRole: 'sole' });
  });
});

describe('bulk selection is separate from routing', () => {
  test('toggling a selection only changes local selection state', () => {
    const source = readFileSync('src/features/authFiles/hooks/useAuthFilesData.ts', 'utf8');
    const block = source.slice(
      source.indexOf('  const toggleSelect = useCallback('),
      source.indexOf('  const selectAllVisible = useCallback(')
    );
    const js = ts.transpileModule(`${block}\nreturn toggleSelect;`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText;
    let selected = new Set<string>();
    const forbidden = new Proxy(
      {},
      {
        get() {
          throw new Error('selection must not call the management API');
        },
      }
    );
    const toggle = new Function('useCallback', 'setSelectedFiles', 'authFilesApi', 'apiClient', js)(
      (fn: unknown) => fn,
      (update: (prev: Set<string>) => Set<string>) => {
        selected = update(selected);
      },
      forbidden,
      forbidden
    ) as (name: string) => void;

    toggle('claude-b.json');
    expect([...selected]).toEqual(['claude-b.json']);
    toggle('claude-b.json');
    expect([...selected]).toEqual([]);
  });

  test('routing presentation does not take selection as an input', () => {
    expect(presentAccounts.length).toBe(1);
    const source = readFileSync('src/features/authFiles/accountPresentation.ts', 'utf8');
    expect(source).not.toMatch(/selected|selection/i);
  });
});

describe('shared gateway context', () => {
  test('shows only the configured host and port', () => {
    expect(gatewayDisplayHost('http://127.0.0.1:8317')).toBe('127.0.0.1:8317');
    expect(gatewayDisplayHost('https://gateway.example.test/v8/management?token=x')).toBe(
      'gateway.example.test'
    );
    expect(gatewayDisplayHost('http://user:secret@gateway.example.test:9000/')).toBe(
      'gateway.example.test:9000'
    );
    expect(gatewayDisplayHost('localhost:8317')).toBe('localhost:8317');
    expect(gatewayDisplayHost('')).toBe('');
    expect(gatewayDisplayHost('http://bad host')).toBe('');
  });
});

describe('account presentation locales', () => {
  const locales = ['en', 'zh-CN', 'zh-TW', 'ru', 'vi'];
  const keys = [
    'auth_files.account_state_available',
    'auth_files.account_state_cooling',
    'auth_files.account_state_attention',
    'auth_files.account_state_unknown',
    'auth_files.account_state_off',
    'auth_files.pool_preferred',
    'auth_files.pool_sole',
    'auth_files.pool_backup',
    'auth_files.pool_skipped',
    'auth_files.pool_excluded',
    'auth_files.meta_unknown',
    'auth_files.pool_attention',
    'auth_files.details_routing_scope',
    'dashboard.stat_credentials_hint_unknown',
    'auth_files.gateway_context',
    'auth_files.gateway_context_unknown',
    'auth_files.status_toggle_enabled',
    'auth_files.status_toggle_disabled',
    'auth_files.card_toggle_enabled',
    'auth_files.card_toggle_disabled',
    'auth_files.details_purpose_title',
    'auth_files.details_routing_title',
    'auth_files.details_routing_hint',
    'auth_files.details_settings_title',
    'auth_files.details_advanced_title',
    'auth_files.details_advanced_hint',
    'auth_files.prefix_hint',
    'dashboard.health_available',
    'dashboard.health_attention',
    'dashboard.health_unknown',
    'sidebar.gateway',
  ];
  const lookup = (messages: Record<string, unknown>, path: string): unknown =>
    path
      .split('.')
      .reduce<unknown>(
        (node, part) =>
          node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined,
        messages
      );

  for (const locale of locales) {
    test(`${locale} defines every account presentation string`, () => {
      const messages = JSON.parse(
        readFileSync(`src/i18n/locales/${locale}.json`, 'utf8')
      ) as Record<string, unknown>;
      for (const key of keys) {
        expect({ key, value: typeof lookup(messages, key) }).toEqual({ key, value: 'string' });
      }
      const pluralBase = (key: string) =>
        lookup(messages, key) ?? lookup(messages, `${key}_one`) ?? lookup(messages, `${key}_other`);
      for (const key of [
        'auth_files.pool_shared',
        'auth_files.meta_attention',
        'auth_files.meta_total',
        'auth_files.meta_available',
        'auth_files.meta_disabled',
        'auth_files.card_select',
      ]) {
        expect({ key, value: typeof pluralBase(key) }).toEqual({ key, value: 'string' });
      }
      // Removed ambiguous wording must not linger in any locale.
      expect(lookup(messages, 'auth_files.meta_active')).toBeUndefined();
      expect(lookup(messages, 'auth_files.status_toggle_label')).toBeUndefined();
      expect(lookup(messages, 'dashboard.health_active')).toBeUndefined();
    });
  }

  test('names the page "Accounts" while file actions keep file wording', () => {
    const en = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8')) as Record<
      string,
      Record<string, string>
    >;
    expect(en.nav.auth_files).toBe('Accounts');
    expect(en.auth_files.title).toBe('Accounts');
    expect(en.auth_files.meta_total_other).toBe('{{count}} accounts');
    expect(en.auth_files.prefix_proxy_button).toBe('Account details');
    expect(en.dashboard.stat_credentials).toBe('Accounts');
    expect(en.auth_files.upload_button).toBe('Upload File');
  });
});
