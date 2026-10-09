/**
 * Which accounts' quota to re-read when a page opens. Shared by every page that shows quota
 * outside the Quota page itself (Overview, Accounts, Routing), so one fresh read serves all.
 * React-free.
 */

import { isAccountDisabled } from '@/features/authFiles/accountPresentation';
import { getQuotaCacheFileName, getQuotaCacheKey } from '@/utils/quota/identity';
import type { AuthFileItem } from '@/types';

/** Quota older than this is re-read when a page opens, and again on this timer while it is open. */
export const QUOTA_MAX_AGE_MS = 5 * 60_000;
/**
 * A read counts as stale this much before QUOTA_MAX_AGE_MS. The open page re-checks on a
 * QUOTA_MAX_AGE_MS timer, and a read settles a little after it starts; without the slack an
 * account read just after the page opened would wait for the following tick (about 10 minutes).
 */
export const QUOTA_REFRESH_SLACK_MS = 60_000;

/**
 * Quota freshness as these pages know it, per `connection:cacheKey`. The Quota page's cache has
 * no timestamps, so an account only counts as fresh after a read one of them saw succeed.
 */
export interface QuotaFreshness {
  /** When a read succeeded. */
  readAt: Map<string, number>;
  /** Reads asked for and not settled yet, with the cache entry they replace. */
  pending: Map<string, unknown>;
  /**
   * File names whose cached quota was cleared (details saved, credential refreshed or
   * re-uploaded) and should be read again at once, even if this visit already asked.
   */
  invalidated?: Set<string>;
}
const quotaFreshness: QuotaFreshness = {
  readAt: new Map(),
  pending: new Map(),
  invalidated: new Set(),
};

const quotaMarker = (connection: number, file: AuthFileItem) =>
  `${connection}:${getQuotaCacheKey(file)}`;
const fileNameOf = (file: AuthFileItem) => getQuotaCacheFileName(getQuotaCacheKey(file));
const markerFileName = (marker: string) =>
  getQuotaCacheFileName(marker.slice(marker.indexOf(':') + 1));

/**
 * Forget what is known about these accounts' quota (all accounts when `names` is omitted):
 * call it whenever their cached quota is cleared, so the pages read it again at once instead of
 * waiting out a freshness window or a read that can no longer land.
 */
export const forgetQuotaReads = (
  names?: readonly string[],
  fresh: QuotaFreshness = quotaFreshness
): void => {
  if (!names) {
    fresh.readAt.clear();
    fresh.pending.clear();
    fresh.invalidated?.clear();
    return;
  }
  const forgotten = new Set(names);
  for (const map of [fresh.readAt, fresh.pending] as Map<string, unknown>[]) {
    Array.from(map.keys()).forEach((marker) => {
      if (forgotten.has(markerFileName(marker))) map.delete(marker);
    });
  }
  if (!fresh.invalidated) fresh.invalidated = new Set();
  names.forEach((name) => fresh.invalidated!.add(name));
};

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
    if (fresh.pending.has(marker)) return false;
    const state = stateFor(file);
    // Cleared since this visit asked (an edit, a refresh): read again despite `attempted`.
    const invalidated = state === undefined && fresh.invalidated?.has(fileNameOf(file)) === true;
    if (attempted.has(marker) && !invalidated) return false;
    const last = fresh.readAt.get(marker);
    const fresher = last !== undefined && now - last < QUOTA_MAX_AGE_MS - QUOTA_REFRESH_SLACK_MS;
    // Nothing cached is always due.
    if (fresher && state !== undefined && !isDue(file)) return false;
    attempted.add(marker);
    fresh.invalidated?.delete(fileNameOf(file));
    fresh.pending.set(marker, state);
    return true;
  });

/**
 * Settles pending reads once their cache entry has been replaced: a success marks the account
 * fresh; a failure only clears the pending mark, so the account stays stale and is retried.
 * With the loader idle, a pending read whose cache entry is gone (cleared mid-read, so its
 * result was dropped) is released too, so the account is not left pending forever.
 */
export const settleQuotaReads = (
  files: readonly AuthFileItem[],
  connection: number,
  now: number,
  stateFor: (file: AuthFileItem) => { status: string } | undefined,
  fresh: QuotaFreshness = quotaFreshness,
  loaderBusy = false
): void => {
  files.forEach((file) => {
    const marker = quotaMarker(connection, file);
    if (!fresh.pending.has(marker)) return;
    const state = stateFor(file);
    if (!state) {
      if (!loaderBusy) fresh.pending.delete(marker);
      return;
    }
    if (state === fresh.pending.get(marker) || state.status === 'loading') return;
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
