import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  QUOTA_MAX_AGE_MS,
  QUOTA_REFRESH_SLACK_MS,
  forgetQuotaReads,
  quotaWindowPassed,
  releaseQuotaTargets,
  settleQuotaReads,
  takeStaleQuotaTargets,
  type QuotaFreshness,
} from '@/features/quota/quotaFreshness';
import type { AuthFileItem } from '@/types';

const file: AuthFileItem = {
  id: 'w',
  name: 'w.json',
  type: 'claude',
  status: 'active',
  auth_index: 'a1',
};
const NOW = 1_000_000_000;
const freshness = (): QuotaFreshness => ({
  readAt: new Map(),
  pending: new Map(),
  invalidated: new Set(),
});

describe('quota re-reads while a page is open', () => {
  test('a fresh account is not re-read, unless one of its windows has reset', () => {
    const fresh = freshness();
    const before = { status: 'loading' };
    const read = { status: 'success' };
    expect(takeStaleQuotaTargets([file], 1, NOW, new Set(), () => before, fresh)).toHaveLength(1);
    settleQuotaReads([file], 1, NOW, () => read, fresh);
    // Fresh: skipped.
    expect(
      takeStaleQuotaTargets([file], 1, NOW + 60_000, new Set(), () => read, fresh)
    ).toHaveLength(0);
    // Due because a window reset: read again even though it is fresh.
    expect(
      takeStaleQuotaTargets(
        [file],
        1,
        NOW + 60_000,
        new Set(),
        () => undefined,
        fresh,
        () => true
      )
    ).toHaveLength(1);
  });

  test('the five-minute timer re-reads on its first tick (stale a minute early)', () => {
    const fresh = freshness();
    const read = { status: 'success' };
    takeStaleQuotaTargets([file], 1, NOW, new Set(), () => ({ status: 'loading' }), fresh);
    // The read settles a little after it started; the next timer tick is QUOTA_MAX_AGE_MS later.
    settleQuotaReads([file], 1, NOW + 2_000, () => read, fresh);
    const tick = NOW + QUOTA_MAX_AGE_MS;
    expect(takeStaleQuotaTargets([file], 1, tick, new Set(), () => read, fresh)).toHaveLength(1);
    // But not well before then.
    const fresh2 = freshness();
    takeStaleQuotaTargets([file], 1, NOW, new Set(), () => ({ status: 'loading' }), fresh2);
    settleQuotaReads([file], 1, NOW, () => read, fresh2);
    expect(
      takeStaleQuotaTargets(
        [file],
        1,
        NOW + QUOTA_MAX_AGE_MS - QUOTA_REFRESH_SLACK_MS - 1,
        new Set(),
        () => read,
        fresh2
      )
    ).toHaveLength(0);
  });

  test('cleared after a finished read (an edit): read again at once', () => {
    const fresh = freshness();
    const attempted = new Set<string>();
    const read = { status: 'success' };
    takeStaleQuotaTargets([file], 1, NOW, attempted, () => ({ status: 'loading' }), fresh);
    settleQuotaReads([file], 1, NOW, () => read, fresh);
    // The details sheet saves: the cache entry is cleared and the freshness forgotten.
    forgetQuotaReads(['w.json'], fresh);
    expect(fresh.readAt.size).toBe(0);
    // Same visit (already attempted), a few seconds later: due now, not in five minutes.
    expect(
      takeStaleQuotaTargets([file], 1, NOW + 5_000, attempted, () => undefined, fresh)
    ).toHaveLength(1);
  });

  test('cleared mid-read: the dropped read is released once the loader is idle, then re-read', () => {
    const fresh = freshness();
    const attempted = new Set<string>();
    takeStaleQuotaTargets([file], 1, NOW, attempted, () => undefined, fresh);
    expect(fresh.pending.size).toBe(1);
    forgetQuotaReads(['w.json'], fresh);
    // The loader's result for the cleared file is dropped, so the entry stays undefined.
    // While the loader is still busy nothing is decided...
    settleQuotaReads([file], 1, NOW + 1_000, () => undefined, fresh, true);
    expect(
      takeStaleQuotaTargets([file], 1, NOW + 1_000, attempted, () => undefined, fresh)
    ).toHaveLength(1);
    // ...and if a stale pending mark survived, an idle loader releases it.
    const stuck = freshness();
    stuck.pending.set(`1:w.json`, undefined);
    settleQuotaReads([file], 1, NOW, () => undefined, stuck, true);
    expect(stuck.pending.size).toBe(1);
    settleQuotaReads([file], 1, NOW, () => undefined, stuck, false);
    expect(stuck.pending.size).toBe(0);
  });

  test('invalidating auth-file caches forgets quota freshness too', () => {
    const source = readFileSync('src/features/authFiles/cacheInvalidation.ts', 'utf8');
    expect(source).toContain('forgetQuotaReads(names)');
  });

  test('a read that never started (loader busy) is released, so it is taken again', () => {
    const fresh = freshness();
    const attempted = new Set<string>();
    const first = takeStaleQuotaTargets([file], 1, NOW, attempted, () => undefined, fresh);
    expect(first).toHaveLength(1);
    // Still pending: a second pass skips it.
    expect(takeStaleQuotaTargets([file], 1, NOW, attempted, () => undefined, fresh)).toHaveLength(
      0
    );
    releaseQuotaTargets(first, 1, attempted, fresh);
    expect(fresh.pending.size).toBe(0);
    expect(takeStaleQuotaTargets([file], 1, NOW, attempted, () => undefined, fresh)).toHaveLength(
      1
    );
  });

  test('a window whose reset time passed marks the cached state as over', () => {
    expect(quotaWindowPassed({ windows: [{ resetAtMs: NOW - 1 }] }, NOW)).toBe(true);
    expect(quotaWindowPassed({ windows: [{ resetAtMs: NOW + 1 }, { resetAtMs: null }] }, NOW)).toBe(
      false
    );
    expect(quotaWindowPassed(undefined, NOW)).toBe(false);
  });

  test('the loader reports a skipped batch and both pages release on it; Overview/Accounts re-read on a timer', () => {
    const loader = readFileSync('src/features/quota/hooks/useQuotaBatchLoader.ts', 'utf8');
    expect(loader).toContain('if (loadingRef.current) return false;');
    for (const path of [
      'src/features/quota/hooks/useAccountQuota.ts',
      'src/features/clientProfiles/routing/useRoutingOrder.ts',
    ]) {
      expect(readFileSync(path, 'utf8')).toContain('if (!started) releaseQuotaTargets(');
    }
    const hook = readFileSync('src/features/quota/hooks/useAccountQuota.ts', 'utf8');
    expect(hook).toContain('useInterval(');
    expect(hook).toContain('quotaWindowPassed(stateFor(file), at)');
  });
});
