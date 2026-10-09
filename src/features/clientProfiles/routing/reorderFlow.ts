/**
 * Saving a new account order: plan the writes, show the result optimistically, write, then
 * roll back or confirm. React-free so every branch can be tested with fakes.
 *
 * - Writes go through the shared routing save helper (one PATCH /credentials/fields per
 *   account). "Make X first" is a single write (planMoveToFirst).
 * - Only a connection change stops the writes. Leaving the page does not: `isPageOpen` only
 *   decides whether the page's own state (overrides, saving flag, Undo) is still updated.
 * - On failure the optimistic order is dropped, the Accounts list is re-read, and the message
 *   says what the gateway has now when an earlier write already went through.
 */

import type { AuthFileFieldsPatch } from '@/services/api/authFiles';
import type { AuthFileItem, NotificationType } from '@/types';
import {
  saveAccountTunings,
  type RoutingSaveDeps,
} from '@/features/config/routing/routingSettingsState';
import { planReorder, type OrderAccount, type PriorityChange } from './routingOrder';

export type OrderSaveResult =
  | { kind: 'stale' }
  | { kind: 'done'; saved: string[]; failed: { name: string; message: string } | null };

/**
 * Writes the planned changes in order, one account at a time, stopping at the first failure.
 * `deps.isCurrent` must only reflect the connection: an open page is not a reason to stop.
 */
export const saveOrderChanges = async (
  deps: RoutingSaveDeps,
  changes: ReadonlyArray<Pick<PriorityChange, 'name' | 'from' | 'to'>>
): Promise<OrderSaveResult> => {
  const saved: string[] = [];
  for (const change of changes) {
    const result = await saveAccountTunings(deps, [
      {
        name: change.name,
        file: { priority: change.from },
        edits: { priority: String(change.to) },
      },
    ]);
    if (result.kind === 'stale') return { kind: 'stale' };
    const [failure] = result.failed;
    if (failure) return { kind: 'done', saved, failed: failure };
    saved.push(...result.saved);
  }
  return { kind: 'done', saved, failed: null };
};

export interface ReorderEffects {
  connectionRevision: () => number;
  patchAccount: (name: string, patch: AuthFileFieldsPatch) => Promise<unknown>;
  /** The Routing page is still mounted (UI updates only; never stops writes). */
  isPageOpen: () => boolean;
  /** Optimistic priorities by routing ID; null drops them (the saved list shows again). */
  setOverrides: (overrides: Record<string, number> | null) => void;
  setSaving: (saving: boolean) => void;
  /** Re-read the Accounts list; resolves to the new list, or null if it could not be read. */
  reloadFiles: () => Promise<AuthFileItem[] | null>;
  /** Tell other views (Accounts, sidebar count) that accounts changed. */
  notifyAccountsChanged: () => void;
  notify: (
    message: string,
    type: NotificationType,
    action?: { label: string; onAction: () => void }
  ) => void;
  t: (key: string, values?: Record<string, string | number>) => string;
  /** Label of the account that goes first in a freshly read list (null when unknown). */
  firstLabelIn: (files: AuthFileItem[]) => string | null;
}

export type ReorderOutcome = 'noop' | 'saved' | 'failed' | 'partial' | 'unconfirmed' | 'stale';

/** Statuses after which a write may or may not have been applied by the gateway. */
const UNCERTAIN_STATUSES = new Set([408, 502, 503, 504]);
const UNCERTAIN_CODES = new Set(['ECONNABORTED', 'ETIMEDOUT', 'ERR_NETWORK', 'ECONNRESET']);

/**
 * True when a failed write may still have reached the gateway: no HTTP response at all
 * (network error, timeout) or a gateway/timeout status. A 4xx/500 with a response is a refusal.
 */
export const isUncertainWriteError = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return true;
  const { status, code } = error as { status?: unknown; code?: unknown };
  if (typeof code === 'string' && UNCERTAIN_CODES.has(code)) return true;
  if (typeof status !== 'number' || !Number.isFinite(status) || status === 0) return true;
  return UNCERTAIN_STATUSES.has(status);
};

/* ------------------------------------------------------------------ */
/* One reorder at a time per connection and provider, across remounts   */
/* ------------------------------------------------------------------ */

type InFlightSlot = { revision: number; scope: string; done: Promise<void> };
const inFlight = new Map<string, InFlightSlot>();
const slotKey = (revision: number, scope: string) => `${revision}\u0000${scope}`;

/**
 * The save running for this connection and scope (a provider), which may belong to a page that
 * has since closed. Each provider has its own slot, so a Codex save never blocks Claude.
 */
export const reorderInFlight = (revision: number, scope = ''): Promise<void> | null =>
  inFlight.get(slotKey(revision, scope))?.done ?? null;

/** Every save still running for this connection, with its scope. */
export const reordersInFlight = (revision: number): { scope: string; done: Promise<void> }[] =>
  [...inFlight.values()]
    .filter((slot) => slot.revision === revision)
    .map(({ scope, done }) => ({ scope, done }));

/**
 * Runs `task` as the single reorder for this connection and scope. Returns false (and runs
 * nothing) while another one for the same scope is still writing, even if the page that
 * started it has unmounted.
 */
export const runExclusiveReorder = async (
  revision: number,
  task: () => Promise<unknown>,
  scope = ''
): Promise<boolean> => {
  if (reorderInFlight(revision, scope)) return false;
  let finish = () => {};
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const key = slotKey(revision, scope);
  const slot: InFlightSlot = { revision, scope, done };
  inFlight.set(key, slot);
  try {
    await task();
  } finally {
    if (inFlight.get(key) === slot) inFlight.delete(key);
    finish();
  }
  return true;
};

/**
 * Undo bound to the connection, page and scope (provider) it was offered on. It does nothing
 * after a connection change or once that page has closed; pressed while another save for the
 * same scope is still writing, it waits for that save and checks again, so it is never
 * silently dropped. `apply` re-plans from the page's current data (it goes through runReorder).
 */
export const makeGuardedUndo = (deps: {
  connectionRevision: () => number;
  isPageOpen: () => boolean;
  apply: () => Promise<unknown>;
  scope?: string;
}): (() => Promise<'applied' | 'ignored'>) => {
  const revision = deps.connectionRevision();
  const scope = deps.scope ?? '';
  const valid = () => deps.connectionRevision() === revision && deps.isPageOpen();
  return async () => {
    if (!valid()) return 'ignored';
    const pending = reorderInFlight(revision, scope);
    if (pending) {
      await pending;
      // Let the page take in the list that save re-read before planning from it.
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (!valid()) return 'ignored';
    }
    await deps.apply();
    return 'applied';
  };
};

export const runReorder = async (
  order: readonly OrderAccount[],
  nextIds: readonly string[],
  fx: ReorderEffects,
  /** Shown as Undo on the success toast; writes the previous order through this same path. */
  undo?: () => void
): Promise<ReorderOutcome> => {
  const changes = planReorder(order, nextIds);
  if (changes.length === 0) return 'noop';
  const first = order.find((account) => account.id === nextIds[0]);

  fx.setSaving(true);
  fx.setOverrides(Object.fromEntries(changes.map((change) => [change.id, change.to])));

  const revision = fx.connectionRevision();
  let lastError: unknown = null;
  const result = await saveOrderChanges(
    {
      connectionRevision: fx.connectionRevision,
      applyConfigPlan: async () => {},
      patchAccount: async (name, patch) => {
        try {
          return await fx.patchAccount(name, patch);
        } catch (error: unknown) {
          lastError = error;
          throw error;
        }
      },
      isCurrent: () => revision === fx.connectionRevision(),
    },
    changes
  );

  if (result.kind === 'stale') {
    // Another gateway: nothing here applies to it any more.
    fx.setOverrides(null);
    if (fx.isPageOpen()) fx.setSaving(false);
    return 'stale';
  }

  if (result.failed) {
    // Roll back the optimistic order, then show what the gateway really has.
    fx.setOverrides(null);
    const partial = result.saved.length > 0;
    if (partial) fx.notifyAccountsChanged();
    const files = await fx.reloadFiles();
    const message = result.failed.message;
    if (isUncertainWriteError(lastError)) {
      // The failed write may have landed: say so, and let the re-read list speak.
      if (!partial) fx.notifyAccountsChanged();
      fx.notify(fx.t('routing.save_unconfirmed'), 'error');
      if (fx.isPageOpen()) fx.setSaving(false);
      return 'unconfirmed';
    }
    if (partial) {
      const now = files ? fx.firstLabelIn(files) : null;
      fx.notify(
        now
          ? fx.t('routing.save_partial', { message: message || '—', account: now })
          : fx.t('routing.save_partial_unknown', { message: message || '—' }),
        'error'
      );
    } else {
      fx.notify(
        message ? fx.t('routing.save_failed_detail', { message }) : fx.t('routing.save_failed'),
        'error'
      );
    }
    if (fx.isPageOpen()) fx.setSaving(false);
    return partial ? 'partial' : 'failed';
  }

  fx.notifyAccountsChanged();
  await fx.reloadFiles();
  fx.setOverrides(null);
  const open = fx.isPageOpen();
  if (open) fx.setSaving(false);
  if (first) {
    fx.notify(
      fx.t('routing.saved', { account: first.label }),
      'success',
      open && undo ? { label: fx.t('routing.undo'), onAction: undo } : undefined
    );
  }
  return 'saved';
};
