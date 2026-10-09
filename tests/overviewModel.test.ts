import { describe, expect, test } from 'bun:test';
import i18n from '@/i18n';
import {
  buildProviderGroups,
  describeOverview,
  durationCopy,
  flowFailures,
  flowStateOf,
  flowVolume,
  joinSentences,
  trafficOf,
  type ProviderGroup,
} from '@/features/overview/overviewModel';
import type { Copy } from '@/features/clientProfiles/routing/routingOrder';
import type { QuotaSummary } from '@/features/quota/quotaSummary';
import type { AuthFileItem } from '@/types';

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 9, 9, 12, 0, 0);

const buckets = (pattern: Array<[number, number]>) =>
  pattern.map(([success, failed]) => ({ time: '00:00-00:10', success, failed }));

const work = (extra: Partial<AuthFileItem> = {}): AuthFileItem => ({
  id: 'work.json',
  name: 'work.json',
  type: 'claude',
  status: 'active',
  note: 'Work',
  priority: 10,
  recent_requests: buckets([
    [10, 0],
    [12, 1],
    [14, 0],
    [13, 0],
  ]),
  ...extra,
});
const personal = (extra: Partial<AuthFileItem> = {}): AuthFileItem => ({
  id: 'personal.json',
  name: 'personal.json',
  type: 'claude',
  status: 'active',
  note: 'Personal',
  priority: 0,
  recent_requests: buckets([
    [0, 0],
    [1, 0],
    [0, 0],
    [0, 0],
  ]),
  ...extra,
});
const codex: AuthFileItem = {
  id: 'codex.json',
  name: 'codex.json',
  type: 'codex',
  status: 'active',
  note: 'Codex',
  recent_requests: buckets([
    [3, 0],
    [4, 0],
    [2, 0],
    [5, 0],
  ]),
};
/** Work hit its limit: the backend marks it unavailable with a retry deadline. */
const cooling = (retryAt: number) =>
  work({
    status: 'error',
    status_message: 'rate limited',
    unavailable: true,
    next_retry_after: new Date(retryAt).toISOString(),
    recent_requests: buckets([
      [12, 0],
      [14, 0],
      [9, 2],
      [0, 1],
    ]),
  });

const groupsOf = (files: AuthFileItem[], quotaFor?: (file: AuthFileItem) => QuotaSummary) =>
  buildProviderGroups({ files, strategy: 'fill-first', sessionAffinity: false, quotaFor });

const label = (provider: string) =>
  provider === 'claude' ? 'Claude' : provider === 'codex' ? 'Codex' : provider;
const formatWhen = (ms: number) => `at ${new Date(ms).toISOString().slice(11, 16)}`;
const join = (names: string[]) => names.join(' and ');

const describe_ = (groups: ProviderGroup[] | null, connection = 'connected') =>
  describeOverview({ connection, groups, providerLabel: label, formatWhen, join });

const english = (copies: Copy[]) =>
  joinSentences(
    copies.map((copy) => i18n.t(copy.key, { ...copy.values, lng: 'en' })),
    'en'
  );

describe('Overview sentence', () => {
  test('all healthy: says it is flowing and who Claude is on, then the backup and Codex', () => {
    const sentence = describe_(groupsOf([work(), personal(), codex]));
    expect(sentence.tone).toBe('ok');
    expect(english(sentence.title)).toBe('Everything’s flowing. Claude is on Work.');
    expect(english(sentence.subtitle)).toBe(
      'If Work runs out, Claude switches to Personal. Codex is running.'
    );
  });

  test('Work cooling down: names the switch and when Work is back', () => {
    const retryAt = NOW + 2 * HOUR;
    const sentence = describe_(groupsOf([cooling(retryAt), personal(), codex]));
    expect(sentence.tone).toBe('warn');
    expect(english(sentence.title)).toBe('Work is cooling down; Claude switched to Personal.');
    expect(english(sentence.subtitle)).toBe(
      `Work is back ${formatWhen(retryAt)}. Codex is running.`
    );
  });

  test('Work out of weekly room (quota at 0) reads as out of room, not cooling', () => {
    const quotaFor = (file: AuthFileItem): QuotaSummary =>
      file.name === 'work.json'
        ? {
            status: 'ready',
            sessionLeft: 40,
            sessionResetAt: null,
            weekLeft: 0,
            weekResetAt: NOW + 30 * HOUR,
          }
        : {
            status: 'none',
            sessionLeft: null,
            sessionResetAt: null,
            weekLeft: null,
            weekResetAt: null,
          };
    const sentence = describe_(groupsOf([work(), personal()], quotaFor));
    expect(english(sentence.title)).toBe('Work is out of room; Claude switched to Personal.');
  });

  test('no Claude account can serve: bad tone, says so first', () => {
    const sentence = describe_(groupsOf([cooling(NOW + HOUR), codex]));
    expect(sentence.tone).toBe('bad');
    expect(english(sentence.title)).toBe('Claude has no account that can serve right now.');
  });

  test('many failures lead the headline', () => {
    const failing = work({
      recent_requests: buckets([
        [5, 5],
        [4, 6],
      ]),
    });
    const sentence = describe_(groupsOf([failing, personal()]));
    expect(sentence.tone).toBe('bad');
    expect(english(sentence.title)).toMatch(
      /^Many requests are failing \(\d+% recently\)\. Claude is on Work\.$/
    );
  });

  test('an account with errors that still serves drops "Everything’s flowing" and asks for a look', () => {
    const shaky = personal({ status: 'error', status_message: 'upstream 529' });
    const sentence = describe_(groupsOf([work(), shaky]));
    expect(sentence.tone).toBe('warn');
    expect(english(sentence.title)).toBe('Claude is on Work.');
    expect(english(sentence.subtitle)).toContain('Personal needs a look.');
  });

  test('no recent traffic says all quiet instead of flowing', () => {
    const idle = work({ recent_requests: buckets([[0, 0]]) });
    const sentence = describe_(groupsOf([idle, personal({ recent_requests: [] })]));
    expect(english(sentence.title)).toBe('All quiet. Claude is on Work.');
  });

  test('offline, connecting, loading and empty states', () => {
    expect(english(describe_(null, 'disconnected').title)).toBe('Can’t reach the gateway.');
    expect(describe_(null, 'disconnected').tone).toBe('bad');
    expect(english(describe_(null, 'connecting').title)).toBe('Connecting to the gateway…');
    expect(english(describe_(null).title)).toBe('Checking the gateway…');
    expect(english(describe_([]).title)).toBe('No accounts yet.');
  });

  test('every sentence key exists in all five locales without leftover placeholders', () => {
    const retryAt = NOW + HOUR;
    const sentences = [
      describe_(groupsOf([work(), personal(), codex])),
      describe_(groupsOf([cooling(retryAt), personal(), codex])),
      describe_(groupsOf([cooling(retryAt), codex])),
      describe_(null, 'disconnected'),
      describe_([]),
    ];
    for (const lng of ['en', 'zh-CN', 'zh-TW', 'ru', 'vi']) {
      for (const sentence of sentences) {
        for (const copy of [...sentence.title, ...sentence.subtitle]) {
          expect(i18n.exists(copy.key, { lng, fallbackLng: false })).toBe(true);
          expect(i18n.t(copy.key, { ...copy.values, lng })).not.toContain('{{');
        }
      }
    }
  });
});

describe('Overview flow model', () => {
  test('providers order Claude, then Codex; accounts follow routing order', () => {
    const groups = groupsOf([codex, personal(), work()]);
    expect(groups.map((group) => group.provider)).toEqual(['claude', 'codex']);
    expect(groups[0].accounts.map((item) => item.account.label)).toEqual(['Work', 'Personal']);
  });

  test('traffic sums the window and the last three buckets', () => {
    expect(trafficOf(work())).toEqual({
      success: 49,
      failed: 1,
      recentSuccess: 39,
      recentFailed: 1,
    });
  });

  test('a cooling account carries no dots even though it had traffic earlier', () => {
    const [claude] = groupsOf([cooling(NOW + HOUR), personal()]);
    const workItem = claude.accounts.find((item) => item.account.label === 'Work')!;
    expect(flowStateOf(workItem.account)).toBe('warn');
    expect(flowVolume(workItem, 20)).toBe(0);
    expect(flowFailures(workItem.traffic)).toBeCloseTo(3 / 26, 5);
  });

  test('the serving account is live with volume relative to the busiest', () => {
    const [claude] = groupsOf([work(), personal()]);
    const [first, second] = claude.accounts;
    expect(flowStateOf(first.account)).toBe('live');
    expect(flowStateOf(second.account)).toBe('idle');
    expect(flowVolume(first, 40)).toBe(1);
    expect(flowVolume(second, 40)).toBeCloseTo(1 / 40, 5);
  });
});

describe('time and language helpers', () => {
  test('durations read as 45m, 2h 10m and 1d 16h; past instants read as now', () => {
    expect(durationCopy(NOW + 45 * 60_000, NOW)).toEqual({
      key: 'overview.in.m',
      values: { m: 45 },
    });
    expect(durationCopy(NOW + 2 * HOUR + 10 * 60_000, NOW)).toEqual({
      key: 'overview.in.hm',
      values: { h: 2, m: 10 },
    });
    expect(durationCopy(NOW + 40 * HOUR, NOW)).toEqual({
      key: 'overview.in.dh',
      values: { d: 1, h: 16 },
    });
    expect(durationCopy(NOW - 5, NOW)).toEqual({ key: 'overview.in.now' });
  });

  test('sentences join with a space, or without one in Chinese', () => {
    expect(joinSentences(['A.', 'B.'], 'en')).toBe('A. B.');
    expect(joinSentences(['甲。', '乙。'], 'zh-CN')).toBe('甲。乙。');
  });
});
