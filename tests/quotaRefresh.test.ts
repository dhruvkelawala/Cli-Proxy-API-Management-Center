import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  QUOTA_MAX_AGE_MS,
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
const freshness = (): QuotaFreshness => ({ readAt: new Map(), pending: new Map() });

describe('quota re-reads while a page is open', () => {
  test('a fresh account is not re-read, unless one of its windows has reset', () => {
    const fresh = freshness();
    const before = { status: 'loading' };
    expect(takeStaleQuotaTargets([file], 1, NOW, new Set(), () => before, fresh)).toHaveLength(1);
    settleQuotaReads([file], 1, NOW, () => ({ status: 'success' }), fresh);
    // Fresh: skipped.
    expect(
      takeStaleQuotaTargets([file], 1, NOW + 60_000, new Set(), () => undefined, fresh)
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

  test('after five minutes an account is stale again', () => {
    const fresh = freshness();
    takeStaleQuotaTargets([file], 1, NOW, new Set(), () => ({ status: 'loading' }), fresh);
    settleQuotaReads([file], 1, NOW, () => ({ status: 'success' }), fresh);
    expect(
      takeStaleQuotaTargets(
        [file],
        1,
        NOW + QUOTA_MAX_AGE_MS - 1,
        new Set(),
        () => undefined,
        fresh
      )
    ).toHaveLength(0);
    expect(
      takeStaleQuotaTargets(
        [file],
        1,
        NOW + QUOTA_MAX_AGE_MS + 1,
        new Set(),
        () => undefined,
        fresh
      )
    ).toHaveLength(1);
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
