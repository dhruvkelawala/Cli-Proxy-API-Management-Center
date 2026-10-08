/**
 * PROTOTYPE (throwaway, never merges to main). Synthetic in-memory model for the CPA-005 client
 * routes + CPA-008 shared load-balancing UX variants. Strings are hard-coded English on purpose.
 *
 * Nothing here talks to the Management API. The preview math is an illustration of the backend
 * contract in plans/008-shared-load-balancing.md, not a scheduler.
 */

export type ProviderId = 'claude' | 'codex';
export type Availability = 'available' | 'unavailable' | 'unknown';
export type Strategy = 'round-robin' | 'weighted-round-robin' | 'fill-first';
export type Machine = 'mini' | 'macbook';

export interface ProtoAccount {
  /** Stable internal ID. Fill-first uses this order, not display order. */
  id: string;
  provider: ProviderId;
  label: string;
  plan: string;
  enabled: boolean;
  availability: Availability;
  priority: number;
  weight: number;
}

export type ProtoPolicy = { mode: 'automatic' } | { mode: 'only'; accountId: string };

export interface ProtoProfile {
  id: string;
  label: string;
  machine: Machine;
  app: string;
  policies: Record<ProviderId, ProtoPolicy>;
}

export interface ProtoRouting {
  strategy: Strategy;
  affinity: boolean;
  affinityTtl: string;
}

export interface Snapshot {
  accounts: ProtoAccount[];
  profiles: ProtoProfile[];
  routing: ProtoRouting;
}

export const PROVIDERS: { id: ProviderId; label: string }[] = [
  { id: 'claude', label: 'Claude' },
  { id: 'codex', label: 'Codex' },
];

export const providerLabel = (id: ProviderId) => (id === 'claude' ? 'Claude' : 'Codex');

export const MAX_WEIGHT = 1_000_000;

export const STRATEGIES: {
  id: Strategy;
  label: string;
  short: string;
  blurb: string;
}[] = [
  {
    id: 'round-robin',
    label: 'Rotate evenly',
    short: 'Even',
    blurb: 'New assignments take turns across the top-priority accounts.',
  },
  {
    id: 'weighted-round-robin',
    label: 'Weighted split',
    short: 'Weighted',
    blurb: 'New assignments follow each account’s weight within the top-priority tier.',
  },
  {
    id: 'fill-first',
    label: 'Concentrate on one',
    short: 'One',
    blurb:
      'Use the first eligible account in stable internal order until it is unavailable. ' +
      'To prefer a specific account, give it a higher priority.',
  },
];

export const strategyMeta = (id: Strategy) => STRATEGIES.find((s) => s.id === id) ?? STRATEGIES[0];

export const MACHINES: Record<Machine, { label: string; path: string[] }> = {
  mini: {
    label: 'Mac mini',
    path: ['T3 on Mac mini', 'localhost:8317', 'Mini gateway'],
  },
  macbook: {
    label: 'MacBook',
    path: ['T3 on MacBook', 'localhost:8317', 'SSH tunnel', 'Mini gateway'],
  },
};

export const initialSnapshot = (): Snapshot => ({
  accounts: [
    {
      id: 'claude-a',
      provider: 'claude',
      label: 'Claude A',
      plan: 'Claude Max',
      enabled: true,
      availability: 'unknown',
      priority: 10,
      weight: 3,
    },
    {
      id: 'claude-b',
      provider: 'claude',
      label: 'Claude B',
      plan: 'Claude Max',
      enabled: true,
      availability: 'available',
      priority: 10,
      weight: 1,
    },
    {
      id: 'codex-1',
      provider: 'codex',
      label: 'Codex',
      plan: 'ChatGPT Pro',
      enabled: true,
      availability: 'unknown',
      priority: 0,
      weight: 1,
    },
  ],
  profiles: [
    {
      id: 'mini-t3',
      label: 'Mini · T3 Claude',
      machine: 'mini',
      app: 'T3',
      policies: { claude: { mode: 'automatic' }, codex: { mode: 'automatic' } },
    },
    {
      id: 'mbp-t3',
      label: 'MacBook · T3 Claude',
      machine: 'macbook',
      app: 'T3',
      policies: { claude: { mode: 'only', accountId: 'claude-a' }, codex: { mode: 'automatic' } },
    },
    {
      id: 'mbp-t3-b',
      label: 'MacBook · T3 Claude B',
      machine: 'macbook',
      app: 'T3',
      policies: { claude: { mode: 'only', accountId: 'claude-b' }, codex: { mode: 'automatic' } },
    },
  ],
  // The current deployment uses fill-first; the new UI must not migrate it on load.
  routing: { strategy: 'fill-first', affinity: false, affinityTtl: '1h' },
});

/* ------------------------------------------------------------------ */
/* Derived presentation                                                */
/* ------------------------------------------------------------------ */

export type PoolRowStatus = 'share' | 'standby' | 'fallback' | 'excluded';

export interface PoolRow {
  account: ProtoAccount;
  status: PoolRowStatus;
  /** Illustrative share of new assignments, 0..1. Only for status 'share'. */
  share: number;
  reason: string;
}

export interface PoolPreview {
  provider: ProviderId;
  strategy: Strategy;
  rows: PoolRow[];
  topPriority: number | null;
  anyEligible: boolean;
  /** Some participating accounts have unknown availability. */
  hasUnknown: boolean;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;
export const formatShare = pct;

export function poolPreview(snapshot: Snapshot, provider: ProviderId): PoolPreview {
  const { strategy } = snapshot.routing;
  const accounts = snapshot.accounts.filter((a) => a.provider === provider);
  const excludedReason = (a: ProtoAccount): string | null => {
    if (!a.enabled) return 'Disabled · not in any pool';
    if (a.availability === 'unavailable') return 'Unavailable right now';
    if (strategy === 'weighted-round-robin' && a.weight <= 0)
      return 'Weight ≤ 0 · skipped by Weighted split only';
    return null;
  };
  const eligible = accounts.filter((a) => excludedReason(a) === null);
  const topPriority = eligible.length ? Math.max(...eligible.map((a) => a.priority)) : null;
  const top = eligible
    .filter((a) => a.priority === topPriority)
    .sort((x, y) => x.id.localeCompare(y.id));
  const weightSum = top.reduce((sum, a) => sum + Math.max(0, a.weight), 0);

  const rows: PoolRow[] = accounts.map((account) => {
    const reason = excludedReason(account);
    if (reason) return { account, status: 'excluded', share: 0, reason };
    if (account.priority !== topPriority) {
      return {
        account,
        status: 'fallback',
        share: 0,
        reason: `Fallback · priority ${account.priority} is below ${topPriority}`,
      };
    }
    if (strategy === 'fill-first') {
      const first = top[0]?.id === account.id;
      return first
        ? { account, status: 'share', share: 1, reason: 'First eligible by internal order' }
        : {
            account,
            status: 'standby',
            share: 0,
            reason: 'Standby · used when the first account is unavailable',
          };
    }
    const share =
      strategy === 'weighted-round-robin'
        ? weightSum > 0
          ? account.weight / weightSum
          : 0
        : 1 / top.length;
    return {
      account,
      status: 'share',
      share,
      reason:
        strategy === 'weighted-round-robin'
          ? `Weight ${account.weight} of ${weightSum}`
          : `Equal turn among ${top.length}`,
    };
  });

  return {
    provider,
    strategy,
    rows,
    topPriority,
    anyEligible: eligible.length > 0,
    hasUnknown: rows.some((r) => r.status === 'share' && r.account.availability === 'unknown'),
  };
}

export type TargetState = 'ok' | 'unknown' | 'disabled' | 'unavailable' | 'missing';

export type PolicyOutcome =
  | { kind: 'pool'; pool: PoolPreview; fails: boolean }
  | { kind: 'only'; account: ProtoAccount | null; state: TargetState; fails: boolean };

export function policyOutcome(
  snapshot: Snapshot,
  profile: ProtoProfile,
  provider: ProviderId
): PolicyOutcome {
  const policy = profile.policies[provider];
  if (policy.mode === 'automatic') {
    const pool = poolPreview(snapshot, provider);
    return { kind: 'pool', pool, fails: !pool.anyEligible };
  }
  const account = snapshot.accounts.find((a) => a.id === policy.accountId) ?? null;
  const state: TargetState = !account
    ? 'missing'
    : !account.enabled
      ? 'disabled'
      : account.availability === 'unavailable'
        ? 'unavailable'
        : account.availability === 'unknown'
          ? 'unknown'
          : 'ok';
  return {
    kind: 'only',
    account,
    state,
    fails: state === 'disabled' || state === 'unavailable' || state === 'missing',
  };
}

export const targetStateText: Record<TargetState, string> = {
  ok: 'Available',
  unknown: 'Availability unknown',
  disabled: 'Disabled · requests will fail',
  unavailable: 'Unavailable · requests will fail',
  missing: 'Account removed · requests will fail',
};

export const availabilityText: Record<Availability, string> = {
  available: 'Available',
  unavailable: 'Unavailable',
  unknown: 'Unknown',
};

export function policyLabel(snapshot: Snapshot, policy: ProtoPolicy): string {
  if (policy.mode === 'automatic') return 'Automatic';
  const account = snapshot.accounts.find((a) => a.id === policy.accountId);
  return `Only ${account?.label ?? 'removed account'}`;
}

export const accountsFor = (snapshot: Snapshot, provider: ProviderId) =>
  snapshot.accounts.filter((a) => a.provider === provider);

export function automaticClients(snapshot: Snapshot) {
  return snapshot.profiles.flatMap((profile) =>
    PROVIDERS.filter((p) => profile.policies[p.id].mode === 'automatic').map((p) => ({
      profile,
      provider: p.id,
    }))
  );
}

/** Profiles whose policy for the account's provider is Only <account>. */
export function pinnedProfiles(snapshot: Snapshot, accountId: string) {
  return snapshot.profiles.filter((profile) =>
    PROVIDERS.some((p) => {
      const policy = profile.policies[p.id];
      return policy.mode === 'only' && policy.accountId === accountId;
    })
  );
}

/** Automatic profiles that may receive this account from the shared pool. */
export function automaticProfilesFor(snapshot: Snapshot, provider: ProviderId) {
  return snapshot.profiles.filter((profile) => profile.policies[provider].mode === 'automatic');
}

export function routingScopeText(snapshot: Snapshot): string {
  const clients = automaticClients(snapshot);
  const names = new Set(clients.map((c) => c.profile.id));
  const machines = new Set(clients.map((c) => c.profile.machine));
  const where =
    machines.size === 2 ? 'Mini and MacBook' : machines.has('mini') ? 'the Mini' : 'the MacBook';
  return `Global · affects ${names.size} Automatic client${names.size === 1 ? '' : 's'} on ${where}`;
}

export function accountScopeText(snapshot: Snapshot, account: ProtoAccount): string {
  const n = automaticProfilesFor(snapshot, account.provider).length;
  return `Affects every Automatic ${providerLabel(account.provider)} client (${n}) that can use ${account.label}`;
}

export function profileScopeText(profile: ProtoProfile, provider?: ProviderId): string {
  const which = provider ? `${providerLabel(provider)} requests` : 'Claude and Codex requests';
  return `Applies to all ${which} using “${profile.label}” · new sessions`;
}

/* ------------------------------------------------------------------ */
/* Draft / saved state                                                 */
/* ------------------------------------------------------------------ */

export type SaveGroup = 'routing' | `profile:${string}` | `account:${string}`;

export interface ProtoState {
  saved: Snapshot;
  draft: Snapshot;
  saving: SaveGroup | null;
  failNextSave: boolean;
  log: string[];
  error: { group: SaveGroup; message: string } | null;
}

export const initialState = (): ProtoState => {
  const snap = initialSnapshot();
  return {
    saved: snap,
    draft: structuredClone(snap),
    saving: null,
    failNextSave: false,
    log: ['Loaded synthetic gateway state (strategy stays fill-first; nothing migrated).'],
    error: null,
  };
};

const groupSlice = (snap: Snapshot, group: SaveGroup): unknown => {
  if (group === 'routing') return snap.routing;
  if (group.startsWith('profile:')) return snap.profiles.find((p) => `profile:${p.id}` === group);
  const acct = snap.accounts.find((a) => `account:${a.id}` === group);
  return acct ? { priority: acct.priority, weight: acct.weight } : null;
};

export const isDirty = (state: ProtoState, group: SaveGroup) =>
  JSON.stringify(groupSlice(state.draft, group)) !== JSON.stringify(groupSlice(state.saved, group));

export function dirtyGroups(state: ProtoState): SaveGroup[] {
  const groups: SaveGroup[] = [
    'routing',
    ...state.draft.profiles.map((p) => `profile:${p.id}` as SaveGroup),
    ...state.draft.accounts.map((a) => `account:${a.id}` as SaveGroup),
  ];
  return groups.filter((g) => isDirty(state, g));
}

export function groupLabel(snap: Snapshot, group: SaveGroup): string {
  if (group === 'routing') return 'Shared routing';
  if (group.startsWith('profile:')) {
    const p = snap.profiles.find((x) => `profile:${x.id}` === group);
    return `Profile “${p?.label ?? '?'}”`;
  }
  const a = snap.accounts.find((x) => `account:${x.id}` === group);
  return `${a?.label ?? '?'} priority/weight`;
}

export function applyGroup(from: Snapshot, into: Snapshot, group: SaveGroup): Snapshot {
  const next = structuredClone(into);
  if (group === 'routing') next.routing = structuredClone(from.routing);
  else if (group.startsWith('profile:')) {
    const src = from.profiles.find((p) => `profile:${p.id}` === group);
    next.profiles = next.profiles.map((p) =>
      `profile:${p.id}` === group && src ? structuredClone(src) : p
    );
  } else {
    const src = from.accounts.find((a) => `account:${a.id}` === group);
    next.accounts = next.accounts.map((a) =>
      `account:${a.id}` === group && src ? { ...a, priority: src.priority, weight: src.weight } : a
    );
  }
  return next;
}

export const parseWeight = (raw: string): { value: number | null; error: string | null } => {
  if (raw.trim() === '') return { value: 1, error: null };
  if (!/^-?\d+$/.test(raw.trim())) return { value: null, error: 'Whole number' };
  const n = Number(raw);
  if (n > MAX_WEIGHT) return { value: null, error: `Max ${MAX_WEIGHT.toLocaleString()}` };
  return { value: n, error: null };
};
