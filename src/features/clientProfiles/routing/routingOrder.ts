/**
 * The Routing page's read model: one provider's accounts in the order Automatic clients use
 * them, who goes first, who is the backup, which clients follow the order and which are locked.
 * React-free; copy is returned as i18n key descriptors so it can be tested without rendering.
 *
 * Order is account priority (higher first). Equal priorities form one level, where the shared
 * strategy decides; the backend breaks fill-first ties by the lowest ID, so ties sort by ID.
 */

import { buildRoutingPresentation } from '@/features/config/routing/routingPresentation';
import {
  accountProviderKey,
  isAccountDisabled,
  resolveAccountAvailability,
} from '@/features/authFiles/accountPresentation';
import { deriveAccountTitle } from '@/features/authFiles/identity';
import type { AuthFileItem, ClaudeQuotaState } from '@/types';
import { NO_QUOTA, summarizeQuota, type QuotaSummary } from '@/features/quota/quotaSummary';
import type { RoutingStrategy } from '@/types/visualConfig';
import {
  CLIENT_PROFILE_PROVIDERS,
  type ClientProfile,
  type ClientProfileAccount,
  type ClientProfileProvider,
  type ClientProfilesSnapshot,
} from '@/types/clientProfiles';
import { credentialRefForAuthFile, isFailingTargetState, resolveTargetState } from '../model';

export type Copy = { key: string; values?: Record<string, string | number> };
/** Formats an instant for sentences ("Tue 9:06 PM", "tomorrow at 9:00 AM"). */
export type FormatWhen = (ms: number) => string;

const R = 'routing';

/* ------------------------------------------------------------------ */
/* Accounts                                                            */
/* ------------------------------------------------------------------ */

export type AccountHealth =
  'available' | 'attention' | 'cooling' | 'limit' | 'disabled' | 'unknown';

/**
 * active: receives new conversations now. next: same level, waits its turn.
 * backup: lower level, steps in when everything above is out. resting: can't serve now.
 * off: turned off.
 */
export type AccountRole = 'active' | 'next' | 'backup' | 'resting' | 'off';

export { NO_QUOTA, type QuotaSummary } from '@/features/quota/quotaSummary';

export interface OrderAccount {
  /** Routing ID (auth ID, else file name); the backend breaks ties by it. */
  id: string;
  /** Auth file name: the key for field patches. */
  name: string;
  label: string;
  file: AuthFileItem;
  /** Client-profile inventory entry, when the identity join succeeds. */
  inventory: ClientProfileAccount | null;
  health: AccountHealth;
  retryAt: number | null;
  /** Previewed as out of room; nothing was changed. */
  simulatedOut: boolean;
  /** Weighted round robin with weight <= 0: the backend never picks it. */
  weightExcluded: boolean;
  priority: number;
  role: AccountRole;
  /** 0 = top level. Accounts on one level share a rank. */
  rank: number;
  quota: QuotaSummary;
}

/** Weekly and five-hour room left from the Quota page's cached Claude state. */
export const summarizeClaudeQuota = (
  state: ClaudeQuotaState | undefined,
  now: number = Date.now()
): QuotaSummary => summarizeQuota(state, now);

const readRetryAt = (file: AuthFileItem): number | null => {
  const raw = file['next_retry_after'];
  const parsed = typeof raw === 'string' ? Date.parse(raw) : NaN;
  if (Number.isFinite(parsed)) return parsed;
  const records = file.cooldownSnapshot?.records ?? [];
  const remaining = Math.max(0, ...records.map((record) => record.remainingSeconds));
  return remaining > 0
    ? (file.cooldownSnapshot?.receivedAtMs ?? Date.now()) + remaining * 1000
    : null;
};

const healthOf = (file: AuthFileItem): AccountHealth => {
  const availability = resolveAccountAvailability(file);
  if (availability === null) return 'disabled';
  if (file.unavailable === true || availability === 'coolingDown') return 'cooling';
  if (availability === 'attention') return 'attention';
  return availability === 'available' ? 'available' : 'unknown';
};

const isUsable = (health: AccountHealth) =>
  health === 'available' || health === 'attention' || health === 'unknown';

export const routingIdOf = (file: AuthFileItem): string =>
  typeof file.id === 'string' && file.id ? file.id : file.name;

export const savedPriorityOf = (file: AuthFileItem): number =>
  typeof file.priority === 'number' && Number.isSafeInteger(file.priority) ? file.priority : 0;

export interface BuildOrderInput {
  files: AuthFileItem[];
  provider: string;
  strategy: RoutingStrategy;
  sessionAffinity: boolean;
  inventory?: ClientProfileAccount[];
  quotaFor?: (file: AuthFileItem) => QuotaSummary;
  /** Optimistic priorities by routing ID (a reorder being saved). */
  priorityOverrides?: Record<string, number>;
  /** Routing ID previewed as out of room. */
  simulateOut?: string | null;
}

export interface OrderModel {
  /** Enabled accounts, first → last. Only these can be reordered or written. */
  order: OrderAccount[];
  /** Turned-off accounts: shown below the order, never moved or written. */
  off: OrderAccount[];
  /** Accounts receiving new conversations now. */
  serving: OrderAccount[];
  /** Every enabled account shares one priority: the strategy decides, not the order. */
  sameLevel: boolean;
  /** Same level and the strategy spreads new conversations over several accounts. */
  shared: boolean;
  /**
   * Same level, but only one account gets new conversations (fill-first breaks the tie by
   * ID): the order shown is the tie-break, not a choice.
   */
  tie: boolean;
}

const byOrder = (a: OrderAccount, b: OrderAccount) =>
  b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export const buildOrder = ({
  files,
  provider,
  strategy,
  sessionAffinity,
  inventory = [],
  quotaFor = () => NO_QUOTA,
  priorityOverrides = {},
  simulateOut = null,
}: BuildOrderInput): OrderModel => {
  const base = files
    .filter((file) => accountProviderKey(file) === provider)
    .map((file) => {
      const id = routingIdOf(file);
      const ref = credentialRefForAuthFile(file);
      let health = healthOf(file);
      let retryAt = readRetryAt(file);
      const quota = quotaFor(file);
      // Quota says "at its limit" even when the account itself looks healthy.
      if (isUsable(health) && quota.status === 'ready') {
        const weekOut = quota.weekLeft === 0;
        if (weekOut || quota.sessionLeft === 0) {
          health = 'limit';
          retryAt = weekOut ? quota.weekResetAt : quota.sessionResetAt;
        }
      }
      return {
        id,
        name: file.name,
        label: deriveAccountTitle(file).title || file.name,
        file,
        inventory: ref ? (inventory.find((item) => item.credentialRef === ref) ?? null) : null,
        health,
        retryAt,
        simulatedOut: simulateOut === id && health !== 'disabled',
        priority: priorityOverrides[id] ?? savedPriorityOf(file),
        quota,
      };
    });

  const presentation = buildRoutingPresentation({
    strategy,
    sessionAffinity: { enabled: sessionAffinity },
    accounts: base.map((account) => ({
      id: account.id,
      label: account.label,
      provider,
      enabled: account.health !== 'disabled',
      availability:
        account.simulatedOut || account.health === 'cooling' || account.health === 'limit'
          ? 'unavailable'
          : 'available',
      priority: account.priority,
      // Weighted round robin drops weight <= 0 accounts entirely, like the backend.
      weight: typeof account.file.weight === 'number' ? account.file.weight : null,
    })),
  });
  const levels = Array.from(
    new Set(base.filter((a) => a.health !== 'disabled').map((a) => a.priority))
  ).sort((a, b) => b - a);

  const all = base
    .map((account, index): OrderAccount => {
      const item = presentation.accounts[index];
      const share = item?.sharePercent ?? null;
      let role: AccountRole;
      if (account.health === 'disabled') role = 'off';
      else if (account.simulatedOut || !isUsable(account.health)) role = 'resting';
      else if (item?.reason === 'non-positive-weight') role = 'resting';
      else if (share !== null && share > 0) role = 'active';
      else if (item?.reason === 'standby') role = 'next';
      else role = 'backup';
      return {
        ...account,
        role,
        weightExcluded: role === 'resting' && item?.reason === 'non-positive-weight',
        rank: Math.max(0, levels.indexOf(account.priority)),
      };
    })
    .sort(byOrder);
  const order = all.filter((account) => account.role !== 'off');
  const off = all
    .filter((account) => account.role === 'off')
    .sort((a, b) => a.label.localeCompare(b.label));
  const serving = order.filter((account) => account.role === 'active');
  const sameLevel = levels.length <= 1;
  const usable = order.filter((account) => isUsable(account.health) && !account.simulatedOut);
  return {
    order,
    off,
    serving,
    sameLevel,
    shared: sameLevel && serving.length > 1,
    tie: sameLevel && serving.length === 1 && usable.length > 1,
  };
};

/* ------------------------------------------------------------------ */
/* Reordering → priorities                                             */
/* ------------------------------------------------------------------ */

export const FIRST_PRIORITY_STEP = 10;
/** A demotion never goes below this; below it the mover is raised instead. */
export const PRIORITY_FLOOR = 0;

export interface PriorityChange {
  id: string;
  name: string;
  from: number;
  to: number;
}

type Ranked = Pick<OrderAccount, 'id' | 'name' | 'priority'>;

/** True when `nextIds` only moves one account to the front and keeps the rest in order. */
export const movedToFirst = (currentIds: readonly string[], nextIds: readonly string[]) => {
  const [first] = nextIds;
  if (!first || nextIds.length !== currentIds.length || currentIds[0] === first) return null;
  const rest = currentIds.filter((id) => id !== first);
  return rest.length === nextIds.length - 1 && rest.every((id, i) => nextIds[i + 1] === id)
    ? first
    : null;
};

/**
 * "Make X first" as ONE write, so a failure can never leave a half-applied order:
 * - X is already strictly highest: nothing to write.
 * - Exactly one account Y is at or above X, and Y can drop to X − 10 while staying above the
 *   rest and not below PRIORITY_FLOOR (0): write Y := X − 10.
 * - Otherwise: write X := (highest other priority) + 10.
 * With two accounts at 10/0 this cycles 10/0 → 10/20 → 10/0 …: one write per flip and values
 * that stay within [lowest, highest + 20]. With three or more, values only grow by 10 when a
 * demotion is impossible.
 */
export const planMoveToFirst = (order: readonly Ranked[], id: string): PriorityChange[] => {
  const mover = order.find((account) => account.id === id);
  if (!mover) return [];
  const others = order.filter((account) => account.id !== id);
  const blockers = others.filter((account) => account.priority >= mover.priority);
  if (blockers.length === 0) return [];
  if (blockers.length === 1) {
    const [blocker] = blockers;
    const below = mover.priority - FIRST_PRIORITY_STEP;
    const rest = others.filter((account) => account !== blocker);
    const restTop = rest.length ? Math.max(...rest.map((account) => account.priority)) : -Infinity;
    if (below >= PRIORITY_FLOOR && below > restTop) {
      return [{ id: blocker.id, name: blocker.name, from: blocker.priority, to: below }];
    }
  }
  const top = Math.max(...others.map((account) => account.priority));
  return [{ id: mover.id, name: mover.name, from: mover.priority, to: top + FIRST_PRIORITY_STEP }];
};

/**
 * Priorities for an arbitrary new order (first → last), used when a reorder is more than
 * "move one to the front" (three or more accounts). Existing distinct priorities are reused in
 * the new order; with ties the last gets 0 and each earlier one 10 more.
 */
export const planOrderPriorities = (
  current: ReadonlyArray<Pick<OrderAccount, 'id' | 'priority'>>,
  nextIds: readonly string[]
): Record<string, number> => {
  const values = current.map((account) => account.priority).sort((a, b) => b - a);
  const distinct = new Set(values).size === values.length;
  const plan: Record<string, number> = {};
  nextIds.forEach((id, index) => {
    plan[id] = distinct ? values[index] : (nextIds.length - 1 - index) * FIRST_PRIORITY_STEP;
  });
  return plan;
};

/**
 * The accounts whose priority changes under `plan`, in write order: true demotions (value goes
 * down) first, then promotions. Each group runs from the lowest target up.
 */
export const priorityChanges = (
  current: readonly Ranked[],
  plan: Record<string, number>
): PriorityChange[] => {
  const changes = current
    .filter((account) => plan[account.id] !== undefined && plan[account.id] !== account.priority)
    .map((account) => ({
      id: account.id,
      name: account.name,
      from: account.priority,
      to: plan[account.id],
    }));
  const byTarget = (a: PriorityChange, b: PriorityChange) => a.to - b.to;
  return [
    ...changes.filter((change) => change.to < change.from).sort(byTarget),
    ...changes.filter((change) => change.to > change.from).sort(byTarget),
  ];
};

/**
 * The writes for a new order of the enabled accounts. Moving one account to the front is a
 * single write (planMoveToFirst); any other reorder rewrites what changed, demotions first.
 */
export const planReorder = (order: readonly Ranked[], nextIds: readonly string[]) => {
  const currentIds = order.map((account) => account.id);
  if (currentIds.join('\n') === nextIds.join('\n')) return [];
  const first = movedToFirst(currentIds, nextIds);
  if (first) return planMoveToFirst(order, first);
  return priorityChanges(order, planOrderPriorities(order, nextIds));
};

/** Move one account to the front, keeping the rest in order. */
export const orderWithFirst = (order: ReadonlyArray<Pick<OrderAccount, 'id'>>, id: string) => [
  id,
  ...order.map((account) => account.id).filter((other) => other !== id),
];

/* ------------------------------------------------------------------ */
/* Sentences                                                           */
/* ------------------------------------------------------------------ */

export type JoinNames = (names: string[]) => string;

/** Who goes first: the account(s) receiving new conversations, or null when none can. */
export const whoIsFirst = (model: OrderModel): OrderAccount[] | null =>
  model.serving.length ? model.serving : null;

/** The next account that would take over from the serving one. */
export const backupFor = (model: OrderModel, current: OrderAccount): OrderAccount | null =>
  model.order.find(
    (account) => account.id !== current.id && (account.role === 'next' || account.role === 'backup')
  ) ?? null;

/** Headline and follow-up line: where new conversations go, and what happens if it runs out. */
export const describeServing = (
  model: OrderModel,
  join: JoinNames,
  formatWhen: FormatWhen
): { title: Copy; follow: Copy } => {
  const { order, serving } = model;
  if (order.length === 0) {
    return model.off.length > 0
      ? { title: { key: `${R}.title_all_off` }, follow: { key: `${R}.follow_all_off` } }
      : { title: { key: `${R}.title_empty` }, follow: { key: `${R}.follow_empty` } };
  }
  if (serving.length === 0) {
    return { title: { key: `${R}.title_none` }, follow: { key: `${R}.follow_none` } };
  }
  if (model.shared) {
    return {
      title: { key: `${R}.title_shared`, values: { accounts: join(serving.map((a) => a.label)) } },
      follow: { key: `${R}.follow_shared` },
    };
  }
  const [now] = serving;
  if (model.tie) {
    return {
      title: { key: `${R}.title_first`, values: { account: now.label } },
      follow: {
        key: `${R}.follow_tie`,
        values: { accounts: join(order.map((a) => a.label)), account: now.label },
      },
    };
  }
  const out = order.find(
    (account) => account.rank < now.rank && account.role === 'resting' && !account.weightExcluded
  );
  if (out) {
    const previewing = out.simulatedOut;
    return {
      title: { key: `${R}.title_fallback`, values: { out: out.label, account: now.label } },
      follow: previewing
        ? { key: `${R}.follow_preview` }
        : out.retryAt
          ? {
              key: `${R}.follow_back_at`,
              values: { out: out.label, when: formatWhen(out.retryAt) },
            }
          : { key: `${R}.follow_back_later`, values: { out: out.label } },
    };
  }
  const backup = backupFor(model, now);
  return {
    title: { key: `${R}.title_first`, values: { account: now.label } },
    follow: backup
      ? { key: `${R}.follow_backup`, values: { account: now.label, backup: backup.label } }
      : { key: `${R}.follow_no_backup` },
  };
};

/**
 * Short label of a card's position: First or Backup; Shared only when the strategy really
 * spreads new conversations over several accounts; Off for turned-off accounts.
 */
export const rankKey = (account: OrderAccount, place: number, shared: boolean): string => {
  if (account.role === 'off') return `${R}.rank.off`;
  if (shared) return `${R}.rank.shared`;
  return place === 0 ? `${R}.rank.first` : `${R}.rank.backup`;
};

/** Health in plain words. */
export const healthCopy = (account: OrderAccount, formatWhen: FormatWhen): Copy => {
  if (account.simulatedOut) return { key: `${R}.health.preview_out` };
  if (account.weightExcluded) return { key: `${R}.health.weight_excluded` };
  switch (account.health) {
    case 'available':
      return { key: `${R}.health.available` };
    case 'attention':
      return { key: `${R}.health.attention` };
    case 'cooling':
      return account.retryAt
        ? { key: `${R}.health.cooling_until`, values: { when: formatWhen(account.retryAt) } }
        : { key: `${R}.health.cooling` };
    case 'limit':
      return account.retryAt
        ? { key: `${R}.health.limit_until`, values: { when: formatWhen(account.retryAt) } }
        : { key: `${R}.health.limit` };
    case 'disabled':
      return { key: `${R}.health.disabled` };
    default:
      return { key: `${R}.health.unknown` };
  }
};

export const healthTone = (account: OrderAccount): 'ok' | 'warn' | 'bad' | 'off' | 'unknown' => {
  if (account.simulatedOut) return 'warn';
  if (account.weightExcluded) return 'off';
  switch (account.health) {
    case 'available':
    case 'attention':
      return 'ok';
    case 'cooling':
      return 'warn';
    case 'limit':
      return 'bad';
    case 'disabled':
      return 'off';
    default:
      return 'unknown';
  }
};

/** "54% left this week · resets Tue 9:06 PM"; null when nothing is known. */
export const quotaCopy = (account: OrderAccount, formatWhen: FormatWhen): Copy | null => {
  const { quota } = account;
  if (account.health === 'disabled') return null;
  if (quota.status === 'loading') return { key: `${R}.quota.checking` };
  if (quota.status !== 'ready' || quota.weekLeft === null) return null;
  return quota.weekResetAt
    ? {
        key: `${R}.quota.week_left_reset`,
        values: { percent: quota.weekLeft, when: formatWhen(quota.weekResetAt) },
      }
    : { key: `${R}.quota.week_left`, values: { percent: quota.weekLeft } };
};

/** Half an hour of slack so two resets at "the same time" never flip-flop the advice. */
const RESET_SLACK_MS = 30 * 60_000;

/**
 * "Use the one that resets sooner first": weekly room left is lost at the reset, so the
 * account resetting soonest should go first. Only enabled accounts that can serve right now and
 * have room left are compared, across all of them. `account` is set when acting on the hint
 * (making it first) helps.
 */
export const resetHint = (
  model: OrderModel,
  formatWhen: FormatWhen
): { copy: Copy; account: OrderAccount | null } | null => {
  if (model.shared) return null;
  const [current] = model.serving;
  if (!current) return null;
  const candidates = model.order.filter(
    (account) =>
      isUsable(account.health) &&
      !account.simulatedOut &&
      account.quota.status === 'ready' &&
      account.quota.weekResetAt !== null &&
      (account.quota.weekLeft ?? 0) > 0
  );
  if (candidates.length < 2 || !candidates.includes(current)) return null;
  const resetOf = (account: OrderAccount) => account.quota.weekResetAt as number;
  const soonest = candidates.reduce((best, account) =>
    resetOf(account) < resetOf(best) ? account : best
  );
  if (soonest !== current && resetOf(soonest) < resetOf(current) - RESET_SLACK_MS) {
    return {
      account: soonest,
      copy: {
        key: `${R}.hint.sooner_bad`,
        values: {
          account: soonest.label,
          when: formatWhen(resetOf(soonest)),
          percent: soonest.quota.weekLeft ?? 0,
        },
      },
    };
  }
  const later = candidates.filter((account) => account !== current);
  if (
    soonest === current &&
    later.every((account) => resetOf(account) > resetOf(current) + RESET_SLACK_MS)
  ) {
    return {
      account: null,
      copy: {
        key: `${R}.hint.sooner_good`,
        values: { account: current.label, when: formatWhen(resetOf(current)) },
      },
    };
  }
  return null;
};

/* ------------------------------------------------------------------ */
/* Clients                                                             */
/* ------------------------------------------------------------------ */

/** "Mini · Claude" → "Mini". */
export const shortClientName = (label: string): string => label.split('·')[0].trim() || label;

export interface ClientRoute {
  profile: ClientProfile;
  shortName: string;
  /** Locked to one account (Only), or an unreadable rule. */
  locked: boolean;
  /** The Only target among the provider's accounts (in order or off), when it can be matched. */
  target: OrderAccount | null;
  /** Requests with this rule fail (target unavailable, removed, unknown mode, …). */
  broken: boolean;
  /**
   * The gateway does not enforce Only rules yet and this profile has one (for any provider):
   * every request made with its keys is refused (HTTP 503), so it does not use the order.
   */
  refused: boolean;
}

/**
 * Each profile's rule for one provider, resolved against that provider's accounts.
 * `enforced` is the gateway's enforcement capability (null when unknown).
 */
export const describeClientRoutes = (
  snapshot: Pick<ClientProfilesSnapshot, 'profiles' | 'accounts' | 'targetStates'>,
  provider: ClientProfileProvider,
  accounts: readonly OrderAccount[],
  enforced: boolean | null = true
): ClientRoute[] =>
  snapshot.profiles.map((profile) => {
    const policy = profile.policies[provider];
    const shortName = shortClientName(profile.label);
    const refused =
      enforced === false &&
      CLIENT_PROFILE_PROVIDERS.some((item) => profile.policies[item].mode !== 'automatic');
    if (policy.mode === 'automatic') {
      return { profile, shortName, locked: false, target: null, broken: false, refused };
    }
    if (policy.mode !== 'only') {
      return { profile, shortName, locked: true, target: null, broken: true, refused };
    }
    const target = accounts.find((account) => account.inventory?.accountRef === policy.accountRef);
    const reported = snapshot.targetStates[profile.profileRef]?.[provider];
    const state =
      reported && reported !== 'unknown'
        ? reported
        : resolveTargetState(provider, policy, snapshot.accounts);
    const previewOut = target?.simulatedOut === true;
    return {
      profile,
      shortName,
      locked: true,
      target: target ?? null,
      broken: isFailingTargetState(state) || previewOut,
      refused,
    };
  });

/**
 * The quiet line under the diagram: who follows the order, who is locked (and whether that
 * works or fails), and who is refused because locks are not enforced yet.
 */
export const describeClientsLine = (
  routes: ClientRoute[],
  join: JoinNames
): { copies: Copy[]; problem: boolean } => {
  if (routes.length === 0) return { copies: [{ key: `${R}.clients.none` }], problem: false };
  const following = routes.filter((route) => !route.locked && !route.refused);
  const copies: Copy[] = [];
  if (following.length > 0) {
    const names = join(following.map((route) => route.shortName));
    const key = following.length === 1 ? 'one' : following.length === 2 ? 'two' : 'many';
    copies.push({ key: `${R}.clients.${key}`, values: { names } });
  }
  routes
    .filter((route) => route.locked || route.refused)
    .forEach((route) => {
      const client = route.shortName;
      if (route.refused) {
        copies.push({ key: `${R}.clients.refused`, values: { client } });
      } else if (!route.target) {
        copies.push({
          key: route.broken ? `${R}.clients.locked_missing` : `${R}.clients.locked_other`,
          values: { client },
        });
      } else {
        copies.push({
          key: route.broken ? `${R}.clients.locked_broken` : `${R}.clients.locked`,
          values: { client, account: route.target.label },
        });
      }
    });
  return {
    copies,
    problem: routes.some((route) => route.refused || (route.locked && route.broken)),
  };
};

/** Main-view notice when the gateway cannot do client profiles (null when it can). */
export const profilesSupportNoticeKey = (
  status: string,
  unsupportedReason: string | null
): string | null => {
  if (status !== 'unsupported') return null;
  return unsupportedReason === 'incompatible_contract'
    ? `${R}.profiles_incompatible`
    : `${R}.profiles_unsupported`;
};

/** Accounts of another provider, for the one quiet line (e.g. Codex). */
export const otherProviderLine = (files: AuthFileItem[], provider: string): Copy | null => {
  const count = files.filter(
    (file) => accountProviderKey(file) === provider && !isAccountDisabled(file)
  ).length;
  if (count === 0) return null;
  return count === 1 ? { key: `${R}.codex.one` } : { key: `${R}.codex.many`, values: { count } };
};
