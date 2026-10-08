import { describe, expect, test } from 'bun:test';
import {
  buildRoutingPresentation,
  describeStrictPolicy,
  type RoutingAccountInput,
  type RoutingPresentation,
} from '../src/features/config/routing/routingPresentation';
import type { RoutingStrategy } from '../src/types/visualConfig';

const account = (
  id: string,
  overrides: Partial<RoutingAccountInput> = {}
): RoutingAccountInput => ({
  id,
  label: `Account ${id}`,
  provider: 'codex',
  enabled: true,
  availability: 'available',
  ...overrides,
});

const build = (
  strategy: RoutingStrategy,
  accounts: RoutingAccountInput[],
  sessionAffinity: { enabled: boolean; ttl?: string } = { enabled: false }
): RoutingPresentation => buildRoutingPresentation({ strategy, sessionAffinity, accounts });

const byId = (presentation: RoutingPresentation, id: string) => {
  const found = presentation.accounts.find((entry) => entry.id === id);
  if (!found) throw new Error(`missing account ${id}`);
  return found;
};

describe('routing presentation: strategy', () => {
  test('exposes strategy explanation keys and weight relevance only for weighted', () => {
    const accounts = [account('a'), account('b')];
    const rr = build('round-robin', accounts);
    const weighted = build('weighted-round-robin', accounts);
    const fillFirst = build('fill-first', accounts);

    expect(rr.weightControlsRelevant).toBe(false);
    expect(weighted.weightControlsRelevant).toBe(true);
    expect(fillFirst.weightControlsRelevant).toBe(false);
    expect(new Set([rr, weighted, fillFirst].map((p) => p.strategyExplanationKey)).size).toBe(3);
    expect(rr.strategyExplanationKey).toBe(
      'config_management.routing_presentation.strategy.round_robin'
    );
  });
});

describe('routing presentation: configured shares', () => {
  test('1:1 weights give 50/50 under weighted strategy', () => {
    const result = build('weighted-round-robin', [
      account('a', { weight: 1 }),
      account('b', { weight: 1 }),
    ]);
    expect(byId(result, 'a').sharePercent).toBeCloseTo(50);
    expect(byId(result, 'b').sharePercent).toBeCloseTo(50);
    expect(byId(result, 'a').status).toBe('participating');
    expect(result.sharesAssumptionKey).toBe(
      'config_management.routing_presentation.shares_assumption'
    );
  });

  test('missing weight defaults to 1', () => {
    const result = build('weighted-round-robin', [account('a'), account('b', { weight: null })]);
    expect(byId(result, 'a').weight).toBe(1);
    expect(byId(result, 'b').sharePercent).toBeCloseTo(50);
  });

  test('3:1 weights give 75/25', () => {
    const result = build('weighted-round-robin', [
      account('a', { weight: 3 }),
      account('b', { weight: 1 }),
    ]);
    expect(byId(result, 'a').sharePercent).toBeCloseTo(75);
    expect(byId(result, 'b').sharePercent).toBeCloseTo(25);
  });

  test('round-robin ignores weights and splits evenly', () => {
    const result = build('round-robin', [account('a', { weight: 9 }), account('b', { weight: 1 })]);
    expect(byId(result, 'a').sharePercent).toBeCloseTo(50);
    expect(byId(result, 'b').sharePercent).toBeCloseTo(50);
  });

  test('fill-first sends 100% to the first eligible account in internal ID order', () => {
    const result = build('fill-first', [
      account('z-last', { weight: 100 }),
      account('b-middle'),
      account('a-first'),
    ]);
    expect(byId(result, 'a-first').sharePercent).toBe(100);
    expect(byId(result, 'a-first').reason).toBe('participating');
    expect(byId(result, 'b-middle').sharePercent).toBe(0);
    expect(byId(result, 'b-middle').reason).toBe('standby');
    expect(byId(result, 'b-middle').status).toBe('participating');
    expect(byId(result, 'z-last').sharePercent).toBe(0);
  });

  test('fill-first skips a disabled lowest-ID account', () => {
    const result = build('fill-first', [account('a', { enabled: false }), account('b')]);
    expect(byId(result, 'a').reason).toBe('disabled');
    expect(byId(result, 'a').sharePercent).toBeNull();
    expect(byId(result, 'b').sharePercent).toBe(100);
  });
});

describe('routing presentation: priority tiers', () => {
  test('lower tier accounts are fallback-only with a distinct reason', () => {
    const result = build('round-robin', [
      account('a', { priority: 10 }),
      account('b', { priority: 10 }),
      account('c', { priority: 0 }),
    ]);
    expect(byId(result, 'a').sharePercent).toBeCloseTo(50);
    expect(byId(result, 'b').sharePercent).toBeCloseTo(50);
    expect(byId(result, 'c').status).toBe('excluded');
    expect(byId(result, 'c').reason).toBe('lower-priority');
    expect(byId(result, 'c').sharePercent).toBeNull();
    expect(result.pools[0].activePriority).toBe(10);
  });

  test('preserves arbitrary priorities and treats missing as backend default 0', () => {
    const result = build('round-robin', [
      account('a', { priority: 7 }),
      account('b', { priority: -3 }),
      account('c'),
    ]);
    expect(byId(result, 'a').priority).toBe(7);
    expect(byId(result, 'b').priority).toBe(-3);
    expect(byId(result, 'c').priority).toBe(0);
    expect(result.pools[0].activePriority).toBe(7);
    expect(byId(result, 'b').reason).toBe('lower-priority');
    expect(byId(result, 'c').reason).toBe('lower-priority');
  });

  test('negative priorities still pick the highest value; missing (0) beats -1', () => {
    const result = build('round-robin', [account('a', { priority: -1 }), account('b')]);
    expect(byId(result, 'b').status).toBe('participating');
    expect(byId(result, 'a').reason).toBe('lower-priority');
  });

  test('tiers are computed per provider pool', () => {
    const result = build('round-robin', [
      account('a', { provider: 'claude', priority: 50 }),
      account('b', { provider: 'codex', priority: 1 }),
    ]);
    expect(byId(result, 'a').sharePercent).toBe(100);
    expect(byId(result, 'b').sharePercent).toBe(100);
    expect(result.pools.map((pool) => pool.provider).sort()).toEqual(['claude', 'codex']);
  });

  test('a disabled top-tier account does not hold back the next tier', () => {
    const result = build('round-robin', [
      account('a', { priority: 10, enabled: false }),
      account('b', { priority: 0 }),
    ]);
    expect(byId(result, 'a').reason).toBe('disabled');
    expect(byId(result, 'b').status).toBe('participating');
    expect(result.pools[0].activePriority).toBe(0);
  });
});

describe('routing presentation: weights', () => {
  test('zero weight is excluded only under weighted strategy', () => {
    const accounts = [account('a', { weight: 0 }), account('b', { weight: 1 })];
    const weighted = build('weighted-round-robin', accounts);
    expect(byId(weighted, 'a').status).toBe('excluded');
    expect(byId(weighted, 'a').reason).toBe('non-positive-weight');
    expect(byId(weighted, 'b').sharePercent).toBe(100);

    for (const strategy of ['round-robin', 'fill-first'] as const) {
      const other = build(strategy, accounts);
      expect(byId(other, 'a').status).toBe('participating');
      expect(byId(other, 'a').reason).not.toBe('non-positive-weight');
    }
  });

  test('negative weight behaves like zero', () => {
    const weighted = build('weighted-round-robin', [
      account('a', { weight: -5 }),
      account('b', { weight: 2 }),
    ]);
    expect(byId(weighted, 'a').reason).toBe('non-positive-weight');
    expect(byId(weighted, 'b').sharePercent).toBe(100);
    const rr = build('round-robin', [account('a', { weight: -5 }), account('b', { weight: 2 })]);
    expect(byId(rr, 'a').sharePercent).toBeCloseTo(50);
  });

  test('zero-weight accounts are filtered before the tier is chosen (backend order)', () => {
    const weighted = build('weighted-round-robin', [
      account('a', { priority: 10, weight: 0 }),
      account('b', { priority: 0, weight: 1 }),
    ]);
    expect(byId(weighted, 'a').reason).toBe('non-positive-weight');
    expect(byId(weighted, 'b').status).toBe('participating');
    expect(byId(weighted, 'b').sharePercent).toBe(100);

    const rr = build('round-robin', [
      account('a', { priority: 10, weight: 0 }),
      account('b', { priority: 0, weight: 1 }),
    ]);
    expect(byId(rr, 'a').sharePercent).toBe(100);
    expect(byId(rr, 'b').reason).toBe('lower-priority');
  });

  test('invalid or oversized weights are treated like the backend: non-positive', () => {
    const result = build('weighted-round-robin', [
      account('a', { weight: Number.NaN }),
      account('b', { weight: 1_000_001 }),
      account('c', { weight: 1_000_000 }),
    ]);
    expect(byId(result, 'a').reason).toBe('non-positive-weight');
    expect(byId(result, 'b').reason).toBe('non-positive-weight');
    expect(byId(result, 'c').sharePercent).toBe(100);
  });

  test('all weights non-positive leaves no participants', () => {
    const result = build('weighted-round-robin', [account('a', { weight: 0 })]);
    expect(result.pools[0].activePriority).toBeNull();
    expect(result.pools[0].hasParticipants).toBe(false);
  });
});

describe('routing presentation: eligibility', () => {
  test('disabled accounts are excluded with a disabled reason under every strategy', () => {
    for (const strategy of ['round-robin', 'weighted-round-robin', 'fill-first'] as const) {
      const result = build(strategy, [account('a', { enabled: false }), account('b')]);
      expect(byId(result, 'a').status).toBe('excluded');
      expect(byId(result, 'a').reason).toBe('disabled');
      expect(byId(result, 'a').reasonKey).toBe(
        'config_management.routing_presentation.reason.disabled'
      );
    }
  });

  test('disabled takes precedence over other exclusion reasons', () => {
    const result = build('weighted-round-robin', [
      account('a', { enabled: false, weight: 0, availability: 'unavailable', priority: -9 }),
      account('b'),
    ]);
    expect(byId(result, 'a').reason).toBe('disabled');
  });

  test('unavailable accounts are excluded with their own reason', () => {
    const result = build('round-robin', [
      account('a', { availability: 'unavailable' }),
      account('b'),
    ]);
    expect(byId(result, 'a').reason).toBe('unavailable');
    expect(byId(result, 'b').sharePercent).toBe(100);
  });

  test('an unavailable top-tier account lets the next tier become active', () => {
    const result = build('round-robin', [
      account('a', { priority: 5, availability: 'unavailable' }),
      account('b', { priority: 1 }),
    ]);
    expect(byId(result, 'b').status).toBe('participating');
  });

  test('unknown availability stays unknown and is still counted as a candidate', () => {
    const result = build('round-robin', [
      account('a', { availability: 'unknown' }),
      account('b', { availability: 'available' }),
    ]);
    expect(byId(result, 'a').status).toBe('unknown');
    expect(byId(result, 'a').reason).toBe('unknown-availability');
    expect(byId(result, 'a').availability).toBe('unknown');
    expect(byId(result, 'a').sharePercent).toBeCloseTo(50);
    expect(byId(result, 'b').status).toBe('participating');
  });

  test('unknown availability on a lower tier does not change the active tier', () => {
    const result = build('round-robin', [
      account('a', { priority: 2 }),
      account('b', { priority: 1, availability: 'unknown' }),
    ]);
    expect(byId(result, 'b').reason).toBe('lower-priority');
  });
});

describe('routing presentation: session affinity', () => {
  test('flags that existing bindings outrank priority and weights only shape cold picks', () => {
    const off = build('weighted-round-robin', [account('a')], { enabled: false });
    const on = build('weighted-round-robin', [account('a')], { enabled: true, ttl: '2h' });

    expect(off.affinity.enabled).toBe(false);
    expect(off.affinity.retainsExistingBindings).toBe(false);
    expect(off.affinity.explanationKey).toBe(
      'config_management.routing_presentation.affinity.disabled'
    );
    expect(on.affinity.enabled).toBe(true);
    expect(on.affinity.retainsExistingBindings).toBe(true);
    expect(on.affinity.ttl).toBe('2h');
    expect(on.affinity.explanationKey).toBe(
      'config_management.routing_presentation.affinity.enabled'
    );
  });

  test('does not change which accounts participate', () => {
    const accounts = [account('a', { priority: 2 }), account('b', { priority: 1 })];
    const off = build('round-robin', accounts, { enabled: false });
    const on = build('round-robin', accounts, { enabled: true });
    expect(on.accounts).toEqual(off.accounts);
  });
});

describe('routing presentation: strict policy', () => {
  test('enabled and available target is ready; balance controls are irrelevant', () => {
    const result = describeStrictPolicy({ target: account('b') });
    expect(result.targetStatus).toBe('ready');
    expect(result.balanceControlsRelevant).toBe(false);
    expect(result.weightControlsRelevant).toBe(false);
    expect(result.fallsBackToPool).toBe(false);
    expect(result.failsWhenTargetUnusable).toBe(true);
    expect(result.explanationKey).toBe('config_management.routing_presentation.strict.ready');
  });

  test('disabled target means an error, never pool fallback', () => {
    const result = describeStrictPolicy({ target: account('b', { enabled: false }) });
    expect(result.targetStatus).toBe('disabled');
    expect(result.fallsBackToPool).toBe(false);
    expect(result.explanationKey).toBe('config_management.routing_presentation.strict.disabled');
  });

  test('unavailable target means an error, never pool fallback', () => {
    const result = describeStrictPolicy({ target: account('b', { availability: 'unavailable' }) });
    expect(result.targetStatus).toBe('unavailable');
    expect(result.fallsBackToPool).toBe(false);
    expect(result.explanationKey).toBe('config_management.routing_presentation.strict.unavailable');
  });

  test('disabled wins over unavailable', () => {
    const result = describeStrictPolicy({
      target: account('b', { enabled: false, availability: 'unavailable' }),
    });
    expect(result.targetStatus).toBe('disabled');
  });

  test('unknown availability stays unknown', () => {
    const result = describeStrictPolicy({ target: account('b', { availability: 'unknown' }) });
    expect(result.targetStatus).toBe('unknown');
    expect(result.fallsBackToPool).toBe(false);
  });

  test('missing target is reported without falling back', () => {
    const result = describeStrictPolicy({ target: undefined });
    expect(result.targetStatus).toBe('missing');
    expect(result.fallsBackToPool).toBe(false);
    expect(result.balanceControlsRelevant).toBe(false);
  });
});

describe('routing presentation: i18n keys', () => {
  const resolveKey = (tree: unknown, key: string): unknown =>
    key
      .split('.')
      .reduce<unknown>(
        (node, part) =>
          node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined,
        tree
      );

  test('every key the model can return exists in all five locales', async () => {
    const accounts = [
      account('a'),
      account('b', { enabled: false }),
      account('c', { availability: 'unavailable' }),
      account('d', { availability: 'unknown' }),
      account('e', { priority: -1 }),
      account('f', { weight: 0 }),
    ];
    const keys = new Set<string>();
    for (const strategy of ['round-robin', 'weighted-round-robin', 'fill-first'] as const) {
      for (const enabled of [true, false]) {
        const result = build(strategy, accounts, { enabled });
        keys.add(result.strategyExplanationKey);
        keys.add(result.sharesAssumptionKey);
        keys.add(result.affinity.explanationKey);
        result.accounts.forEach((entry) => keys.add(entry.reasonKey));
      }
    }
    keys.add(build('fill-first', [account('a'), account('b')]).accounts[1].reasonKey);
    for (const target of [
      account('t'),
      account('t', { enabled: false }),
      account('t', { availability: 'unavailable' }),
      account('t', { availability: 'unknown' }),
      undefined,
    ]) {
      keys.add(describeStrictPolicy({ target }).explanationKey);
    }
    expect(keys.size).toBeGreaterThanOrEqual(15);

    for (const locale of ['en', 'zh-CN', 'zh-TW', 'ru', 'vi']) {
      const tree = await Bun.file(`src/i18n/locales/${locale}.json`).json();
      for (const key of keys) {
        const value = resolveKey(tree, key);
        expect(typeof value === 'string' && value.length > 0).toBe(true);
      }
      const affinity = resolveKey(tree, 'config_management.routing_presentation.affinity.enabled');
      expect(affinity).toContain('{{ttl}}');
    }
  });
});
