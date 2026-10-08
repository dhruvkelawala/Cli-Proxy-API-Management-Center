/**
 * Account presentation model: what the Accounts page and the dashboard overview say
 * about each credential. React-free; consumed directly by tests/accountPresentation.test.ts.
 *
 * Three independent facts:
 * 1. Enablement — an operator choice. Disabled accounts are "off by choice", never a problem.
 * 2. Availability — only meaningful while enabled: available, cooling down, needs attention
 *    or unknown. Derived from the same signals as isProblemAuthFile so counts and the
 *    Problem filter always agree.
 * 3. Pool preference — where new automatic sessions start inside a provider pool. Mirrors the
 *    backend selector: the highest priority tier among usable accounts wins (default 0).
 *    Established session-affinity bindings outrank priority, so this never describes
 *    which account an existing session is using.
 */

import type { AuthFileItem } from '@/types';
import { isProblemAuthFile, normalizeProviderKey } from './constants';

export type AccountAvailability = 'available' | 'coolingDown' | 'attention' | 'unknown';

export type AccountPoolRole =
  /** Alone in the highest priority tier with other usable accounts below it. */
  | 'preferred'
  /** Shares the highest priority tier; the routing strategy spreads new sessions. */
  | 'shared'
  /** The only usable account in its provider pool. */
  | 'sole'
  /** Usable, but a higher-priority account is usable too. */
  | 'backup'
  /** Enabled but currently unusable (cooling down or needs attention). */
  | 'skipped'
  /** Disabled by the operator; excluded from the pool. */
  | 'excluded';

export type AccountPresentation = {
  availability: AccountAvailability | null;
  poolRole: AccountPoolRole;
  provider: string;
  /** Other accounts sharing the top tier when poolRole is 'shared'; otherwise 0. */
  peers: number;
};

export type AccountCounts = {
  total: number;
  enabled: number;
  disabled: number;
  available: number;
  coolingDown: number;
  attention: number;
  /** coolingDown + attention; equals the Problem filter size. */
  needsAttention: number;
  unknown: number;
};

const readStatus = (file: AuthFileItem): string =>
  typeof file.status === 'string' ? file.status.trim().toLowerCase() : '';

/**
 * The disabled flag is authoritative when present: after an optimistic re-enable the
 * stale status still reads 'disabled' until the next list refresh.
 */
export const isAccountDisabled = (file: AuthFileItem): boolean =>
  typeof file.disabled === 'boolean' ? file.disabled : readStatus(file) === 'disabled';

/** Server-measured cooldown evidence: an active timer or a future retry deadline. */
const hasCooldownEvidence = (file: AuthFileItem): boolean => {
  const records = file.cooldownSnapshot?.records ?? [];
  if (records.some((record) => record.remainingSeconds > 0)) return true;
  const nextRetry = file['next_retry_after'];
  return typeof nextRetry === 'string' && nextRetry.trim().length > 0;
};

/** null = disabled: availability is not evaluated for accounts that are off by choice. */
export const resolveAccountAvailability = (file: AuthFileItem): AccountAvailability | null => {
  if (isAccountDisabled(file)) return null;
  if (!isProblemAuthFile(file)) return readStatus(file) === 'active' ? 'available' : 'unknown';
  return file.unavailable === true && hasCooldownEvidence(file) ? 'coolingDown' : 'attention';
};

export const summarizeAccounts = (files: AuthFileItem[]): AccountCounts => {
  const counts: AccountCounts = {
    total: files.length,
    enabled: 0,
    disabled: 0,
    available: 0,
    coolingDown: 0,
    attention: 0,
    needsAttention: 0,
    unknown: 0,
  };
  files.forEach((file) => {
    const availability = resolveAccountAvailability(file);
    if (availability === null) {
      counts.disabled += 1;
      return;
    }
    counts.enabled += 1;
    counts[availability] += 1;
  });
  counts.needsAttention = counts.coolingDown + counts.attention;
  return counts;
};

export const accountProviderKey = (file: AuthFileItem): string =>
  normalizeProviderKey(String(file.type ?? file.provider ?? 'unknown')) || 'unknown';

const priorityOf = (file: AuthFileItem): number =>
  typeof file.priority === 'number' && Number.isSafeInteger(file.priority) ? file.priority : 0;

/** Usable for new sessions: enabled and not known to be failing. Unknown counts as usable. */
const isUsable = (availability: AccountAvailability | null): boolean =>
  availability === 'available' || availability === 'unknown';

export const presentAccounts = (files: AuthFileItem[]): Map<AuthFileItem, AccountPresentation> => {
  const availabilityByFile = new Map(files.map((file) => [file, resolveAccountAvailability(file)]));
  const usableByProvider = new Map<string, AuthFileItem[]>();
  files.forEach((file) => {
    if (!isUsable(availabilityByFile.get(file) ?? null)) return;
    const provider = accountProviderKey(file);
    const pool = usableByProvider.get(provider);
    if (pool) pool.push(file);
    else usableByProvider.set(provider, [file]);
  });

  const result = new Map<AuthFileItem, AccountPresentation>();
  files.forEach((file) => {
    const availability = availabilityByFile.get(file) ?? null;
    const provider = accountProviderKey(file);
    const base = { availability, provider, peers: 0 };
    if (availability === null) {
      result.set(file, { ...base, poolRole: 'excluded' });
      return;
    }
    if (!isUsable(availability)) {
      result.set(file, { ...base, poolRole: 'skipped' });
      return;
    }
    const usable = usableByProvider.get(provider) ?? [file];
    if (usable.length === 1) {
      result.set(file, { ...base, poolRole: 'sole' });
      return;
    }
    const topPriority = Math.max(...usable.map(priorityOf));
    if (priorityOf(file) < topPriority) {
      result.set(file, { ...base, poolRole: 'backup' });
      return;
    }
    const topTier = usable.filter((candidate) => priorityOf(candidate) === topPriority).length;
    result.set(
      file,
      topTier === 1
        ? { ...base, poolRole: 'preferred' }
        : { ...base, poolRole: 'shared', peers: topTier - 1 }
    );
  });
  return result;
};
