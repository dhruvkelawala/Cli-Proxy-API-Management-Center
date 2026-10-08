import { describe, expect, test } from 'bun:test';
import { parse as parseYaml } from 'yaml';
import { buildConfigPatch, type ConfigPatchPlan } from '../src/services/api/configPatch';
import { normalizeConfigResponse } from '../src/services/api/transformers';
import {
  applyRoutingEdits,
  applyTuningPatchToFile,
  buildAccountTuningPatch,
  buildRoutingSettingsPlan,
  effectiveRoutingEdits,
  isAccountTuningDirty,
  readRoutingSettings,
  retainFailedTuningEdits,
  saveAccountTunings,
  saveGlobalRouting,
  summarizeAccountSave,
  toRoutingAccountInput,
  validateAccountTuning,
  validateAffinityTtl,
  validateTouchedTtl,
  type AccountTuningSaveEntry,
  type RoutingSaveDeps,
  type RoutingSettingsValues,
} from '../src/features/config/routing/routingSettingsState';
import type { AuthFileFieldsPatch } from '../src/services/api/authFiles';
import type { AuthFileItem } from '../src/types';
import { runVisualConfig } from './helpers/visualConfig';

const base = (overrides: Partial<RoutingSettingsValues> = {}): RoutingSettingsValues => ({
  strategy: 'round-robin',
  sessionAffinity: false,
  sessionAffinityTtl: '',
  ...overrides,
});

const file = (overrides: Partial<AuthFileItem> = {}): AuthFileItem => ({
  name: 'claude-a.json',
  type: 'claude',
  email: 'a@example.test',
  status: 'active',
  ...overrides,
});

interface Recorder {
  deps: RoutingSaveDeps;
  plans: ConfigPatchPlan[];
  patches: { name: string; patch: AuthFileFieldsPatch }[];
  state: { revision: number; current: boolean };
}

const recorder = (
  options: {
    failConfig?: Error;
    failAccounts?: Record<string, Error>;
    /** Runs while a write is in flight, to simulate a connection switch or unmount. */
    during?: (state: Recorder['state']) => void;
  } = {}
): Recorder => {
  const state = { revision: 1, current: true };
  const plans: ConfigPatchPlan[] = [];
  const patches: Recorder['patches'] = [];
  const deps: RoutingSaveDeps = {
    connectionRevision: () => state.revision,
    isCurrent: () => state.current,
    applyConfigPlan: async (plan) => {
      options.during?.(state);
      plans.push(plan);
      if (options.failConfig) throw options.failConfig;
    },
    patchAccount: async (name, patch) => {
      options.during?.(state);
      patches.push({ name, patch });
      const failure = options.failAccounts?.[name];
      if (failure) throw failure;
    },
  };
  return { deps, plans, patches, state };
};

describe('routing settings baseline', () => {
  test('reads all three strategies from the config store without coercion', () => {
    const read = (strategy: string) =>
      readRoutingSettings(normalizeConfigResponse({ routing: { strategy } }))?.strategy;
    expect(read('round-robin')).toBe('round-robin');
    expect(read('weighted-round-robin')).toBe('weighted-round-robin');
    expect(read('fill-first')).toBe('fill-first');
  });

  test('reads session affinity and TTL, and defaults to off when absent', () => {
    expect(
      readRoutingSettings(
        normalizeConfigResponse({
          routing: {
            strategy: 'fill-first',
            'session-affinity': true,
            'session-affinity-ttl': '2h',
          },
        })
      )
    ).toEqual({ strategy: 'fill-first', sessionAffinity: true, sessionAffinityTtl: '2h' });
    expect(readRoutingSettings(normalizeConfigResponse({}))).toEqual(base());
    expect(readRoutingSettings(null)).toBeNull();
  });
});

describe('routing settings plan: no default migration', () => {
  test('an untouched saved fill-first strategy is never written', () => {
    const saved = base({ strategy: 'fill-first' });
    expect(buildRoutingSettingsPlan(saved, {})).toBeNull();
    const plan = buildRoutingSettingsPlan(saved, { sessionAffinity: true });
    expect(plan).toEqual({ patch: { routing: { 'session-affinity': true } }, deletions: [] });
    expect(JSON.stringify(plan)).not.toContain('strategy');
  });

  test('an edit that matches the saved value is dropped, not rewritten', () => {
    const saved = base({ strategy: 'fill-first', sessionAffinity: true, sessionAffinityTtl: '1h' });
    expect(
      effectiveRoutingEdits(saved, {
        strategy: 'fill-first',
        sessionAffinity: true,
        sessionAffinityTtl: ' 1h ',
      })
    ).toEqual({});
    expect(
      buildRoutingSettingsPlan(saved, { strategy: 'fill-first', sessionAffinity: true })
    ).toBeNull();
  });

  test('writes only the changed strategy, with the backend value', () => {
    expect(
      buildRoutingSettingsPlan(base({ strategy: 'fill-first' }), {
        strategy: 'weighted-round-robin',
      })
    ).toEqual({ patch: { routing: { strategy: 'weighted-round-robin' } }, deletions: [] });
  });

  test('a blank TTL deletes the key so the backend default applies', () => {
    const plan = buildRoutingSettingsPlan(
      base({ sessionAffinity: true, sessionAffinityTtl: '1h' }),
      { sessionAffinityTtl: '  ' }
    );
    expect(plan).toEqual({ patch: {}, deletions: [['routing', 'session-affinity-ttl']] });
  });

  test('applies edits over the baseline for display', () => {
    expect(applyRoutingEdits(base({ strategy: 'fill-first' }), { sessionAffinity: true })).toEqual({
      strategy: 'fill-first',
      sessionAffinity: true,
      sessionAffinityTtl: '',
    });
  });

  test('validates TTL as a duration and treats blank as the default', () => {
    expect(validateAffinityTtl('')).toBeNull();
    expect(validateAffinityTtl('30m')).toBeNull();
    expect(validateAffinityTtl('1h30m')).toBeNull();
    expect(validateAffinityTtl('soon')).toBe('invalid');
    expect(validateAffinityTtl('10')).toBe('invalid');
  });

  test('accepts exactly what Go time.ParseDuration accepts', () => {
    for (const ok of ['+1h', '-30m', '.5s', '1.h', '1.5h', '0', '+0', '1h30m15s', '100ms', '5ns']) {
      expect(validateAffinityTtl(ok)).toBeNull();
    }
    for (const ok of ['2us', '2µs', '2μs', '1h0.5m']) expect(validateAffinityTtl(ok)).toBeNull();
    for (const bad of ['1d', '1w', '1h 30m', '1h30', 'h', '.', '1..5s', '--1h', '1H', '1hr', '5']) {
      expect(validateAffinityTtl(bad)).toBe('invalid');
    }
  });

  test('only a touched TTL is validated, so an odd saved value never blocks a save', () => {
    const odd = base({ sessionAffinity: true, sessionAffinityTtl: '1d' });
    expect(validateTouchedTtl(odd, {})).toBeNull();
    expect(validateTouchedTtl(odd, { strategy: 'fill-first' })).toBeNull();
    expect(validateTouchedTtl(odd, { sessionAffinityTtl: '1d' })).toBeNull();
    expect(validateTouchedTtl(odd, { sessionAffinityTtl: '2d' })).toBe('invalid');
    expect(validateTouchedTtl(odd, { sessionAffinityTtl: '2h' })).toBeNull();
    expect(validateTouchedTtl(odd, { sessionAffinityTtl: '' })).toBeNull();
    // The plan for an unrelated edit does not touch the odd saved TTL.
    expect(buildRoutingSettingsPlan(odd, { strategy: 'fill-first' })).toEqual({
      patch: { routing: { strategy: 'fill-first' } },
      deletions: [],
    });
  });

  test('serializes the same wire fields as the Config page visual pipeline', () => {
    const before = [
      'routing:',
      '  strategy: fill-first',
      '  session-affinity: false',
      '  retry:',
      '    request-retry: 3',
      '',
    ].join('\n');
    const visual = runVisualConfig(before, [
      { routingStrategy: 'weighted-round-robin', routingSessionAffinity: true },
    ]);
    const visualPlan = buildConfigPatch(before, visual.applyVisualChangesToYaml(before));
    const ours = buildRoutingSettingsPlan(base({ strategy: 'fill-first' }), {
      strategy: 'weighted-round-robin',
      sessionAffinity: true,
    });
    expect(ours?.patch).toEqual(visualPlan.patch);
    expect(parseYaml(before).routing.retry).toEqual({ 'request-retry': 3 });
  });
});

describe('account priority and weight patches', () => {
  test('preserves arbitrary existing priorities and only writes changes', () => {
    const existing = { priority: 7, weight: 3 };
    expect(buildAccountTuningPatch(existing, {})).toEqual({});
    expect(buildAccountTuningPatch(existing, { priority: '7', weight: '3' })).toEqual({});
    expect(buildAccountTuningPatch(existing, { priority: '-4' })).toEqual({ priority: -4 });
    expect(buildAccountTuningPatch(existing, { priority: '250' })).toEqual({ priority: 250 });
  });

  test('blank restores defaults: priority 0, weight null', () => {
    expect(
      buildAccountTuningPatch({ priority: 7, weight: 3 }, { priority: '', weight: '' })
    ).toEqual({ priority: 0, weight: null });
    expect(buildAccountTuningPatch({}, { priority: '', weight: '' })).toEqual({});
    expect(buildAccountTuningPatch({}, { priority: '0' })).toEqual({});
  });

  test('weight 0 is written as a number, distinct from clearing it', () => {
    expect(buildAccountTuningPatch({ weight: 2 }, { weight: '0' })).toEqual({ weight: 0 });
    expect(buildAccountTuningPatch({}, { weight: '-1' })).toEqual({ weight: -1 });
  });

  test('invalid text writes nothing and reports the error', () => {
    expect(validateAccountTuning({ priority: '1.5' })).toEqual({ priority: 'integer' });
    expect(validateAccountTuning({ weight: '1000001' })).toEqual({ weight: 'max' });
    expect(validateAccountTuning({ weight: 'abc' })).toEqual({ weight: 'integer' });
    expect(buildAccountTuningPatch({ priority: 2 }, { priority: 'x', weight: '1.5' })).toEqual({});
  });

  test('dirty only when a field would actually change', () => {
    expect(isAccountTuningDirty({ priority: 5 }, undefined)).toBe(false);
    expect(isAccountTuningDirty({ priority: 5 }, { priority: '5' })).toBe(false);
    expect(isAccountTuningDirty({ priority: 5 }, { priority: '6' })).toBe(true);
    expect(isAccountTuningDirty({ priority: 5 }, { priority: 'x' })).toBe(false);
  });

  test('the illustration follows valid drafts and falls back to saved values for invalid ones', () => {
    const account = file({ priority: 5, weight: 2 });
    expect(toRoutingAccountInput(account)).toMatchObject({ priority: 5, weight: 2 });
    expect(toRoutingAccountInput(account, { priority: '9', weight: '' })).toMatchObject({
      priority: 9,
      weight: undefined,
    });
    expect(toRoutingAccountInput(account, { priority: 'x', weight: '1.5' })).toMatchObject({
      priority: 5,
      weight: 2,
    });
  });

  test('maps enablement and availability honestly', () => {
    expect(toRoutingAccountInput(file())).toMatchObject({
      enabled: true,
      availability: 'available',
    });
    expect(toRoutingAccountInput(file({ disabled: true, status: 'disabled' }))).toMatchObject({
      enabled: false,
    });
    expect(toRoutingAccountInput(file({ status: undefined }))).toMatchObject({
      enabled: true,
      availability: 'unknown',
    });
    expect(toRoutingAccountInput(file({ status: 'error', unavailable: true }))).toMatchObject({
      availability: 'unavailable',
    });
  });

  test('an optimistic patch keeps the local list consistent without a reload', () => {
    expect(
      applyTuningPatchToFile(file({ priority: 3, weight: 2 }), { priority: 0, weight: null })
    ).toEqual(file());
    expect(applyTuningPatchToFile(file(), { priority: 8, weight: 0 })).toMatchObject({
      priority: 8,
      weight: 0,
    });
  });
});

describe('global save orchestration', () => {
  test('saves through the revision-aware config patch and reports success', async () => {
    const { deps, plans } = recorder();
    const result = await saveGlobalRouting(deps, base(), { strategy: 'fill-first' });
    expect(result).toEqual({ kind: 'saved' });
    expect(plans).toEqual([{ patch: { routing: { strategy: 'fill-first' } }, deletions: [] }]);
  });

  test('an unchanged draft is a no-op and sends nothing', async () => {
    const { deps, plans } = recorder();
    expect(await saveGlobalRouting(deps, base(), { strategy: 'round-robin' })).toEqual({
      kind: 'noop',
    });
    expect(plans).toHaveLength(0);
  });

  test('a failed save reports the message and never claims success', async () => {
    const { deps } = recorder({ failConfig: new Error('revision conflict') });
    expect(await saveGlobalRouting(deps, base(), { sessionAffinity: true })).toEqual({
      kind: 'failed',
      message: 'revision conflict',
    });
  });

  test('a connection switch during the write is stale, for both success and failure', async () => {
    const switched = recorder({ during: (state) => void (state.revision += 1) });
    expect(await saveGlobalRouting(switched.deps, base(), { strategy: 'fill-first' })).toEqual({
      kind: 'stale',
    });
    const switchedFailing = recorder({
      failConfig: new Error('boom'),
      during: (state) => void (state.revision += 1),
    });
    expect(
      await saveGlobalRouting(switchedFailing.deps, base(), { strategy: 'fill-first' })
    ).toEqual({ kind: 'stale' });
  });

  test('an unmounted or superseded editor is stale', async () => {
    const gone = recorder({ during: (state) => void (state.current = false) });
    expect(await saveGlobalRouting(gone.deps, base(), { strategy: 'fill-first' })).toEqual({
      kind: 'stale',
    });
  });
});

describe('account save orchestration', () => {
  const entries = (): AccountTuningSaveEntry[] => [
    { name: 'a.json', file: { priority: 5 }, edits: { priority: '9' } },
    { name: 'b.json', file: { weight: 2 }, edits: { weight: '4' } },
    { name: 'c.json', file: {}, edits: { weight: '' } },
  ];

  test('saves every changed account and skips those with nothing to write', async () => {
    const { deps, patches } = recorder();
    const result = await saveAccountTunings(deps, entries());
    expect(result).toEqual({
      kind: 'done',
      saved: ['a.json', 'b.json'],
      failed: [],
      unchanged: ['c.json'],
    });
    expect(patches).toEqual([
      { name: 'a.json', patch: { priority: 9 } },
      { name: 'b.json', patch: { weight: 4 } },
    ]);
    if (result.kind === 'done') expect(summarizeAccountSave(result)).toBe('saved');
  });

  test('a partial failure keeps going, retains the failed draft and is not reported as success', async () => {
    const { deps } = recorder({ failAccounts: { 'b.json': new Error('credential is read-only') } });
    const result = await saveAccountTunings(deps, entries());
    expect(result).toEqual({
      kind: 'done',
      saved: ['a.json'],
      failed: [{ name: 'b.json', message: 'credential is read-only' }],
      unchanged: ['c.json'],
    });
    if (result.kind !== 'done') throw new Error('expected done');
    expect(summarizeAccountSave(result)).toBe('partial');
    expect(
      retainFailedTuningEdits(
        {
          'a.json': { priority: '9' },
          'b.json': { weight: '4' },
          'c.json': { weight: '' },
        },
        result,
        { 'a.json': { priority: '9' }, 'b.json': { weight: '4' }, 'c.json': { weight: '' } }
      )
    ).toEqual({ 'b.json': { weight: '4' } });
  });

  test('keeps a field typed while the save was in flight instead of dropping the whole draft', async () => {
    const { deps } = recorder();
    const submitted = { 'a.json': { priority: '9' }, 'b.json': { weight: '4' } };
    const result = await saveAccountTunings(deps, [
      { name: 'a.json', file: { priority: 5 }, edits: submitted['a.json'] },
      { name: 'b.json', file: { weight: 2 }, edits: submitted['b.json'] },
    ]);
    if (result.kind !== 'done') throw new Error('expected done');
    expect(result.saved).toEqual(['a.json', 'b.json']);
    // While saving, the user changed a.json's priority and typed a new weight on a.json.
    const current = {
      'a.json': { priority: '11', weight: '7' },
      'b.json': { weight: '4' },
    };
    expect(retainFailedTuningEdits(current, result, submitted)).toEqual({
      'a.json': { priority: '11', weight: '7' },
    });
    // Typing only a second field on b.json also counts as newer than what was submitted.
    expect(
      retainFailedTuningEdits({ 'b.json': { weight: '4', priority: '3' } }, result, submitted)
    ).toEqual({ 'b.json': { weight: '4', priority: '3' } });
  });

  test('when every account fails the batch is failed and all drafts are retained', async () => {
    const { deps } = recorder({
      failAccounts: { 'a.json': new Error('x'), 'b.json': new Error('y') },
    });
    const result = await saveAccountTunings(deps, entries().slice(0, 2));
    if (result.kind !== 'done') throw new Error('expected done');
    expect(summarizeAccountSave(result)).toBe('failed');
    expect(
      retainFailedTuningEdits({ 'a.json': { priority: '9' }, 'b.json': { weight: '4' } }, result, {
        'a.json': { priority: '9' },
        'b.json': { weight: '4' },
      })
    ).toEqual({ 'a.json': { priority: '9' }, 'b.json': { weight: '4' } });
  });

  test('invalid drafts are never sent', async () => {
    const { deps, patches } = recorder();
    const result = await saveAccountTunings(deps, [
      { name: 'a.json', file: {}, edits: { priority: '1.5' } },
    ]);
    expect(patches).toHaveLength(0);
    expect(result).toMatchObject({ kind: 'done', saved: [], failed: [{ name: 'a.json' }] });
  });

  test('a connection switch stops the batch: nothing further is sent and nothing is reported', async () => {
    const { deps, patches } = recorder({
      during: (state) => void (state.revision += 1),
    });
    expect(await saveAccountTunings(deps, entries())).toEqual({ kind: 'stale' });
    expect(patches).toHaveLength(1);
  });

  test('a stale completion is not reported even when the in-flight patch fails', async () => {
    const { deps } = recorder({
      failAccounts: { 'a.json': new Error('late failure') },
      during: (state) => void (state.current = false),
    });
    expect(await saveAccountTunings(deps, entries())).toEqual({ kind: 'stale' });
  });

  test('config and account saves are independent: one failing does not affect the other', async () => {
    const { deps, plans, patches } = recorder({ failConfig: new Error('config rejected') });
    const global = await saveGlobalRouting(deps, base(), { strategy: 'fill-first' });
    const accounts = await saveAccountTunings(deps, entries().slice(0, 1));
    expect(global.kind).toBe('failed');
    expect(accounts).toMatchObject({ kind: 'done', saved: ['a.json'] });
    expect(plans).toHaveLength(1);
    expect(patches).toHaveLength(1);
  });
});
