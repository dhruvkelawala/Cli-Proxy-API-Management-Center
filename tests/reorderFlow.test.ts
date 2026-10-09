import { describe, expect, test } from 'bun:test';
import {
  isUncertainWriteError,
  makeGuardedUndo,
  reorderInFlight,
  runExclusiveReorder,
  runReorder,
  type ReorderEffects,
} from '@/features/clientProfiles/routing/reorderFlow';
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
    /** What a failing patch throws; defaults to a refusal (HTTP 500 with a response). */
    failWith?: () => unknown;
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
      if (options.failNames?.includes(name)) {
        throw options.failWith
          ? options.failWith()
          : Object.assign(new Error('boom'), { status: 500 });
      }
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

describe('round 2: uncertain failures, exclusive saves and guarded Undo', () => {
  test('a network error or timeout says the order could not be confirmed, after the re-read', async () => {
    for (const failWith of [
      () => Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' }),
      () => Object.assign(new Error('timeout'), { code: 'ECONNABORTED' }),
      () => Object.assign(new Error('Gateway Timeout'), { status: 504 }),
    ]) {
      const { fx, calls } = harness({ failNames: ['personal.json'], failWith });
      const outcome = await runReorder(
        orderOf([work, personal]),
        ['personal.json', 'work.json'],
        fx
      );
      expect(outcome).toBe('unconfirmed');
      const reloadAt = calls.findIndex((c) => c[0] === 'reload');
      const notifyAt = calls.findIndex((c) => c[0] === 'notify');
      expect(reloadAt).toBeGreaterThanOrEqual(0);
      expect(notifyAt).toBeGreaterThan(reloadAt);
      expect(calls[notifyAt]).toEqual(['notify', 'routing.save_unconfirmed', 'error', null]);
      // The write may have landed: other views re-read too, and nothing says "put back".
      expect(calls).toContainEqual(['changed']);
      expect(JSON.stringify(calls)).not.toContain('save_failed');
    }
  });

  test('a refusal with a response is still reported as put back', () => {
    expect(isUncertainWriteError({ status: 500 })).toBe(false);
    expect(isUncertainWriteError({ status: 400 })).toBe(false);
    expect(isUncertainWriteError({ status: 503 })).toBe(true);
    expect(isUncertainWriteError({ code: 'ETIMEDOUT', status: 500 })).toBe(true);
    expect(isUncertainWriteError({})).toBe(true);
  });

  test('only one reorder runs per connection, even if the page that started it closed', async () => {
    let release = () => {};
    const first = runExclusiveReorder(
      7,
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    expect(reorderInFlight(7)).not.toBeNull();
    let ran = false;
    expect(
      await runExclusiveReorder(7, async () => {
        ran = true;
      })
    ).toBe(false);
    expect(ran).toBe(false);
    // Another connection is not blocked by it.
    expect(reorderInFlight(8)).toBeNull();
    release();
    expect(await first).toBe(true);
    expect(reorderInFlight(7)).toBeNull();
  });

  test('Undo does nothing after a connection change or once its page has closed', async () => {
    let revision = 1;
    let open = true;
    let applied = 0;
    const undo = makeGuardedUndo({
      connectionRevision: () => revision,
      isPageOpen: () => open,
      apply: async () => {
        applied += 1;
      },
    });
    revision = 2;
    expect(await undo()).toBe('ignored');
    revision = 1;
    open = false;
    expect(await undo()).toBe('ignored');
    open = true;
    expect(await undo()).toBe('applied');
    expect(applied).toBe(1);
  });

  test('Undo pressed during another save waits for it instead of being dropped', async () => {
    let release = () => {};
    const save = runExclusiveReorder(
      11,
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    let applied = false;
    const undo = makeGuardedUndo({
      connectionRevision: () => 11,
      isPageOpen: () => true,
      apply: async () => {
        applied = true;
      },
    });
    const result = undo();
    await Promise.resolve();
    expect(applied).toBe(false);
    release();
    await save;
    expect(await result).toBe('applied');
    expect(applied).toBe(true);
  });

  test('Undo waiting on a save is dropped if the connection changes meanwhile', async () => {
    let release = () => {};
    let revision = 21;
    const save = runExclusiveReorder(
      21,
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    const undo = makeGuardedUndo({
      connectionRevision: () => revision,
      isPageOpen: () => true,
      apply: async () => {
        throw new Error('must not run');
      },
    });
    const result = undo();
    revision = 22;
    release();
    await save;
    expect(await result).toBe('ignored');
  });
});
