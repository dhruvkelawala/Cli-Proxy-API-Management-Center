import { describe, expect, test } from 'bun:test';
import { runReorder, type ReorderEffects } from '@/features/clientProfiles/routing/reorderFlow';
import { buildOrder, type OrderAccount } from '@/features/clientProfiles/routing/routingOrder';
import type { AuthFileItem } from '@/types';

const file = (id: string, note: string, priority?: number): AuthFileItem => ({
  id,
  name: id,
  type: 'claude',
  status: 'active',
  note,
  ...(priority === undefined ? {} : { priority }),
});

const orderOf = (files: AuthFileItem[]): OrderAccount[] =>
  buildOrder({ files, provider: 'claude', strategy: 'fill-first', sessionAffinity: true }).order;

type Call =
  | ['patch', string, unknown]
  | ['overrides', Record<string, number> | null]
  | ['saving', boolean]
  | ['reload']
  | ['changed']
  | ['notify', string, string, string | null];

/** Fake effects that record every call. `failNames` patches throw; `closeAfterPatches` unmounts. */
const harness = (
  options: {
    failNames?: string[];
    closeAfterPatches?: number;
    reloaded?: AuthFileItem[] | null;
    switchConnectionOnPatch?: boolean;
  } = {}
) => {
  const calls: Call[] = [];
  let open = true;
  let revision = 1;
  let patches = 0;
  const fx: ReorderEffects = {
    connectionRevision: () => revision,
    patchAccount: async (name, patch) => {
      calls.push(['patch', name, patch]);
      patches += 1;
      if (options.switchConnectionOnPatch) revision += 1;
      if (options.closeAfterPatches !== undefined && patches >= options.closeAfterPatches) {
        open = false;
      }
      if (options.failNames?.includes(name)) throw new Error('boom');
    },
    isPageOpen: () => open,
    setOverrides: (value) => calls.push(['overrides', value]),
    setSaving: (value) => calls.push(['saving', value]),
    reloadFiles: async () => {
      calls.push(['reload']);
      return options.reloaded === undefined ? null : options.reloaded;
    },
    notifyAccountsChanged: () => calls.push(['changed']),
    notify: (message, type, action) => calls.push(['notify', message, type, action?.label ?? null]),
    t: (key, values) => (values ? `${key} ${JSON.stringify(values)}` : key),
    firstLabelIn: (files) => orderOf(files)[0]?.label ?? null,
  };
  return { fx, calls };
};

const work = file('work.json', 'Work', 10);
const personal = file('personal.json', 'Personal');

describe('runReorder', () => {
  test('"make first" is a single PATCH and confirms with Undo', async () => {
    const { fx, calls } = harness();
    let undone = false;
    const outcome = await runReorder(
      orderOf([work, personal]),
      ['personal.json', 'work.json'],
      fx,
      () => (undone = true)
    );
    expect(outcome).toBe('saved');
    expect(calls.filter((c) => c[0] === 'patch')).toEqual([
      ['patch', 'personal.json', { priority: 20 }],
    ]);
    expect(calls).toContainEqual(['overrides', { 'personal.json': 20 }]);
    expect(calls.at(-1)).toEqual([
      'notify',
      'routing.saved {"account":"Personal"}',
      'success',
      'routing.undo',
    ]);
    expect(undone).toBe(false);
  });

  test('a failed write rolls the optimistic order back and says it was put back', async () => {
    const { fx, calls } = harness({ failNames: ['personal.json'] });
    const outcome = await runReorder(orderOf([work, personal]), ['personal.json', 'work.json'], fx);
    expect(outcome).toBe('failed');
    const overrides = calls.filter((c) => c[0] === 'overrides').map((c) => c[1]);
    // Optimistic first, then the rollback. Removing the rollback fails here.
    expect(overrides).toEqual([{ 'personal.json': 20 }, null]);
    expect(calls).toContainEqual(['reload']);
    expect(calls).toContainEqual([
      'notify',
      'routing.save_failed_detail {"message":"boom"}',
      'error',
      null,
    ]);
    expect(calls).not.toContainEqual(['changed']);
    expect(calls.at(-1)).toEqual(['saving', false]);
  });

  test('when an earlier write went through, the message says what the gateway has now', async () => {
    const a = file('a.json', 'Alpha', 20);
    const b = file('b.json', 'Beta', 10);
    const c = file('c.json', 'Gamma', 0);
    // a moves to the end: demotion of a first (succeeds), then the promotion of c fails.
    const afterPartial = [file('a.json', 'Alpha', 0), b, c];
    const { fx, calls } = harness({ failNames: ['c.json'], reloaded: afterPartial });
    const outcome = await runReorder(orderOf([a, b, c]), ['b.json', 'c.json', 'a.json'], fx);
    expect(outcome).toBe('partial');
    expect(calls.filter((x) => x[0] === 'patch').map((x) => x[1])).toEqual(['a.json', 'c.json']);
    const message = calls.find((x) => x[0] === 'notify');
    expect(message?.[1]).toBe('routing.save_partial {"message":"boom","account":"Beta"}');
    expect(message?.[1]).not.toContain('save_failed');
    expect(calls).toContainEqual(['changed']);
    expect(calls.filter((x) => x[0] === 'overrides').at(-1)).toEqual(['overrides', null]);
  });

  test('partial failure without a fresh list still avoids claiming a rollback', async () => {
    const a = file('a.json', 'Alpha', 20);
    const b = file('b.json', 'Beta', 10);
    const c = file('c.json', 'Gamma', 0);
    const { fx, calls } = harness({ failNames: ['c.json'], reloaded: null });
    await runReorder(orderOf([a, b, c]), ['b.json', 'c.json', 'a.json'], fx);
    expect(calls.find((x) => x[0] === 'notify')?.[1]).toBe(
      'routing.save_partial_unknown {"message":"boom"}'
    );
  });

  test('leaving the page mid-save does not stop the writes', async () => {
    const a = file('a.json', 'Alpha', 20);
    const b = file('b.json', 'Beta', 10);
    const c = file('c.json', 'Gamma', 0);
    // The page closes as soon as the first PATCH is sent.
    const { fx, calls } = harness({ closeAfterPatches: 1 });
    const outcome = await runReorder(orderOf([a, b, c]), ['b.json', 'c.json', 'a.json'], fx);
    expect(outcome).toBe('saved');
    expect(calls.filter((x) => x[0] === 'patch').map((x) => x[1])).toEqual([
      'a.json',
      'c.json',
      'b.json',
    ]);
    // No page UI after it closed, and no Undo on the toast.
    expect(calls.filter((x) => x[0] === 'saving')).toEqual([['saving', true]]);
    expect(calls.at(-1)?.[3]).toBeNull();
  });

  test('a connection switch stops the writes', async () => {
    const a = file('a.json', 'Alpha', 20);
    const b = file('b.json', 'Beta', 10);
    const c = file('c.json', 'Gamma', 0);
    const { fx, calls } = harness({ switchConnectionOnPatch: true });
    const outcome = await runReorder(orderOf([a, b, c]), ['b.json', 'c.json', 'a.json'], fx);
    expect(outcome).toBe('stale');
    expect(calls.filter((x) => x[0] === 'patch')).toHaveLength(1);
    expect(calls).not.toContainEqual(['reload']);
  });

  test('nothing to change writes nothing', async () => {
    const { fx, calls } = harness();
    expect(await runReorder(orderOf([work, personal]), ['work.json', 'personal.json'], fx)).toBe(
      'noop'
    );
    expect(calls).toEqual([]);
  });

  test('Undo (the previous order) is one write back, a demotion rather than a new raise', async () => {
    // After "make Personal first" the gateway has Work 10 / Personal 20.
    const { fx, calls } = harness();
    const outcome = await runReorder(
      orderOf([work, file('personal.json', 'Personal', 20)]),
      ['work.json', 'personal.json'],
      fx
    );
    expect(outcome).toBe('saved');
    expect(calls.filter((c) => c[0] === 'patch')).toEqual([
      ['patch', 'personal.json', { priority: 0 }],
    ]);
  });
});
