import { describe, expect, test } from 'bun:test';
import i18n from '@/i18n';
import { buildOrder } from '@/features/clientProfiles/routing/routingOrder';
import { summarizeQuota } from '@/features/quota/quotaSummary';
import {
  accountStatusCopy,
  buildProviderGroups,
  describeOverview,
} from '@/features/overview/overviewModel';
import type { AuthFileItem } from '@/types';

const NOW = Date.UTC(2026, 9, 9, 12);
const HOUR = 3_600_000;
const state = (sessionUsed: number) => ({
  status: 'success' as const,
  windows: [
    { usedPercent: sessionUsed, resetAtMs: NOW + HOUR, periodHours: 5 },
    { usedPercent: 40, resetAtMs: NOW + 50 * HOUR, periodHours: 168 },
  ],
});
const work: AuthFileItem = {
  id: 'w',
  name: 'w',
  type: 'claude',
  status: 'active',
  note: 'Work',
  priority: 10,
};
const personal: AuthFileItem = {
  id: 'p',
  name: 'p',
  type: 'claude',
  status: 'active',
  note: 'Personal',
};
const en = (copy: { key: string; values?: Record<string, unknown> }) =>
  i18n.t(copy.key, { ...copy.values, lng: 'en' });

const overview = (sessionUsed: number) => {
  const quotaFor = (file: AuthFileItem) =>
    file === work ? summarizeQuota(state(sessionUsed), NOW) : summarizeQuota(undefined);
  const groups = buildProviderGroups({
    files: [work, personal],
    strategy: 'fill-first',
    sessionAffinity: false,
    quotaFor,
  });
  const sentence = describeOverview({
    connection: 'connected',
    groups,
    providerLabel: () => 'Claude',
    formatWhen: () => 'soon',
    join: (names) => names.join(' and '),
  });
  return { groups, text: [...sentence.title, ...sentence.subtitle].map(en).join(' ') };
};

describe('about to run out vs at the limit', () => {
  test('99.6% used rounds to 0% left but is not out yet', () => {
    const summary = summarizeQuota(state(99.6), NOW);
    expect(summary.sessionLeft).toBe(0);
    expect(summary.sessionExhausted).toBe(false);
    expect(summarizeQuota(state(100), NOW).sessionExhausted).toBe(true);
  });

  test('at 99.6% Work still serves and the Overview says it is about to run out', () => {
    const { groups, text } = overview(99.6);
    const [first] = groups[0].model.order;
    expect(first.label).toBe('Work');
    expect(first.role).toBe('active');
    expect(first.health).toBe('available');
    expect(first.nearlyOut).toBe(true);
    expect(text).toContain('Claude is on Work.');
    expect(text).toContain('Work is about to run out.');
    expect(text).not.toContain('switched');
    expect(en(accountStatusCopy(first, () => 'soon').copy)).toBe('Serving, about to run out');
  });

  test('at 100% the Overview says Work is out and Claude switched', () => {
    const { text } = overview(100);
    expect(text).toContain('Work is out of room; Claude switched to Personal.');
  });

  test('older summaries without the raw fact keep the 0%-left rule', () => {
    const model = buildOrder({
      files: [work, personal],
      provider: 'claude',
      strategy: 'fill-first',
      sessionAffinity: false,
      quotaFor: (file) =>
        file === work
          ? {
              status: 'ready',
              sessionLeft: 0,
              sessionResetAt: null,
              weekLeft: 50,
              weekResetAt: null,
            }
          : {
              status: 'none',
              sessionLeft: null,
              sessionResetAt: null,
              weekLeft: null,
              weekResetAt: null,
            },
    });
    expect(model.order.find((a) => a.label === 'Work')?.health).toBe('limit');
  });

  test('the new copy exists in all five locales', () => {
    for (const lng of ['en', 'zh-CN', 'zh-TW', 'ru', 'vi']) {
      for (const key of [
        'routing.health.nearly_out',
        'overview.hero.nearly_out_one',
        'overview.hero.nearly_out_many',
        'overview.state.serving_nearly_out',
      ]) {
        expect(i18n.exists(key, { lng, fallbackLng: false })).toBe(true);
      }
    }
  });
});
