import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  buildOrder,
  describeClientRoutes,
  describeClientsLine,
  describeServing,
  healthCopy,
  orderWithFirst,
  otherProviderLine,
  planMoveToFirst,
  planOrderPriorities,
  planReorder,
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
  QUOTA_MAX_AGE_MS,
  buildWhenFormatter,
  settleQuotaReads,
  takeStaleQuotaTargets,
} from '@/features/clientProfiles/routing/useRoutingOrder';
import { saveOrderChanges } from '@/features/clientProfiles/routing/reorderFlow';
import type { RoutingSaveDeps } from '@/features/config/routing/routingSettingsState';
import { credentialRefForAuthFile } from '@/features/clientProfiles/model';
import { buildAccountTuningPatch } from '@/features/config/routing/routingSettingsState';
import type { AuthFileItem, ClaudeQuotaState } from '@/types';
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

  test('equal priorities with a spreading strategy are shared, and the cards say so', () => {
    const model = build([{ ...work, priority: 0 }, personal], { strategy: 'round-robin' });
    expect(model.sameLevel).toBe(true);
    expect(model.shared).toBe(true);
    expect(describeServing(model, join, when).title).toEqual({
      key: 'routing.title_shared',
      values: { accounts: 'Personal and Work' },
    });
    expect(rankKey(model.order[0], 0, model.shared)).toBe('routing.rank.shared');
  });

  test('fill-first with equal priorities is an honest tie, not "Shared"', () => {
    const model = build([{ ...work, priority: 0 }, personal]);
    expect(model.shared).toBe(false);
    expect(model.tie).toBe(true);
    expect(model.serving.map((a) => a.label)).toEqual(['Personal']);
    expect(describeServing(model, join, when)).toEqual({
      title: { key: 'routing.title_first', values: { account: 'Personal' } },
      follow: {
        key: 'routing.follow_tie',
        values: { accounts: 'Personal and Work', account: 'Personal' },
      },
    });
    expect(model.order.map((a, i) => rankKey(a, i, model.shared))).toEqual([
      'routing.rank.first',
      'routing.rank.backup',
    ]);
  });

  test('turned-off accounts are listed apart, never ordered or written', () => {
    const model = build([work, { ...personal, disabled: true, priority: 99 }]);
    expect(model.order.map((a) => a.label)).toEqual(['Work']);
    expect(model.off.map((a) => [a.label, a.role])).toEqual([['Personal', 'off']]);
    expect(planReorder(model.order, ['claude-personal.json', 'claude-work.json'])).toEqual([]);
  });

  test('no Claude accounts and none with room have their own sentences', () => {
    expect(describeServing(build([codex]), join, when).title.key).toBe('routing.title_empty');
    const off = build([
      { ...work, disabled: true },
      { ...personal, disabled: true },
    ]);
    expect(describeServing(off, join, when).title.key).toBe('routing.title_all_off');
    const cooling = {
      unavailable: true,
      status: 'error',
      next_retry_after: new Date(NOW + HOUR).toISOString(),
    };
    const none = build([
      { ...work, ...cooling },
      { ...personal, ...cooling },
    ]);
    expect(describeServing(none, join, when).title.key).toBe('routing.title_none');
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

describe('order → priorities (write plan)', () => {
  type Row = { id: string; name: string; priority: number };
  const row = (id: string, priority: number): Row => ({ id, name: `${id}.json`, priority });
  const apply = (rows: Row[], changes: { id: string; to: number }[]) =>
    rows
      .map((r) => ({ ...r, priority: changes.find((c) => c.id === r.id)?.to ?? r.priority }))
      .sort((x, y) => y.priority - x.priority);

  test('"make first" with two accounts is exactly one write', () => {
    const model = build([work, personal]);
    const ids = orderWithFirst(model.order, 'claude-personal.json');
    expect(ids).toEqual(['claude-personal.json', 'claude-work.json']);
    expect(planReorder(model.order, ids)).toEqual([
      { id: 'claude-personal.json', name: 'claude-personal.json', from: 0, to: 20 },
    ]);
  });

  test('flipping back demotes instead of inflating, so values cycle 10/0 and 10/20', () => {
    let rows = [row('work', 10), row('personal', 0)];
    const seen = new Set<number>();
    for (let flip = 0; flip < 12; flip += 1) {
      const backup = rows[1].id;
      const changes = planMoveToFirst(rows, backup);
      expect(changes).toHaveLength(1);
      rows = apply(rows, changes);
      expect(rows[0].id).toBe(backup);
      rows.forEach((r) => seen.add(r.priority));
    }
    expect([...seen].sort((x, y) => x - y)).toEqual([0, 10, 20]);
  });

  test('odd starting values stay bounded too', () => {
    let rows = [row('work', 55), row('personal', 3)];
    for (let flip = 0; flip < 40; flip += 1) {
      const changes = planMoveToFirst(rows, rows[1].id);
      expect(changes).toHaveLength(1);
      rows = apply(rows, changes);
    }
    rows.forEach((r) => {
      expect(r.priority).toBeGreaterThanOrEqual(0);
      expect(r.priority).toBeLessThanOrEqual(75);
    });
  });

  test('already strictly first writes nothing; a tie at 0 raises the mover to 10', () => {
    expect(planMoveToFirst([row('a', 10), row('b', 0)], 'a')).toEqual([]);
    expect(planMoveToFirst([row('a', 0), row('b', 0)], 'b')).toEqual([
      { id: 'b', name: 'b.json', from: 0, to: 10 },
    ]);
  });

  test('three accounts: "make first" is still one write', () => {
    const rows = [row('a', 20), row('b', 10), row('c', 0)];
    // Several accounts above: the mover is raised.
    expect(planReorder(rows, ['c', 'a', 'b'])).toEqual([
      { id: 'c', name: 'c.json', from: 0, to: 30 },
    ]);
    // One account above, but dropping it to 0 would tie with c: raise instead.
    expect(planReorder(rows, ['b', 'a', 'c'])).toEqual([
      { id: 'b', name: 'b.json', from: 10, to: 30 },
    ]);
    // One account above with room below it: that account drops.
    expect(planReorder([row('a', 30), row('b', 20), row('c', 0)], ['b', 'a', 'c'])).toEqual([
      { id: 'a', name: 'a.json', from: 30, to: 10 },
    ]);
  });

  test('a general reorder writes true demotions first, then promotions', () => {
    const rows = [row('a', 20), row('b', 10), row('c', 0)];
    const changes = planReorder(rows, ['b', 'c', 'a']);
    expect(changes.map((c) => [c.id, c.from, c.to])).toEqual([
      ['a', 20, 0],
      ['c', 0, 10],
      ['b', 10, 20],
    ]);
    expect(priorityChanges(rows, planOrderPriorities(rows, ['a', 'b', 'c']))).toEqual([]);
  });

  test('each write is the same field patch the Accounts page sends', () => {
    expect(buildAccountTuningPatch({ priority: 0 }, { priority: '20' })).toEqual({ priority: 20 });
    expect(buildAccountTuningPatch({ priority: 20 }, { priority: '0' })).toEqual({ priority: 0 });
  });

  test('optimistic overrides reorder immediately', () => {
    const model = build([work, personal], {
      priorityOverrides: { 'claude-personal.json': 20 },
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
      summarizeClaudeQuota(
        {
          status: 'success',
          windows: [
            { id: 's', label: '5h', usedPercent: 31, resetLabel: '', resetAtMs: 1, periodHours: 5 },
            {
              id: 'w',
              label: '7d',
              usedPercent: 46,
              resetLabel: '',
              resetAtMs: 2,
              periodHours: 168,
            },
          ],
        },
        0
      )
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

describe('review fixes: hint, locks, quota freshness', () => {
  const third: AuthFileItem = {
    id: 'claude-third.json',
    name: 'claude-third.json',
    type: 'claude',
    status: 'active',
    note: 'Third',
    priority: 5,
  };

  test('the reset hint compares every usable account, not just the top two', () => {
    const model = build([work, third, personal], {
      quotaFor: (file) =>
        file === work ? quota(50, 100) : file === third ? quota(40, 80) : quota(70, 20),
    });
    expect(model.order.map((a) => a.label)).toEqual(['Work', 'Third', 'Personal']);
    expect(resetHint(model, when)?.account?.label).toBe('Personal');
  });

  test('turned-off or unusable accounts never drive the hint', () => {
    const cooling = {
      unavailable: true,
      status: 'error',
      next_retry_after: '2099-01-01T00:00:00Z',
    };
    const model = build([work, { ...personal, ...cooling }, { ...third, disabled: true }], {
      quotaFor: (file) => (file === work ? quota(50, 100) : quota(70, 20)),
    });
    expect(resetHint(model, when)).toBeNull();
  });

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
  const snap = (
    profiles: ClientProfilesSnapshot['profiles'],
    targetStates: ClientProfilesSnapshot['targetStates'] = {}
  ): ClientProfilesSnapshot => ({
    revision: '"r"',
    profiles,
    keys: [],
    accounts: inventory,
    targetStates,
  });
  const profile = (
    ref: string,
    label: string,
    claude: 'auto' | 'work',
    codex: 'auto' | 'work' = 'auto'
  ) => ({
    profileRef: ref,
    label,
    revision: 1,
    policies: {
      claude:
        claude === 'auto'
          ? ({ mode: 'automatic' } as const)
          : ({ mode: 'only', accountRef: WORK_REF } as const),
      codex:
        codex === 'auto'
          ? ({ mode: 'automatic' } as const)
          : ({ mode: 'only', accountRef: 'x' } as const),
    },
  });

  test('enforcement off: a client with any Only rule is refused, not "using the order"', () => {
    const model = build([work, personal], { inventory });
    const routes = describeClientRoutes(
      snap([
        profile('p1', 'Mini · Claude', 'auto'),
        profile('p2', 'MacBook · Claude', 'auto', 'work'),
      ]),
      'claude',
      model.order,
      false
    );
    expect(routes.map((r) => [r.shortName, r.refused])).toEqual([
      ['Mini', false],
      ['MacBook', true],
    ]);
    expect(describeClientsLine(routes, join)).toEqual({
      copies: [
        { key: 'routing.clients.one', values: { names: 'Mini' } },
        { key: 'routing.clients.refused', values: { client: 'MacBook' } },
      ],
      problem: true,
    });
  });

  test('a working lock to an account outside the order says it works, not that it fails', () => {
    const model = build([personal], { inventory });
    const routes = describeClientRoutes(
      snap([profile('p1', 'Mini · Claude', 'work')], { p1: { claude: 'available' } }),
      'claude',
      model.order
    );
    expect(routes[0]).toMatchObject({ locked: true, broken: false, target: null });
    expect(describeClientsLine(routes, join).copies).toEqual([
      { key: 'routing.clients.locked_other', values: { client: 'Mini' } },
    ]);
  });

  test('quota windows whose reset already passed are ignored', () => {
    const now = 1_000_000;
    const summary = summarizeClaudeQuota(
      {
        status: 'success',
        windows: [
          {
            id: 's',
            label: '5h',
            usedPercent: 90,
            resetLabel: '',
            resetAtMs: now - 1,
            periodHours: 5,
          },
          {
            id: 'w',
            label: '7d',
            usedPercent: 40,
            resetLabel: '',
            resetAtMs: now + 5,
            periodHours: 168,
          },
        ],
      },
      now
    );
    expect(summary).toMatchObject({ sessionLeft: null, sessionResetAt: null, weekLeft: 60 });
    const allPast = summarizeClaudeQuota(
      {
        status: 'success',
        windows: [
          {
            id: 'w',
            label: '7d',
            usedPercent: 100,
            resetLabel: '',
            resetAtMs: now,
            periodHours: 168,
          },
        ],
      },
      now
    );
    expect(allPast.status).toBe('none');
  });

  test('quota counts as fresh only after a successful read; a failed read is retried', () => {
    const fresh = { readAt: new Map<string, number>(), pending: new Map<string, unknown>() };
    const files = [work, personal, { ...third, disabled: true }];
    const cache = new Map<AuthFileItem, ClaudeQuotaState | undefined>();
    const stateFor = (file: AuthFileItem) => cache.get(file);
    const visit1 = new Set<string>();
    expect(takeStaleQuotaTargets(files, 1, 0, visit1, stateFor, fresh).map((f) => f.name)).toEqual([
      'claude-work.json',
      'claude-personal.json',
    ]);
    // Same visit: already asked, not asked again (no retry loop).
    expect(takeStaleQuotaTargets(files, 1, 1, visit1, stateFor, fresh)).toEqual([]);
    // Work's read succeeds, Personal's fails.
    cache.set(work, { status: 'success', windows: [] });
    cache.set(personal, { status: 'error', windows: [], error: 'x' });
    settleQuotaReads(files, 1, 10, stateFor, fresh);
    expect(fresh.pending.size).toBe(0);
    // Next visit: only the failed one is read again.
    const visit2 = new Set<string>();
    expect(takeStaleQuotaTargets(files, 1, 20, visit2, stateFor, fresh).map((f) => f.name)).toEqual(
      ['claude-personal.json']
    );
    // Five minutes after the success, Work is stale again.
    const visit3 = new Set<string>();
    expect(
      takeStaleQuotaTargets(files, 1, 10 + QUOTA_MAX_AGE_MS, visit3, stateFor, fresh).map(
        (f) => f.name
      )
    ).toEqual(['claude-work.json']);
    // Another connection never reuses this session's freshness.
    expect(takeStaleQuotaTargets(files, 2, 21, new Set(), stateFor, fresh)).toHaveLength(2);
  });

  test('an old cache entry still in place does not count as the requested read', () => {
    const fresh = { readAt: new Map<string, number>(), pending: new Map<string, unknown>() };
    const old: ClaudeQuotaState = { status: 'success', windows: [] };
    const stateFor = () => old;
    takeStaleQuotaTargets([work], 1, 0, new Set(), stateFor, fresh);
    settleQuotaReads([work], 1, 5, stateFor, fresh);
    expect(fresh.readAt.size).toBe(0);
    expect(fresh.pending.size).toBe(1);
  });

  test('the page passes its ticking clock into the quota summary', () => {
    const source = readFileSync(
      new URL('../src/features/clientProfiles/routing/useRoutingOrder.ts', import.meta.url),
      'utf8'
    );
    expect(source).toContain('const now = useNow();');
    expect(source).toContain('summarizeClaudeQuota(claudeQuota[getQuotaCacheKey(file)], now)');
  });
});
