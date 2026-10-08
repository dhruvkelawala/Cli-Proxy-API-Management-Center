import type { RoutingStrategy } from '@/types/visualConfig';
import { DEFAULT_CREDENTIAL_WEIGHT, readCredentialWeight } from '@/utils/credentialWeight';

/**
 * Pure presentation model for the shared load-balancing strategies.
 *
 * It mirrors the documented selection semantics of the backend scheduler
 * (sdk/cliproxy/auth/selector.go) for explanation purposes only. It is not a scheduler:
 * live availability is taken as given, unknown availability stays unknown, and the shares it
 * reports are configured/illustrative, never served-by attribution.
 */

const I18N_ROOT = 'config_management.routing_presentation';

/** Backend default when an account has no (or an unparseable) priority. */
export const DEFAULT_ACCOUNT_PRIORITY = 0;

export type RoutingAvailability = 'available' | 'unavailable' | 'unknown';

export interface RoutingAccountInput {
  /** Stable internal ID. The backend orders candidates by it (fill-first picks the lowest). */
  id: string;
  label: string;
  provider: string;
  enabled: boolean;
  availability: RoutingAvailability;
  /** Arbitrary integer; larger wins. Missing resolves to the backend default (0). */
  priority?: number | null;
  /** Missing resolves to the default weight (1). */
  weight?: number | null;
}

export interface RoutingPresentationInput {
  strategy: RoutingStrategy;
  sessionAffinity: { enabled: boolean; ttl?: string };
  accounts: RoutingAccountInput[];
}

export type RoutingParticipationStatus = 'participating' | 'unknown' | 'excluded';

export type RoutingParticipationReason =
  | 'participating'
  | 'standby'
  | 'unknown-availability'
  | 'disabled'
  | 'unavailable'
  | 'lower-priority'
  | 'non-positive-weight';

export interface RoutingAccountPresentation {
  id: string;
  label: string;
  provider: string;
  enabled: boolean;
  availability: RoutingAvailability;
  /** Effective priority as the backend reads it (missing -> 0), otherwise preserved. */
  priority: number;
  /** Effective weight as the backend reads it (missing -> 1, invalid -> 0). */
  weight: number;
  status: RoutingParticipationStatus;
  reason: RoutingParticipationReason;
  reasonKey: string;
  /**
   * Configured share of cold assignments, 0-100, assuming every candidate in the active tier
   * is available. Null when the account is not a candidate.
   */
  sharePercent: number | null;
}

export interface RoutingPoolPresentation {
  provider: string;
  /** Highest priority among candidates; null when nothing in the pool can participate. */
  activePriority: number | null;
  hasParticipants: boolean;
}

export interface RoutingAffinityPresentation {
  enabled: boolean;
  ttl: string | undefined;
  explanationKey: string;
  /**
   * A healthy established binding persists across priority tiers and priority edits. Under
   * weighted-round-robin it does not survive its account's weight dropping to 0 or below:
   * that removes the account from the candidates, so the binding moves. Saving the strategy,
   * affinity or TTL settings rebuilds the selector and resets all current bindings.
   */
  retainsExistingBindings: boolean;
}

export interface RoutingPresentation {
  strategy: RoutingStrategy;
  strategyExplanationKey: string;
  /** Weights only matter for weighted-round-robin. */
  weightControlsRelevant: boolean;
  sharesAssumptionKey: string;
  affinity: RoutingAffinityPresentation;
  /** Same order as the input accounts. */
  accounts: RoutingAccountPresentation[];
  pools: RoutingPoolPresentation[];
}

const STRATEGY_KEYS: Record<RoutingStrategy, string> = {
  'round-robin': `${I18N_ROOT}.strategy.round_robin`,
  'weighted-round-robin': `${I18N_ROOT}.strategy.weighted_round_robin`,
  'fill-first': `${I18N_ROOT}.strategy.fill_first`,
};

const REASON_KEYS: Record<RoutingParticipationReason, string> = {
  participating: `${I18N_ROOT}.reason.participating`,
  standby: `${I18N_ROOT}.reason.standby`,
  'unknown-availability': `${I18N_ROOT}.reason.unknown_availability`,
  disabled: `${I18N_ROOT}.reason.disabled`,
  unavailable: `${I18N_ROOT}.reason.unavailable`,
  'lower-priority': `${I18N_ROOT}.reason.lower_priority`,
  'non-positive-weight': `${I18N_ROOT}.reason.non_positive_weight`,
};

/** Backend: missing or unparseable priority is 0; any other integer is preserved. */
export const resolveEffectivePriority = (priority: number | null | undefined): number =>
  typeof priority === 'number' && Number.isSafeInteger(priority)
    ? priority
    : DEFAULT_ACCOUNT_PRIORITY;

/** Backend: missing weight is 1; an unparseable or oversized weight is 0 (excluded). */
export const resolveEffectiveWeight = (weight: number | null | undefined): number =>
  weight === undefined || weight === null
    ? DEFAULT_CREDENTIAL_WEIGHT
    : (readCredentialWeight(weight) ?? 0);

const compareInternalId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

interface ResolvedAccount {
  input: RoutingAccountInput;
  priority: number;
  weight: number;
}

const buildPool = (
  provider: string,
  members: ResolvedAccount[],
  strategy: RoutingStrategy,
  results: Map<RoutingAccountInput, RoutingAccountPresentation>
): RoutingPoolPresentation => {
  const weighted = strategy === 'weighted-round-robin';

  // Backend order: non-positive weights are dropped first (weighted only), then availability,
  // then the highest remaining priority tier is chosen.
  const candidates = members.filter(
    ({ input, weight }) =>
      input.enabled && input.availability !== 'unavailable' && (!weighted || weight > 0)
  );
  const activePriority = candidates.length
    ? Math.max(...candidates.map(({ priority }) => priority))
    : null;
  const activeTier = candidates
    .filter(({ priority }) => priority === activePriority)
    .sort((a, b) => compareInternalId(a.input.id, b.input.id));

  const totalWeight = activeTier.reduce((sum, { weight }) => sum + weight, 0);
  const shareOf = (member: ResolvedAccount, index: number): number => {
    if (strategy === 'fill-first') return index === 0 ? 100 : 0;
    if (weighted) return (member.weight / totalWeight) * 100;
    return 100 / activeTier.length;
  };

  members.forEach((member) => {
    const { input, priority, weight } = member;
    const tierIndex = activeTier.indexOf(member);

    let reason: RoutingParticipationReason;
    let status: RoutingParticipationStatus;
    if (!input.enabled) {
      reason = 'disabled';
      status = 'excluded';
    } else if (weighted && weight <= 0) {
      reason = 'non-positive-weight';
      status = 'excluded';
    } else if (input.availability === 'unavailable') {
      reason = 'unavailable';
      status = 'excluded';
    } else if (tierIndex < 0) {
      reason = 'lower-priority';
      status = 'excluded';
    } else if (input.availability === 'unknown') {
      reason = 'unknown-availability';
      status = 'unknown';
    } else if (strategy === 'fill-first' && tierIndex > 0) {
      reason = 'standby';
      status = 'participating';
    } else {
      reason = 'participating';
      status = 'participating';
    }

    results.set(input, {
      id: input.id,
      label: input.label,
      provider: input.provider,
      enabled: input.enabled,
      availability: input.availability,
      priority,
      weight,
      status,
      reason,
      reasonKey: REASON_KEYS[reason],
      sharePercent: tierIndex < 0 ? null : shareOf(member, tierIndex),
    });
  });

  return { provider, activePriority, hasParticipants: activeTier.length > 0 };
};

/**
 * Builds the per-account participation and illustrative shares. Priority tiers are evaluated
 * per provider pool, because a request is only scheduled among credentials for its provider.
 */
export const buildRoutingPresentation = (input: RoutingPresentationInput): RoutingPresentation => {
  const { strategy, sessionAffinity, accounts } = input;

  const pools = new Map<string, ResolvedAccount[]>();
  accounts.forEach((account) => {
    const member: ResolvedAccount = {
      input: account,
      priority: resolveEffectivePriority(account.priority),
      weight: resolveEffectiveWeight(account.weight),
    };
    const members = pools.get(account.provider);
    if (members) members.push(member);
    else pools.set(account.provider, [member]);
  });

  const results = new Map<RoutingAccountInput, RoutingAccountPresentation>();
  const poolPresentations = Array.from(pools, ([provider, members]) =>
    buildPool(provider, members, strategy, results)
  );

  return {
    strategy,
    strategyExplanationKey: STRATEGY_KEYS[strategy],
    weightControlsRelevant: strategy === 'weighted-round-robin',
    sharesAssumptionKey: `${I18N_ROOT}.shares_assumption`,
    affinity: {
      enabled: sessionAffinity.enabled,
      ttl: sessionAffinity.ttl,
      explanationKey: `${I18N_ROOT}.affinity.${sessionAffinity.enabled ? 'enabled' : 'disabled'}`,
      retainsExistingBindings: sessionAffinity.enabled,
    },
    accounts: accounts.map((account) => results.get(account) as RoutingAccountPresentation),
    pools: poolPresentations,
  };
};

export type StrictPolicyTargetStatus = 'ready' | 'unknown' | 'disabled' | 'unavailable' | 'missing';

export interface StrictPolicyPresentation {
  targetStatus: StrictPolicyTargetStatus;
  /** Pool strategy, priority tiers and weights do not apply to an Only-<account> policy. */
  balanceControlsRelevant: false;
  weightControlsRelevant: false;
  /** An Only-<account> policy never substitutes another account. */
  fallsBackToPool: false;
  /** When true, a disabled/unavailable/missing target surfaces an error instead of fallback. */
  failsWhenTargetUnusable: true;
  explanationKey: string;
}

/** Presentation of an Only-<account> policy: strict target status, never pool fallback. */
export const describeStrictPolicy = (input: {
  target: RoutingAccountInput | undefined;
}): StrictPolicyPresentation => {
  const { target } = input;
  let targetStatus: StrictPolicyTargetStatus;
  if (!target) targetStatus = 'missing';
  else if (!target.enabled) targetStatus = 'disabled';
  else if (target.availability === 'unavailable') targetStatus = 'unavailable';
  else if (target.availability === 'unknown') targetStatus = 'unknown';
  else targetStatus = 'ready';

  return {
    targetStatus,
    balanceControlsRelevant: false,
    weightControlsRelevant: false,
    fallsBackToPool: false,
    failsWhenTargetUnusable: true,
    explanationKey: `${I18N_ROOT}.strict.${targetStatus}`,
  };
};
