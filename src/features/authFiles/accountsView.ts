/**
 * The Accounts page's main view: the sentence at the top, accounts grouped by provider, and
 * each row's status in plain words. React-free; copy is returned as i18n key descriptors.
 *
 * Status semantics are CPA-004's (accountPresentation): enablement, availability and pool
 * preference stay three separate facts.
 */

import type { AuthFileItem } from '@/types';
import type { StatusTone } from '@/components/flow/StatusDot';
import type { Copy } from '@/features/clientProfiles/routing/routingOrder';
import {
  accountProviderKey,
  type AccountAvailability,
  type AccountCounts,
  type AccountPresentation,
} from './accountPresentation';

const A = 'auth_files.flow';

/** Providers the user lives in first; the rest keep their first-seen order. */
const PROVIDER_ORDER = ['claude', 'codex'];

export interface ProviderSection {
  provider: string;
  files: AuthFileItem[];
}

/** Rows grouped by provider, keeping the list's own order inside each group. */
export const groupByProvider = (files: readonly AuthFileItem[]): ProviderSection[] => {
  const sections = new Map<string, AuthFileItem[]>();
  files.forEach((file) => {
    const provider = accountProviderKey(file);
    const list = sections.get(provider);
    if (list) list.push(file);
    else sections.set(provider, [file]);
  });
  const rank = (provider: string) => {
    const index = PROVIDER_ORDER.indexOf(provider);
    return index < 0 ? PROVIDER_ORDER.length : index;
  };
  const seen = Array.from(sections.keys());
  return seen
    .sort((a, b) => rank(a) - rank(b) || seen.indexOf(a) - seen.indexOf(b))
    .map((provider) => ({ provider, files: sections.get(provider) ?? [] }));
};

type StateKey = AccountAvailability | 'off';

const STATE_KEYS: Record<StateKey, string> = {
  available: 'auth_files.account_state_available',
  coolingDown: 'auth_files.account_state_cooling',
  attention: 'auth_files.account_state_attention',
  unknown: 'auth_files.account_state_unknown',
  off: 'auth_files.account_state_off',
};

const STATE_TONES: Record<StateKey, StatusTone> = {
  available: 'ok',
  coolingDown: 'warn',
  attention: 'bad',
  unknown: 'unknown',
  off: 'off',
};

/** The status dot and its words for one account (CPA-004 availability, or off by choice). */
export const accountStatus = (
  presentation: AccountPresentation | undefined
): { tone: StatusTone; key: string } => {
  const state: StateKey = presentation ? (presentation.availability ?? 'off') : 'unknown';
  return { tone: STATE_TONES[state], key: STATE_KEYS[state] };
};

/** Where the account sits in its provider's pool, in plain words. */
export const poolCopy = (presentation: AccountPresentation, provider: string): Copy => {
  if (presentation.availability === 'attention' && presentation.poolRole !== 'skipped') {
    return { key: 'auth_files.pool_attention' };
  }
  if (presentation.poolRole === 'shared') {
    return { key: 'auth_files.pool_shared', values: { count: presentation.peers } };
  }
  return { key: `auth_files.pool_${presentation.poolRole}`, values: { provider } };
};

/**
 * The headline: how many accounts, then the one thing worth knowing. Names are used when a
 * single account needs a person, counts when several do.
 */
export const describeAccounts = (
  counts: AccountCounts,
  problems: Array<{ name: string; availability: AccountAvailability | null }>
): Copy[] => {
  if (counts.total === 0) return [{ key: `${A}.empty` }];
  const head: Copy = { key: `${A}.count`, values: { count: counts.total } };
  if (counts.enabled === 0) return [head, { key: `${A}.all_off` }];
  if (counts.needsAttention === 1 && problems.length === 1) {
    const [only] = problems;
    return [
      head,
      only.availability === 'coolingDown'
        ? { key: `${A}.cooling`, values: { name: only.name } }
        : { key: `${A}.attention`, values: { name: only.name } },
    ];
  }
  if (counts.needsAttention > 1) {
    return [head, { key: `${A}.attention_many`, values: { count: counts.needsAttention } }];
  }
  if (counts.unknown > 0 && counts.available === 0) return [head, { key: `${A}.unknown` }];
  return [
    head,
    counts.disabled > 0
      ? { key: `${A}.all_working_off`, values: { count: counts.disabled } }
      : { key: `${A}.all_working` },
  ];
};

/** With provider headings in the list, tabs only help on longer lists (or to leave a filter). */
export const PROVIDER_TABS_MIN_ACCOUNTS = 7;

export const shouldShowProviderTabs = (
  providerCount: number,
  accountCount: number,
  activeFilter: string
): boolean =>
  activeFilter !== 'all' || (providerCount > 1 && accountCount >= PROVIDER_TABS_MIN_ACCOUNTS);

const providerRank = (provider: string) => {
  const index = PROVIDER_ORDER.indexOf(provider);
  return index < 0 ? PROVIDER_ORDER.length : index;
};

const priorityOf = (file: AuthFileItem) =>
  typeof file.priority === 'number' && Number.isSafeInteger(file.priority) ? file.priority : 0;
const routingIdOf = (file: AuthFileItem) =>
  typeof file.id === 'string' && file.id ? file.id : file.name;

/**
 * The list's default order, matching Overview and Routing: Claude first, its enabled accounts in
 * routing order (higher priority first, ties by routing ID as the backend breaks them) and turned
 * off ones after; then Codex and other providers, each by file name.
 */
export const defaultAccountOrder = (files: readonly AuthFileItem[]): AuthFileItem[] =>
  [...files].sort((a, b) => {
    const pa = accountProviderKey(a);
    const pb = accountProviderKey(b);
    const byProvider = providerRank(pa) - providerRank(pb) || pa.localeCompare(pb);
    if (byProvider !== 0) return byProvider;
    if (pa === 'claude') {
      const offA = a.disabled === true ? 1 : 0;
      const offB = b.disabled === true ? 1 : 0;
      if (offA !== offB) return offA - offB;
      if (!offA) {
        const byPriority = priorityOf(b) - priorityOf(a);
        if (byPriority !== 0) return byPriority;
        const ia = routingIdOf(a);
        const ib = routingIdOf(b);
        return ia < ib ? -1 : ia > ib ? 1 : 0;
      }
    }
    return a.name.localeCompare(b.name);
  });
