import { afterAll, describe, expect, test } from 'bun:test';
import i18n from '@/i18n';
import { buildFlowProviders } from '@/features/overview/flowNodes';
import { buildProviderGroups } from '@/features/overview/overviewModel';
import type { AuthFileItem } from '@/types';

// 20 buckets: a busy morning (old), then a quiet last 30 minutes.
const pattern = (old: number, recent: number) => [
  ...Array.from({ length: 17 }, () => ({ time: '', success: old, failed: 0 })),
  ...Array.from({ length: 3 }, () => ({ time: '', success: recent, failed: 0 })),
];
const files: AuthFileItem[] = [
  {
    id: 'w',
    name: 'w',
    type: 'claude',
    status: 'active',
    note: 'Work',
    priority: 10,
    recent_requests: pattern(10, 2),
  },
  {
    id: 'c',
    name: 'c',
    type: 'codex',
    status: 'active',
    note: 'Codex',
    recent_requests: pattern(0, 6),
  },
];

describe('one time window in the Overview flow', () => {
  const previous = i18n.language;
  afterAll(async () => {
    await i18n.changeLanguage(previous);
  });
  test('provider counts, path weights and account counts all use the last 30 minutes', async () => {
    await i18n.changeLanguage('en');
    const groups = buildProviderGroups({ files, strategy: 'fill-first', sessionAffinity: false });
    const nodes = buildFlowProviders(groups, {
      t: i18n.t.bind(i18n),
      formatWhen: () => '',
      providerLabel: (p) => p,
    });
    const claude = nodes.find((node) => node.id === 'claude')!;
    const codex = nodes.find((node) => node.id === 'codex')!;
    // 3 recent buckets × 2 = 6, not the 176 of the whole window.
    expect(claude.meta).toBe('6 requests');
    expect(codex.meta).toBe('18 requests');
    // Shares follow the recent window: Codex carried more just now.
    expect(codex.share).toBeCloseTo(18 / 24, 5);
    expect(claude.accounts[0].share).toBeCloseTo(6 / 24, 5);
    expect(i18n.t('overview.flow.legend', { lng: 'en' })).toMatch(/^Last 30 minutes/);
  });
});
