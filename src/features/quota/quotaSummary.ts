/**
 * Five-hour and weekly room left for one account, read from the Quota page's cached state.
 * Shared by Overview, Accounts and Routing so every page says the same thing. React-free.
 */

export interface QuotaSummary {
  status: 'loading' | 'ready' | 'none';
  /** Percent left, 0-100. */
  sessionLeft: number | null;
  sessionResetAt: number | null;
  weekLeft: number | null;
  weekResetAt: number | null;
  /**
   * The raw used percent reached 100: the window is really out. `sessionLeft` rounds, so 99.5%
   * used shows as 0% left without being out yet. Undefined (older callers) falls back to
   * "0% left".
   */
  sessionExhausted?: boolean;
  weekExhausted?: boolean;
}

export const NO_QUOTA: QuotaSummary = {
  status: 'none',
  sessionLeft: null,
  sessionResetAt: null,
  weekLeft: null,
  weekResetAt: null,
};

/** The fields this module reads; Claude and Codex quota states both have them. */
export interface WindowedQuotaState {
  status: 'idle' | 'loading' | 'success' | 'error';
  windows: ReadonlyArray<{
    usedPercent: number | null;
    resetAtMs?: number | null;
    periodHours?: number | null;
  }>;
}

const exhausted = (used: number | null | undefined) =>
  typeof used === 'number' && Number.isFinite(used) && used >= 100;

const percentLeft = (used: number | null | undefined) =>
  typeof used === 'number' && Number.isFinite(used)
    ? Math.max(0, Math.min(100, Math.round(100 - used)))
    : null;

/**
 * Weekly and five-hour room left. A window whose reset time has already passed describes a
 * period that is over, so it is ignored (unknown) rather than shown as current.
 */
export const summarizeQuota = (
  state: WindowedQuotaState | undefined,
  now: number = Date.now()
): QuotaSummary => {
  if (!state || state.status === 'idle' || state.status === 'error') return NO_QUOTA;
  if (state.status === 'loading') return { ...NO_QUOTA, status: 'loading' };
  const current = <T extends { resetAtMs?: number | null }>(window: T | undefined): T | null =>
    window && !(typeof window.resetAtMs === 'number' && window.resetAtMs <= now) ? window : null;
  const sessionWindow = state.windows.find((window) => window.periodHours === 5);
  const session = current(sessionWindow);
  const week = current(
    state.windows.find((window) => window !== sessionWindow && window.periodHours === 168)
  );
  if (!session && !week) return NO_QUOTA;
  return {
    status: 'ready',
    sessionLeft: percentLeft(session?.usedPercent),
    sessionResetAt: session?.resetAtMs ?? null,
    weekLeft: percentLeft(week?.usedPercent),
    weekResetAt: week?.resetAtMs ?? null,
    sessionExhausted: exhausted(session?.usedPercent),
    weekExhausted: exhausted(week?.usedPercent),
  };
};

/** A window that is out: the raw used percent reached 100 (or, without that fact, 0% left). */
export const windowOut = (left: number | null, isExhausted: boolean | undefined): boolean =>
  isExhausted ?? left === 0;

/** Shows 0% left (rounded) but the backend has not run out yet. */
export const windowNearlyOut = (left: number | null, isExhausted: boolean | undefined): boolean =>
  left === 0 && isExhausted === false;

/** The tighter of the two windows (what runs out first), for one-rail summaries. */
export const tightestWindow = (
  quota: QuotaSummary
): { window: 'session' | 'week'; left: number; resetAt: number | null } | null => {
  if (quota.status !== 'ready') return null;
  const { sessionLeft, weekLeft } = quota;
  if (sessionLeft === null && weekLeft === null) return null;
  if (weekLeft === null || (sessionLeft !== null && sessionLeft < weekLeft)) {
    return { window: 'session', left: sessionLeft as number, resetAt: quota.sessionResetAt };
  }
  return { window: 'week', left: weekLeft, resetAt: quota.weekResetAt };
};
