import { describe, expect, test } from 'bun:test';
import i18n from '@/i18n';
import {
  buildProviderGroups,
  describeOverview,
  flowVolume,
} from '@/features/overview/overviewModel';
import type { RoutingStrategy } from '@/types/visualConfig';
import type { AuthFileItem } from '@/types';

const buckets = (n: number) => [{ time: '', success: n, failed: 0 }];
const claude = (note: string, extra: Partial<AuthFileItem> = {}): AuthFileItem => ({
  id: note,
  name: `${note}.json`,
  type: 'claude',
  status: 'active',
  note,
  recent_requests: buckets(5),
  ...extra,
});
const cooling = (note: string, extra: Partial<AuthFileItem> = {}) =>
  claude(note, {
    status: 'error',
    unavailable: true,
    next_retry_after: '2099-01-01T00:00:00Z',
    ...extra,
  });
const en = (copy: { key: string; values?: Record<string, unknown> }) =>
  i18n.t(copy.key, { ...copy.values, lng: 'en' });
const say = (files: AuthFileItem[], strategy: RoutingStrategy = 'fill-first') => {
  const groups = buildProviderGroups({ files, strategy, sessionAffinity: false });
  const sentence = describeOverview({
    connection: 'connected',
    groups,
    providerLabel: () => 'Claude',
    formatWhen: () => 'at noon',
    join: (names) => names.join(' and '),
  });
  return {
    groups,
    title: sentence.title.map(en).join(' '),
    subtitle: sentence.subtitle.map(en).join(' '),
  };
};

describe('Overview headline details', () => {
  for (const strategy of ['round-robin', 'weighted-round-robin'] as const) {
    test(`${strategy}: several accounts at the top priority are all named`, () => {
      const { title } = say(
        [
          claude('A', { priority: 10 }),
          claude('B', { priority: 10 }),
          claude('C', { priority: 0 }),
        ],
        strategy
      );
      expect(title).toBe('Everything’s flowing. Claude is shared between A and B.');
    });
  }

  test('a cooling account at the serving priority is not "needs a look": it says who serves', () => {
    const { title, subtitle } = say(
      [cooling('Work', { priority: 10 }), claude('Personal', { priority: 10 })],
      'round-robin'
    );
    expect(title).toBe('Work is cooling down; Personal is serving.');
    expect(subtitle).not.toContain('needs a look');
    expect(subtitle).toContain('Work is back at noon.');
  });

  test('several accounts carrying on read in the plural', () => {
    const { title } = say(
      [
        cooling('A', { priority: 10 }),
        claude('B', { priority: 10 }),
        claude('C', { priority: 10 }),
      ],
      'round-robin'
    );
    expect(title).toBe('A is cooling down; B and C are serving.');
  });

  test('a backup with earlier traffic gets no travelling dots', () => {
    const { groups } = say([claude('Work', { priority: 10 }), claude('Personal', { priority: 0 })]);
    const [work, personal] = groups[0].accounts;
    expect(flowVolume(work, 5)).toBe(1);
    expect(personal.account.role).toBe('backup');
    expect(flowVolume(personal, 5)).toBe(0);
  });
});
