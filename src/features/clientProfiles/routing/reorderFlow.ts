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

export type ReorderOutcome = 'noop' | 'saved' | 'failed' | 'partial' | 'stale';

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
  const result = await saveOrderChanges(
    {
      connectionRevision: fx.connectionRevision,
      applyConfigPlan: async () => {},
      patchAccount: fx.patchAccount,
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
