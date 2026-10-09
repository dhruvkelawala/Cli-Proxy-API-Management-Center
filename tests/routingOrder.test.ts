import { describe, expect, test } from 'bun:test';
import {
  buildOrder,
  describeClientRoutes,
  describeClientsLine,
  describeServing,
  healthCopy,
  orderWithFirst,
  otherProviderLine,
  planOrderPriorities,
  priorityChanges,
  quotaCopy,
  rankKey,
  resetHint,
  shortClientName,
  summarizeClaudeQuota,
  whoIsFirst,
  type QuotaSummary,
} from '@/features/clientProfiles/routing/routingOrder';
import {
  buildWhenFormatter,
  saveOrderChanges,
} from '@/features/clientProfiles/routing/useRoutingOrder';
import type { RoutingSaveDeps } from '@/features/config/routing/routingSettingsState';
import { credentialRefForAuthFile } from '@/features/clientProfiles/model';
import { buildAccountTuningPatch } from '@/features/config/routing/routingSettingsState';
import type { AuthFileItem } from '@/types';
import type { ClientProfileAccount, ClientProfilesSnapshot } from '@/types/clientProfiles';

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 9, 9, 12, 0, 0);
const join = (names: string[]) => names.join(' and ');
const when = (ms: number) => `@${Math.round((ms - NOW) / HOUR)}h`;

const work: AuthFileItem = {
  id: 'claude-work.json',
  name: 'claude-work.json',
  type: 'claude',
  status: 'active',
  note: 'Work',
  priority: 10,
};
const personal: AuthFileItem = {
  id: 'claude-personal.json',
  name: 'claude-personal.json',
  type: 'claude',
  status: 'active',
  note: 'Personal',
};
const codex: AuthFileItem = {
  id: 'codex.json',
  name: 'codex.json',
  type: 'codex',
  status: 'active',
  note: 'Codex',
};

const quota = (weekLeft: number, weekResetInHours: number): QuotaSummary => ({
  status: 'ready',
  sessionLeft: 80,
  sessionResetAt: NOW + 2 * HOUR,
  weekLeft,
  weekResetAt: NOW + weekResetInHours * HOUR,
});

const build = (files: AuthFileItem[], extra: Partial<Parameters<typeof buildOrder>[0]> = {}) =>
  buildOrder({
    files,
    provider: 'claude',
    strategy: 'fill-first',
    sessionAffinity: true,
    ...extra,
  });

describe('order and who goes first', () => {
  test('higher priority goes first; the other is the backup', () => {
    const model = build([personal, work, codex]);
    expect(model.order.map((a) => a.label)).toEqual(['Work', 'Personal']);
    expect(whoIsFirst(model)?.map((a) => a.label)).toEqual(['Work']);
    expect(model.order.map((a) => a.role)).toEqual(['active', 'backup']);
    expect(model.sameLevel).toBe(false);
    expect(rankKey(model.order[0], 0, false)).toBe('routing.rank.first');
    expect(rankKey(model.order[1], 1, false)).toBe('routing.rank.backup');
  });

  test('a cooling-down first account hands new conversations to the backup', () => {
    const cooling = {
      ...work,
      unavailable: true,
      status: 'error',
      next_retry_after: new Date(NOW + 3 * HOUR).toISOString(),
    };
    const model = build([cooling, personal]);
    expect(whoIsFirst(model)?.map((a) => a.label)).toEqual(['Personal']);
    expect(model.order[0].role).toBe('resting');
    expect(describeServing(model, join, when)).toEqual({
      title: { key: 'routing.title_fallback', values: { out: 'Work', account: 'Personal' } },
      follow: { key: 'routing.follow_back_at', values: { out: 'Work', when: '@3h' } },
    });
  });

  test('an account whose weekly quota is used up is at its limit until the reset', () => {
    const model = build([work, personal], {
      quotaFor: (file) => (file === work ? quota(0, 30) : quota(70, 50)),
    });
    expect(model.order[0].health).toBe('limit');
    expect(healthCopy(model.order[0], when)).toEqual({
      key: 'routing.health.limit_until',
      values: { when: '@30h' },
    });
    expect(whoIsFirst(model)?.map((a) => a.label)).toEqual(['Personal']);
  });

  test('equal priorities share one level and the sentence says so', () => {
    const model = build([{ ...work, priority: 0 }, personal], { strategy: 'round-robin' });
    expect(model.sameLevel).toBe(true);
    expect(describeServing(model, join, when).title).toEqual({
      key: 'routing.title_shared',
      values: { accounts: 'Personal and Work' },
    });
    expect(rankKey(model.order[0], 0, true)).toBe('routing.rank.shared');
  });

  test('no Claude accounts and none with room have their own sentences', () => {
    expect(describeServing(build([codex]), join, when).title.key).toBe('routing.title_empty');
    const off = build([
      { ...work, disabled: true },
      { ...personal, disabled: true },
    ]);
    expect(describeServing(off, join, when).title.key).toBe('routing.title_none');
  });
});

describe('fallback description and preview', () => {
  test('the normal sentence names the first and the backup', () => {
    expect(describeServing(build([work, personal]), join, when)).toEqual({
      title: { key: 'routing.title_first', values: { account: 'Work' } },
      follow: { key: 'routing.follow_backup', values: { account: 'Work', backup: 'Personal' } },
    });
  });

  test('previewing the first running out moves traffic to the backup without any write', () => {
    const model = build([work, personal], { simulateOut: 'claude-work.json' });
    expect(model.order[0].simulatedOut).toBe(true);
    expect(model.order[0].role).toBe('resting');
    expect(model.order.map((a) => a.priority)).toEqual([10, 0]);
    expect(whoIsFirst(model)?.map((a) => a.label)).toEqual(['Personal']);
    expect(describeServing(model, join, when).follow).toEqual({ key: 'routing.follow_preview' });
    expect(healthCopy(model.order[0], when).key).toBe('routing.health.preview_out');
  });

  test('a single account has no backup', () => {
    expect(describeServing(build([work]), join, when).follow).toEqual({
      key: 'routing.follow_no_backup',
    });
  });
});

describe('order → priorities', () => {
  test('swapping two ordered accounts swaps their values (first gets the higher one)', () => {
    const model = build([work, personal]);
    const plan = planOrderPriorities(model.order, ['claude-personal.json', 'claude-work.json']);
    expect(plan).toEqual({ 'claude-personal.json': 10, 'claude-work.json': 0 });
  });

  test('an already-ordered list keeps its values and writes nothing', () => {
    const model = build([
      { ...work, priority: 50 },
      { ...personal, priority: 5 },
    ]);
    const ids = model.order.map((a) => a.id);
    const plan = planOrderPriorities(model.order, ids);
    expect(plan).toEqual({ 'claude-work.json': 50, 'claude-personal.json': 5 });
    expect(priorityChanges(model.order, plan)).toEqual([]);
  });

  test('tied priorities become 10 for the first and 0 for the backup', () => {
    const model = build([{ ...work, priority: 0 }, personal]);
    const plan = planOrderPriorities(model.order, ['claude-work.json', 'claude-personal.json']);
    expect(plan).toEqual({ 'claude-work.json': 10, 'claude-personal.json': 0 });
    // Only the account that changes is written.
    expect(priorityChanges(model.order, plan)).toEqual([
      { id: 'claude-work.json', name: 'claude-work.json', from: 0, to: 10 },
    ]);
  });

  test('changes write demotions first and map to the same field patch as the Accounts page', () => {
    const model = build([work, personal]);
    const changes = priorityChanges(
      model.order,
      planOrderPriorities(model.order, orderWithFirst(model.order, 'claude-personal.json'))
    );
    expect(changes.map((c) => [c.name, c.to])).toEqual([
      ['claude-work.json', 0],
      ['claude-personal.json', 10],
    ]);
    expect(
      changes.map((c) => buildAccountTuningPatch({ priority: c.from }, { priority: String(c.to) }))
    ).toEqual([{ priority: 0 }, { priority: 10 }]);
  });

  test('optimistic overrides reorder immediately', () => {
    const model = build([work, personal], {
      priorityOverrides: { 'claude-personal.json': 10, 'claude-work.json': 0 },
    });
    expect(model.order.map((a) => a.label)).toEqual(['Personal', 'Work']);
  });
});

describe('reset hint', () => {
  test('the backup resetting sooner with room left suggests making it first', () => {
    const model = build([work, personal], {
      quotaFor: (file) => (file === work ? quota(54, 100) : quota(78, 38)),
    });
    const hint = resetHint(model, when);
    expect(hint?.account?.label).toBe('Personal');
    expect(hint?.copy).toEqual({
      key: 'routing.hint.sooner_bad',
      values: { account: 'Personal', when: '@38h', percent: 78 },
    });
  });

  test('the first resetting sooner is confirmed, with nothing to act on', () => {
    const model = build([work, personal], {
      quotaFor: (file) => (file === work ? quota(54, 20) : quota(78, 90)),
    });
    expect(resetHint(model, when)).toEqual({
      account: null,
      copy: { key: 'routing.hint.sooner_good', values: { account: 'Work', when: '@20h' } },
    });
  });

  test('no hint without reset times or when both reset together', () => {
    expect(resetHint(build([work, personal]), when)).toBeNull();
    const together = build([work, personal], {
      quotaFor: (file) => (file === work ? quota(54, 40) : quota(78, 40.2)),
    });
    expect(resetHint(together, when)).toBeNull();
  });

  test('weekly quota caption carries the reset time', () => {
    const model = build([work], { quotaFor: () => quota(54, 30) });
    expect(quotaCopy(model.order[0], when)).toEqual({
      key: 'routing.quota.week_left_reset',
      values: { percent: 54, when: '@30h' },
    });
  });
});

describe('clients and locks', () => {
  const WORK_REF = 'acct-work';
  const inventory: ClientProfileAccount[] = [
    {
      credentialRef: credentialRefForAuthFile(work) as string,
      accountRef: WORK_REF,
      provider: 'claude',
      label: 'claude',
      available: true,
      state: 'available',
      enrollmentSupported: true,
      targetSupported: true,
    },
  ];
  const profile = (ref: string, label: string, claude: 'auto' | 'work' | 'gone') => ({
    profileRef: ref,
    label,
    revision: 1,
    policies: {
      claude:
        claude === 'auto'
          ? ({ mode: 'automatic' } as const)
          : ({ mode: 'only', accountRef: claude === 'work' ? WORK_REF : 'acct-gone' } as const),
      codex: { mode: 'automatic' } as const,
    },
  });
  const snapshotOf = (profiles: ReturnType<typeof profile>[]): ClientProfilesSnapshot => ({
    revision: '"r"',
    profiles,
    keys: [],
    accounts: inventory,
    targetStates: {},
  });

  test('all-Automatic profiles follow the order in one line', () => {
    const model = build([work, personal], { inventory });
    const routes = describeClientRoutes(
      snapshotOf([
        profile('p1', 'Mini · Claude', 'auto'),
        profile('p2', 'MacBook · Claude', 'auto'),
      ]),
      'claude',
      model.order
    );
    expect(routes.map((r) => [r.shortName, r.locked])).toEqual([
      ['Mini', false],
      ['MacBook', false],
    ]);
    expect(describeClientsLine(routes, join)).toEqual({
      copies: [{ key: 'routing.clients.two', values: { names: 'Mini and MacBook' } }],
      problem: false,
    });
  });

  test('a profile with an Only rule is listed as locked to its account', () => {
    const model = build([work, personal], { inventory });
    const routes = describeClientRoutes(
      snapshotOf([
        profile('p1', 'Mini · Claude', 'auto'),
        profile('p2', 'MacBook · Claude', 'work'),
      ]),
      'claude',
      model.order
    );
    expect(routes[1]).toMatchObject({ locked: true, broken: false, shortName: 'MacBook' });
    expect(routes[1].target?.label).toBe('Work');
    expect(describeClientsLine(routes, join).copies).toEqual([
      { key: 'routing.clients.one', values: { names: 'Mini' } },
      { key: 'routing.clients.locked', values: { client: 'MacBook', account: 'Work' } },
    ]);
  });

  test('a lock on a missing account, or one previewed as out, is a problem', () => {
    const gone = describeClientRoutes(
      snapshotOf([profile('p1', 'Mini · Claude', 'gone')]),
      'claude',
      build([work], { inventory }).order
    );
    expect(gone[0]).toMatchObject({ locked: true, broken: true, target: null });
    expect(describeClientsLine(gone, join)).toEqual({
      copies: [{ key: 'routing.clients.locked_missing', values: { client: 'Mini' } }],
      problem: true,
    });
    const previewOut = describeClientRoutes(
      snapshotOf([profile('p1', 'Mini · Claude', 'work')]),
      'claude',
      build([work, personal], { inventory, simulateOut: 'claude-work.json' }).order
    );
    expect(previewOut[0].broken).toBe(true);
  });

  test('short names, the Codex line and the empty case', () => {
    expect(shortClientName('Mini · Claude')).toBe('Mini');
    expect(shortClientName('Laptop')).toBe('Laptop');
    expect(otherProviderLine([work, codex], 'codex')).toEqual({ key: 'routing.codex.one' });
    expect(otherProviderLine([work], 'codex')).toBeNull();
    expect(describeClientsLine([], join).copies).toEqual([{ key: 'routing.clients.none' }]);
  });
});

describe('quota and time formatting', () => {
  test('weekly and session windows are read from the Quota cache state', () => {
    expect(
      summarizeClaudeQuota({
        status: 'success',
        windows: [
          { id: 's', label: '5h', usedPercent: 31, resetLabel: '', resetAtMs: 1, periodHours: 5 },
          { id: 'w', label: '7d', usedPercent: 46, resetLabel: '', resetAtMs: 2, periodHours: 168 },
        ],
      })
    ).toEqual({
      status: 'ready',
      sessionLeft: 69,
      sessionResetAt: 1,
      weekLeft: 54,
      weekResetAt: 2,
    });
    expect(summarizeClaudeQuota({ status: 'loading', windows: [] }).status).toBe('loading');
    expect(summarizeClaudeQuota(undefined).status).toBe('none');
  });

  test('reset times read as today, tomorrow or a weekday', () => {
    const now = new Date(2026, 9, 9, 10, 0);
    const t = (key: string, values?: Record<string, string>) =>
      `${key.split('.').pop()}|${values?.day ?? ''}`;
    const format = buildWhenFormatter(t, 'en-US', () => now);
    expect(format(new Date(2026, 9, 9, 22, 0).getTime())).toBe('today|');
    expect(format(new Date(2026, 9, 10, 9, 0).getTime())).toBe('tomorrow|');
    expect(format(new Date(2026, 9, 13, 9, 0).getTime())).toBe('other|Tue');
  });
});

describe('saving a new order', () => {
  const depsWith = (fail: Set<string>, calls: Array<[string, unknown]>, revision = { n: 1 }) =>
    ({
      connectionRevision: () => revision.n,
      applyConfigPlan: async () => {},
      patchAccount: async (name: string, patch: unknown) => {
        calls.push([name, patch]);
        if (fail.has(name)) throw new Error('nope');
      },
      isCurrent: () => true,
    }) satisfies RoutingSaveDeps;
  const swap = [
    { name: 'work.json', from: 10, to: 0 },
    { name: 'personal.json', from: 0, to: 10 },
  ];

  test('writes each priority through PATCH /credentials/fields, demotion first', async () => {
    const calls: Array<[string, unknown]> = [];
    const result = await saveOrderChanges(depsWith(new Set(), calls), swap);
    expect(calls).toEqual([
      ['work.json', { priority: 0 }],
      ['personal.json', { priority: 10 }],
    ]);
    expect(result).toEqual({ kind: 'done', saved: ['work.json', 'personal.json'], failed: null });
  });

  test('stops at the first failure so nothing is promoted after a failed write', async () => {
    const calls: Array<[string, unknown]> = [];
    const result = await saveOrderChanges(depsWith(new Set(['work.json']), calls), swap);
    expect(calls).toEqual([['work.json', { priority: 0 }]]);
    expect(result).toEqual({
      kind: 'done',
      saved: [],
      failed: { name: 'work.json', message: 'nope' },
    });
  });

  test('a connection switch mid-save is stale and reports nothing', async () => {
    const revision = { n: 1 };
    const calls: Array<[string, unknown]> = [];
    const deps = depsWith(new Set(), calls, revision);
    deps.patchAccount = async (name, patch) => {
      calls.push([name, patch]);
      revision.n += 1;
    };
    expect(await saveOrderChanges(deps, swap)).toEqual({ kind: 'stale' });
    expect(calls).toHaveLength(1);
  });
});
