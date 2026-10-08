/**
 * Account presentation model: what the Accounts page and the dashboard overview say
 * about each credential. React-free; consumed directly by tests/accountPresentation.test.ts.
 *
 * Three independent facts:
 * 1. Enablement — an operator choice. Disabled accounts are "off by choice", never a problem.
 * 2. Availability — only meaningful while enabled: available, cooling down, needs attention
 *    or unknown. Derived from the same signals as isProblemAuthFile so counts and the
 *    Problem filter always agree.
 * 3. Pool preference — where new automatic sessions start among the listed accounts of a
 *    provider. Mirrors the backend selector: the highest priority tier among accounts not
 *    marked unavailable wins (default 0).
 *    Established session-affinity bindings outrank priority, so this never describes
 *    which account an existing session is using.
 */

import type { AuthFileItem } from '@/types';
import { isProblemAuthFile, normalizeProviderKey } from './constants';

export type AccountAvailability = 'available' | 'coolingDown' | 'attention' | 'unknown';

export type AccountPoolRole =
  /** Alone in the highest listed priority tier with other listed pool members below it. */
  | 'preferred'
  /** Shares the highest listed priority tier; the routing strategy spreads new sessions. */
  | 'shared'
  /** The only listed pool member for its provider. */
  | 'sole'
  /** In the pool, but another listed member has a higher priority. */
  | 'backup'
  /** Enabled but marked unavailable by the backend (cooldown, quota, auth failure). */
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

/**
 * Listed pool member: enabled and not marked unavailable. Mirrors the backend selector,
 * which only skips unavailable credentials; an error status or stale warning alone does not
 * take an account out of the pool. Only the auth-file list is known here — config API keys,
 * per-model cooldowns, excluded models and prefix pools are not modelled, so roles describe
 * this list rather than the whole pool.
 */
const isPoolMember = (file: AuthFileItem, availability: AccountAvailability | null): boolean =>
  availability !== null && file.unavailable !== true;

export const presentAccounts = (files: AuthFileItem[]): Map<AuthFileItem, AccountPresentation> => {
  const availabilityByFile = new Map(files.map((file) => [file, resolveAccountAvailability(file)]));
  const poolByProvider = new Map<string, AuthFileItem[]>();
  files.forEach((file) => {
    if (!isPoolMember(file, availabilityByFile.get(file) ?? null)) return;
    const provider = accountProviderKey(file);
    const members = poolByProvider.get(provider);
    if (members) members.push(file);
    else poolByProvider.set(provider, [file]);
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
    if (!isPoolMember(file, availability)) {
      result.set(file, { ...base, poolRole: 'skipped' });
      return;
    }
    const pool = poolByProvider.get(provider) ?? [file];
    if (pool.length === 1) {
      result.set(file, { ...base, poolRole: 'sole' });
      return;
    }
    const topPriority = Math.max(...pool.map(priorityOf));
    if (priorityOf(file) < topPriority) {
      result.set(file, { ...base, poolRole: 'backup' });
      return;
    }
    const topTier = pool.filter((candidate) => priorityOf(candidate) === topPriority).length;
    result.set(
      file,
      topTier === 1
        ? { ...base, poolRole: 'preferred' }
        : { ...base, poolRole: 'shared', peers: topTier - 1 }
    );
  });
  return result;
};
