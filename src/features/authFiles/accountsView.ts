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
