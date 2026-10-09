import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import { AccountRow } from '@/features/authFiles/components/AccountRow';
import { AccountSheetSummary } from '@/features/authFiles/components/AccountSheetSummary';
import { presentAccounts } from '@/features/authFiles/accountPresentation';
import { defaultAccountOrder, shouldShowProviderTabs } from '@/features/authFiles/accountsView';
import { NO_QUOTA, genericQuotaIndicator } from '@/features/quota/quotaSummary';
import type { AuthFileItem } from '@/types';

const NOW = 1_000_000;
const file = (name: string, extra: Partial<AuthFileItem> = {}): AuthFileItem => ({
  id: name,
  name,
  type: 'claude',
  status: 'active',
  ...extra,
});

let previous = 'en';
beforeAll(async () => {
  previous = i18n.language;
  await i18n.changeLanguage('en');
});
afterAll(async () => {
  await i18n.changeLanguage(previous);
});

describe('Accounts default order', () => {
  test('Claude in routing order (first, then backup, off last), then Codex and others by name', () => {
    const files = [
      file('z-codex.json', { type: 'codex' }),
      file('personal.json', { priority: 0 }),
      file('kimi.json', { type: 'kimi' }),
      file('old.json', { priority: 50, disabled: true }),
      file('work.json', { priority: 10 }),
      file('a-codex.json', { type: 'codex' }),
    ];
    expect(defaultAccountOrder(files).map((item) => item.name)).toEqual([
      'work.json',
      'personal.json',
      'old.json',
      'a-codex.json',
      'z-codex.json',
      'kimi.json',
    ]);
  });

  test('ties at one priority break by routing ID, as the backend does', () => {
    const files = [
      file('b.json', { id: 'b', priority: 5 }),
      file('a.json', { id: 'a', priority: 5 }),
    ];
    expect(defaultAccountOrder(files).map((item) => item.id)).toEqual(['a', 'b']);
  });
});

describe('provider tabs next to provider headings', () => {
  test('hidden for short lists, shown for longer ones or while a provider filter is on', () => {
    expect(shouldShowProviderTabs(2, 3, 'all')).toBe(false);
    expect(shouldShowProviderTabs(2, 7, 'all')).toBe(true);
    expect(shouldShowProviderTabs(1, 20, 'all')).toBe(false);
    expect(shouldShowProviderTabs(2, 3, 'codex')).toBe(true);
  });
});

describe('quota indicator for any provider', () => {
  test('reads the window closest to its limit from any shape; reset windows are ignored', () => {
    const antigravity = {
      status: 'success',
      groups: [{ buckets: [{ remainingFraction: 0.8 }, { remainingFraction: 0.25 }] }],
    };
    expect(genericQuotaIndicator(antigravity, NOW)).toEqual({
      status: 'ready',
      left: 25,
      window: 'limit',
    });
    const devin = {
      status: 'success',
      windows: [
        { remainingPercent: 10, resetAtMs: NOW - 1 },
        { remainingPercent: 60, resetAtMs: NOW + 1 },
      ],
    };
    expect(genericQuotaIndicator(devin, NOW)).toEqual({
      status: 'ready',
      left: 60,
      window: 'limit',
    });
    expect(
      genericQuotaIndicator({ status: 'success', windows: [{ usedPercent: 70 }] }, NOW)
    ).toEqual({
      status: 'ready',
      left: 30,
      window: 'limit',
    });
    expect(genericQuotaIndicator({ status: 'loading' }, NOW)).toEqual({ status: 'loading' });
    expect(genericQuotaIndicator({ status: 'error' }, NOW)).toBeNull();
    expect(genericQuotaIndicator(undefined, NOW)).toBeNull();
  });

  test('a Kimi row shows its closest limit', () => {
    const kimi = file('kimi.json', { type: 'kimi', note: 'Kimi' });
    const markup = renderToStaticMarkup(
      createElement(AccountRow, {
        file: kimi,
        presentation: presentAccounts([kimi]).get(kimi),
        indicator: { status: 'ready', left: 42, window: 'limit' },
        clientLinks: null,
        selecting: false,
        selected: false,
        toggleDisabled: false,
        entranceIndex: null,
        onOpen: () => {},
        onToggleStatus: () => {},
        onToggleSelect: () => {},
      })
    );
    expect(markup).toContain('42% · closest limit');
    expect(markup).toContain('role="meter"');
  });
});

describe('row switch while its update is in flight', () => {
  test('stays enabled (keeps keyboard focus) instead of being disabled', () => {
    const work = file('work.json', { note: 'Work' });
    const render = (toggleBusy: boolean, toggleDisabled: boolean) =>
      renderToStaticMarkup(
        createElement(AccountRow, {
          file: work,
          presentation: presentAccounts([work]).get(work),
          indicator: null,
          clientLinks: null,
          selecting: false,
          selected: false,
          toggleDisabled,
          toggleBusy,
          entranceIndex: null,
          onOpen: () => {},
          onToggleStatus: () => {},
          onToggleSelect: () => {},
        })
      );
    const switchTag = (markup: string) => markup.match(/<input[^>]*role="switch"[^>]*>/)?.[0] ?? '';
    const busy = switchTag(render(true, false));
    expect(busy).not.toMatch(/\sdisabled=""/);
    expect(busy).toContain('aria-busy="true"');
    expect(busy).toContain('aria-disabled="true"');
    expect(switchTag(render(false, true))).toMatch(/\sdisabled=""/);
  });
});

describe('restored detail', () => {
  test('the details sheet shows the per-account request status bar', () => {
    const work = file('work.json', {
      note: 'Work',
      successCount: 12,
      failureCount: 1,
      recentRequests: [
        { time: '10:00-10:10', success: 5, failed: 0 },
        { time: '10:10-10:20', success: 7, failed: 1 },
      ],
    });
    const noop = () => {};
    const markup = renderToStaticMarkup(
      createElement(AccountSheetSummary, {
        file: work,
        presentation: presentAccounts([work]).get(work),
        quota: NO_QUOTA,
        now: NOW,
        clientLinks: null,
        statusData: null,
        clientRoutesDisabled: false,
        disableControls: false,
        deleting: null,
        statusUpdating: {},
        manualRefreshing: {},
        cooldownResetting: {},
        onShowModels: noop,
        onManualRefresh: noop,
        onCooldownReset: noop,
        onDownload: noop,
        onDelete: noop,
      })
    );
    expect(markup).toContain('12 requests succeeded · 1 failed');
    // The status bar's success rate over its recent blocks (12 of 13).
    expect(markup).toContain('92.3%');
  });
});

describe('Accounts page quota subscription', () => {
  test('selects only the provider maps it reads, never the whole quota store', () => {
    const page = readFileSync('src/features/authFiles/AuthFilesPage.tsx', 'utf8');
    expect(page).not.toMatch(/useQuotaStore\(\s*\)/);
    for (const map of ['antigravityQuota', 'devinQuota', 'kimiQuota', 'metaQuota', 'xaiQuota']) {
      expect(page).toContain(`useQuotaStore((state) => state.${map})`);
    }
  });
});
