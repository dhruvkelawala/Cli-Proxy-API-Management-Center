/**
 * Which accounts' quota to re-read when a page opens. Shared by every page that shows quota
 * outside the Quota page itself (Overview, Accounts, Routing), so one fresh read serves all.
 * React-free.
 */

import { isAccountDisabled } from '@/features/authFiles/accountPresentation';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import type { AuthFileItem } from '@/types';

/** Quota older than this is re-read when a page opens. */
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
  fresh: QuotaFreshness = quotaFreshness
): AuthFileItem[] =>
  files.filter((file) => {
    if (isAccountDisabled(file)) return false;
    const marker = quotaMarker(connection, file);
    if (fresh.pending.has(marker) || attempted.has(marker)) return false;
    const last = fresh.readAt.get(marker);
    if (last !== undefined && now - last < QUOTA_MAX_AGE_MS) return false;
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
