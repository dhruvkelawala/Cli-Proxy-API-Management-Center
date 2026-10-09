import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiClient } from '@/services/api';
import { useQuotaStore } from '@/stores';
import { useNow } from '@/hooks/useNow';
import { useInterval } from '@/hooks/useInterval';
import type { AuthFileItem } from '@/types';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import { accountProviderKey } from '@/features/authFiles/accountPresentation';
import {
  QUOTA_MAX_AGE_MS,
  quotaWindowPassed,
  releaseQuotaTargets,
  settleQuotaReads,
  takeStaleQuotaTargets,
} from '../quotaFreshness';
import {
  NO_QUOTA,
  summarizeQuota,
  type QuotaSummary,
  type WindowedQuotaState,
} from '../quotaSummary';
import { useQuotaBatchLoader } from './useQuotaBatchLoader';

/** Providers whose quota has a five-hour and a weekly window. */
export const WINDOWED_QUOTA_PROVIDERS = ['claude', 'codex'] as const;
export type WindowedQuotaProvider = (typeof WINDOWED_QUOTA_PROVIDERS)[number];

export const windowedQuotaProviderOf = (file: AuthFileItem): WindowedQuotaProvider | null => {
  const provider = accountProviderKey(file);
  return (WINDOWED_QUOTA_PROVIDERS as readonly string[]).includes(provider)
    ? (provider as WindowedQuotaProvider)
    : null;
};

/**
 * Five-hour and weekly room left for Claude and Codex accounts, from the Quota page's cache and
 * loader. When the page opens, anything not read successfully in the last five minutes is read
 * (see quotaFreshness); while it stays open, quota is re-read every five minutes and as soon as a
 * window's reset time passes. `files` null means the list is not loaded yet.
 */
export function useAccountQuota(files: readonly AuthFileItem[] | null) {
  const claudeQuota = useQuotaStore((state) => state.claudeQuota);
  const codexQuota = useQuotaStore((state) => state.codexQuota);
  const { loadQuota } = useQuotaBatchLoader();
  // Minute clock: windows that reset while the page is open drop out on the next tick.
  const now = useNow();

  const stateFor = useCallback(
    (file: AuthFileItem): WindowedQuotaState | undefined => {
      const provider = windowedQuotaProviderOf(file);
      if (provider === 'claude') return claudeQuota[getQuotaCacheKey(file)];
      if (provider === 'codex') return codexQuota[getQuotaCacheKey(file)];
      return undefined;
    },
    [claudeQuota, codexQuota]
  );

  const quotaFiles = useMemo(
    () => (files ?? []).filter((file) => windowedQuotaProviderOf(file) !== null),
    [files]
  );

  const attempted = useRef(new Set<string>());
  // Every five minutes this visit may ask again (also retries reads that failed).
  const [round, setRound] = useState(0);
  useInterval(() => {
    attempted.current.clear();
    setRound((value) => value + 1);
  }, QUOTA_MAX_AGE_MS);

  useEffect(() => {
    const connection = apiClient.getConnectionRevision();
    const at = Date.now();
    settleQuotaReads(quotaFiles, connection, at, stateFor);
    const stale = takeStaleQuotaTargets(
      quotaFiles,
      connection,
      at,
      attempted.current,
      stateFor,
      undefined,
      // A window that reset since it was read is over: read the new one now.
      (file) => quotaWindowPassed(stateFor(file), at)
    );
    if (stale.length === 0) return;
    void loadQuota(
      stale.map((file) => ({
        file,
        type: windowedQuotaProviderOf(file) as WindowedQuotaProvider,
      }))
    ).then((started) => {
      // Busy with another batch: nothing was read, so these must not stay pending forever.
      if (!started) releaseQuotaTargets(stale, connection, attempted.current);
    });
    // `now` (minute clock) re-checks reset times; `round` is the five-minute re-read.
  }, [loadQuota, quotaFiles, stateFor, now, round]);

  const quotaFor = useCallback(
    (file: AuthFileItem): QuotaSummary =>
      windowedQuotaProviderOf(file) ? summarizeQuota(stateFor(file), now) : NO_QUOTA,
    [now, stateFor]
  );

  return { quotaFor, now };
}
