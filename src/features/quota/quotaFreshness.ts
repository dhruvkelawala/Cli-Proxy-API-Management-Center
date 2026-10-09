/**
 * Which accounts' quota to re-read when a page opens. Shared by every page that shows quota
 * outside the Quota page itself (Overview, Accounts, Routing), so one fresh read serves all.
 * React-free.
 */

import { isAccountDisabled } from '@/features/authFiles/accountPresentation';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import type { AuthFileItem } from '@/types';

/** Quota older than this is re-read when a page opens, and again on this timer while it is open. */
export const QUOTA_MAX_AGE_MS = 5 * 60_000;

/**
 * Quota freshness as these pages know it, per `connection:cacheKey`. The Quota page's cache has
 * no timestamps, so an account only counts as fresh after a read one of them saw succeed.
 */
export interface QuotaFreshness {
  /** When a read succeeded. */
  readAt: Map<string, number>;
  /** Reads asked for and not settled yet, with the cache entry they replace. */
  pending: Map<string, unknown>;
}
const quotaFreshness: QuotaFreshness = { readAt: new Map(), pending: new Map() };

const quotaMarker = (connection: number, file: AuthFileItem) =>
  `${connection}:${getQuotaCacheKey(file)}`;

/**
 * Accounts whose quota should be read now; they are marked pending. `attempted` holds what
 * this page visit already asked for, so a failed read is retried on the next visit rather
 * than in a loop.
 */
export const takeStaleQuotaTargets = (
  files: readonly AuthFileItem[],
  connection: number,
  now: number,
  attempted: Set<string>,
  stateFor: (file: AuthFileItem) => unknown,
  fresh: QuotaFreshness = quotaFreshness,
  /** Read now even if fresh (e.g. a window's reset time has passed). */
  isDue: (file: AuthFileItem) => boolean = () => false
): AuthFileItem[] =>
  files.filter((file) => {
    if (isAccountDisabled(file)) return false;
    const marker = quotaMarker(connection, file);
    if (fresh.pending.has(marker) || attempted.has(marker)) return false;
    const last = fresh.readAt.get(marker);
    if (last !== undefined && now - last < QUOTA_MAX_AGE_MS && !isDue(file)) return false;
    attempted.add(marker);
    fresh.pending.set(marker, stateFor(file));
    return true;
  });

/**
 * Settles pending reads once their cache entry has been replaced: a success marks the account
 * fresh; a failure only clears the pending mark, so the account stays stale and is retried.
 */
export const settleQuotaReads = (
  files: readonly AuthFileItem[],
  connection: number,
  now: number,
  stateFor: (file: AuthFileItem) => { status: string } | undefined,
  fresh: QuotaFreshness = quotaFreshness
): void => {
  files.forEach((file) => {
    const marker = quotaMarker(connection, file);
    if (!fresh.pending.has(marker)) return;
    const state = stateFor(file);
    if (state === fresh.pending.get(marker) || !state || state.status === 'loading') return;
    if (state.status === 'success') fresh.readAt.set(marker, now);
    fresh.pending.delete(marker);
  });
};

/**
 * Undo takeStaleQuotaTargets for reads that never started (the loader was busy): the accounts
 * are no longer pending and can be taken again on the next pass.
 */
export const releaseQuotaTargets = (
  files: readonly AuthFileItem[],
  connection: number,
  attempted: Set<string>,
  fresh: QuotaFreshness = quotaFreshness
): void => {
  files.forEach((file) => {
    const marker = quotaMarker(connection, file);
    fresh.pending.delete(marker);
    attempted.delete(marker);
  });
};

/** A window in this cached state has reset since it was read: what it says is over. */
export const quotaWindowPassed = (
  state: { windows?: ReadonlyArray<{ resetAtMs?: number | null }> } | undefined,
  now: number
): boolean =>
  Boolean(
    state?.windows?.some(
      (window) => typeof window.resetAtMs === 'number' && window.resetAtMs <= now
    )
  );
