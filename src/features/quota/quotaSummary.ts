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

/**
 * The one number a list row shows: whichever window runs out first. `session`/`week` for the
 * five-hour and weekly windows; `limit` for other providers' windows (closest to its limit).
 */
export type QuotaIndicator =
  { status: 'ready'; left: number; window: 'session' | 'week' | 'limit' } | { status: 'loading' };

export const indicatorFromSummary = (summary: QuotaSummary): QuotaIndicator | null => {
  if (summary.status === 'loading') return { status: 'loading' };
  const tight = tightestWindow(summary);
  return tight ? { status: 'ready', left: tight.left, window: tight.window } : null;
};

const clampPercent = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

/**
 * Any provider's cached quota state, read generically: every object in it that says how much of
 * a window is used or left (`usedPercent`, `remainingPercent`, `remainingFraction`) counts, and
 * the one closest to its limit wins. Windows whose reset time has passed are ignored.
 */
export const genericQuotaIndicator = (
  state: unknown,
  now: number = Date.now()
): QuotaIndicator | null => {
  if (!state || typeof state !== 'object') return null;
  const status = (state as { status?: unknown }).status;
  if (status === 'loading') return { status: 'loading' };
  if (status !== 'success') return null;
  let lowest: number | null = null;
  const visit = (node: unknown, depth: number) => {
    if (!node || typeof node !== 'object' || depth > 5) return;
    if (Array.isArray(node)) {
      node.forEach((child) => visit(child, depth + 1));
      return;
    }
    const record = node as Record<string, unknown>;
    const reset = record.resetAtMs ?? record.resetAt;
    const over = typeof reset === 'number' && reset > 0 && reset <= now;
    let left: number | null = null;
    if (typeof record.usedPercent === 'number') left = 100 - record.usedPercent;
    else if (typeof record.remainingPercent === 'number') left = record.remainingPercent;
    else if (typeof record.remainingFraction === 'number') left = record.remainingFraction * 100;
    if (left !== null && Number.isFinite(left) && !over) {
      lowest = lowest === null ? clampPercent(left) : Math.min(lowest, clampPercent(left));
    }
    Object.values(record).forEach((child) => visit(child, depth + 1));
  };
  visit(state, 0);
  return lowest === null ? null : { status: 'ready', left: lowest, window: 'limit' };
};
