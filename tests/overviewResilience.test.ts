import { describe, expect, test } from 'bun:test';
import i18n from '@/i18n';
import { applyAccountListRead } from '@/features/dashboard/hooks/useDashboardOverview';
import { describeOverview } from '@/features/overview/overviewModel';
import type { AuthFileItem } from '@/types';

const files: AuthFileItem[] = [{ id: 'w', name: 'w', type: 'claude', status: 'active' }];
const en = (copy: { key: string; values?: Record<string, unknown> }) =>
  i18n.t(copy.key, { ...copy.values, lng: 'en' });

describe('Overview when the account list fails', () => {
  test('a failed refresh keeps the last good list and marks it failed', () => {
    const loaded = applyAccountListRead({ files: null, failed: false }, { ok: true, files });
    const failed = applyAccountListRead(loaded, { ok: false });
    expect(failed.files).toBe(files);
    expect(failed.failed).toBe(true);
    expect(applyAccountListRead(failed, { ok: true, files: [] })).toEqual({
      files: [],
      failed: false,
    });
  });

  test('a list that never loaded says so instead of "Checking the gateway…" forever', () => {
    const sentence = describeOverview({
      connection: 'connected',
      groups: null,
      filesFailed: true,
      providerLabel: (p) => p,
      formatWhen: () => '',
      join: (n) => n.join(', '),
    });
    expect(sentence.tone).toBe('bad');
    expect(en(sentence.title[0])).toBe('Can’t read the accounts right now.');
    const loading = describeOverview({
      connection: 'connected',
      groups: null,
      providerLabel: (p) => p,
      formatWhen: () => '',
      join: (n) => n.join(', '),
    });
    expect(en(loading.title[0])).toBe('Checking the gateway…');
  });

  test('the quiet stale note copy exists in every locale', () => {
    for (const lng of ['en', 'zh-CN', 'zh-TW', 'ru', 'vi']) {
      for (const key of [
        'overview.stale.kept',
        'overview.stale.none',
        'overview.stale.retry',
        'overview.hero.unreadable',
      ]) {
        expect(i18n.exists(key, { lng, fallbackLng: false })).toBe(true);
      }
    }
  });
});
