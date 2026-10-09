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
import type { RoutingStrategy } from '@/types/visualConfig';
import type {
  ClientProfile,
  ClientProfileAccount,
  ClientProfileProvider,
  ClientProfilesSnapshot,
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

export interface QuotaSummary {
  status: 'loading' | 'ready' | 'none';
  /** Percent left, 0-100. */
  sessionLeft: number | null;
  sessionResetAt: number | null;
  weekLeft: number | null;
  weekResetAt: number | null;
}

export const NO_QUOTA: QuotaSummary = {
  status: 'none',
  sessionLeft: null,
  sessionResetAt: null,
  weekLeft: null,
  weekResetAt: null,
};

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
  priority: number;
  role: AccountRole;
  /** 0 = top level. Accounts on one level share a rank. */
  rank: number;
  quota: QuotaSummary;
}

const percentLeft = (used: number | null | undefined) =>
  typeof used === 'number' && Number.isFinite(used)
    ? Math.max(0, Math.min(100, Math.round(100 - used)))
    : null;

/** Weekly and five-hour room left from the Quota page's cached Claude state. */
export const summarizeClaudeQuota = (state: ClaudeQuotaState | undefined): QuotaSummary => {
  if (!state || state.status === 'idle' || state.status === 'error') return NO_QUOTA;
  if (state.status === 'loading') return { ...NO_QUOTA, status: 'loading' };
  const session = state.windows.find((window) => window.periodHours === 5) ?? null;
  const week =
    state.windows.find((window) => window !== session && window.periodHours === 168) ?? null;
  if (!session && !week) return NO_QUOTA;
  return {
    status: 'ready',
    sessionLeft: percentLeft(session?.usedPercent),
    sessionResetAt: session?.resetAtMs ?? null,
    weekLeft: percentLeft(week?.usedPercent),
    weekResetAt: week?.resetAtMs ?? null,
  };
};

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
  /** First → last. */
  order: OrderAccount[];
  /** Accounts receiving new conversations now. */
  serving: OrderAccount[];
  /** Every enabled account shares one priority: the strategy decides, not the order. */
  sameLevel: boolean;
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
    })),
  });
  const levels = Array.from(
    new Set(base.filter((a) => a.health !== 'disabled').map((a) => a.priority))
  ).sort((a, b) => b - a);

  const order = base
    .map((account, index): OrderAccount => {
      const item = presentation.accounts[index];
      const share = item?.sharePercent ?? null;
      let role: AccountRole;
      if (account.health === 'disabled') role = 'off';
      else if (account.simulatedOut || !isUsable(account.health)) role = 'resting';
      else if (share !== null && share > 0) role = 'active';
      else if (item?.reason === 'standby') role = 'next';
      else role = 'backup';
      return { ...account, role, rank: Math.max(0, levels.indexOf(account.priority)) };
    })
    .sort(byOrder);

  return {
    order,
    serving: order.filter((account) => account.role === 'active'),
    sameLevel: levels.length <= 1,
  };
};

/* ------------------------------------------------------------------ */
/* Reordering → priorities                                             */
/* ------------------------------------------------------------------ */

export const FIRST_PRIORITY_STEP = 10;

/**
 * Priorities for a new order (first → last). Existing distinct priorities are kept and handed
 * out again in the new order (an already-ordered list writes nothing; a swap swaps values).
 * Otherwise (ties, e.g. everything on 0) the last gets 0 and each earlier one 10 more:
 * two accounts become 10 (first) and 0 (backup).
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

export interface PriorityChange {
  id: string;
  name: string;
  from: number;
  to: number;
}

/**
 * Only accounts whose priority actually changes, demotions first: if a later write fails, no
 * account has been raised above where it stood, so the gateway never ends up with an order the
 * user did not ask for (at worst two accounts share a level).
 */
export const priorityChanges = (
  current: ReadonlyArray<Pick<OrderAccount, 'id' | 'name' | 'priority'>>,
  plan: Record<string, number>
): PriorityChange[] =>
  current
    .filter((account) => plan[account.id] !== undefined && plan[account.id] !== account.priority)
    .map((account) => ({
      id: account.id,
      name: account.name,
      from: account.priority,
      to: plan[account.id],
    }))
    .sort((a, b) => a.to - b.to);

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
  const { order, serving, sameLevel } = model;
  if (order.length === 0) {
    return { title: { key: `${R}.title_empty` }, follow: { key: `${R}.follow_empty` } };
  }
  if (serving.length === 0) {
    return { title: { key: `${R}.title_none` }, follow: { key: `${R}.follow_none` } };
  }
  if (sameLevel && serving.length > 1) {
    return {
      title: { key: `${R}.title_shared`, values: { accounts: join(serving.map((a) => a.label)) } },
      follow: { key: `${R}.follow_shared` },
    };
  }
  const [now] = serving;
  const out = order.find((account) => account.rank < now.rank && account.role === 'resting');
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

/** Short label of a card's position: First, Backup, Shared or Off. */
export const rankKey = (account: OrderAccount, place: number, sameLevel: boolean): string => {
  if (account.role === 'off') return `${R}.rank.off`;
  if (sameLevel) return `${R}.rank.shared`;
  return place === 0 ? `${R}.rank.first` : `${R}.rank.backup`;
};

/** Health in plain words. */
export const healthCopy = (account: OrderAccount, formatWhen: FormatWhen): Copy => {
  if (account.simulatedOut) return { key: `${R}.health.preview_out` };
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
 * "Use the one that resets sooner first": weekly room left is lost at the reset, so the account
 * resetting sooner should go first. `account` is set when acting on the hint helps.
 */
export const resetHint = (
  model: OrderModel,
  formatWhen: FormatWhen
): { copy: Copy; account: OrderAccount | null } | null => {
  const [first, second] = model.order;
  if (!first || !second || model.sameLevel || first.role === 'resting' || first.simulatedOut) {
    return null;
  }
  const a = first.quota.weekResetAt;
  const b = second.quota.weekResetAt;
  if (!a || !b || !isUsable(second.health)) return null;
  if (b < a - RESET_SLACK_MS && (second.quota.weekLeft ?? 0) > 0) {
    return {
      account: second,
      copy: {
        key: `${R}.hint.sooner_bad`,
        values: { account: second.label, when: formatWhen(b), percent: second.quota.weekLeft ?? 0 },
      },
    };
  }
  if (a < b - RESET_SLACK_MS) {
    return {
      account: null,
      copy: { key: `${R}.hint.sooner_good`, values: { account: first.label, when: formatWhen(a) } },
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
  /** The Only target in the order, when it can be matched. */
  target: OrderAccount | null;
  /** Requests with this rule fail (target unavailable, removed, unknown mode, …). */
  broken: boolean;
}

/** Each profile's rule for one provider, resolved against the order. */
export const describeClientRoutes = (
  snapshot: Pick<ClientProfilesSnapshot, 'profiles' | 'accounts' | 'targetStates'>,
  provider: ClientProfileProvider,
  order: OrderAccount[]
): ClientRoute[] =>
  snapshot.profiles.map((profile) => {
    const policy = profile.policies[provider];
    const shortName = shortClientName(profile.label);
    if (policy.mode === 'automatic') {
      return { profile, shortName, locked: false, target: null, broken: false };
    }
    if (policy.mode !== 'only') {
      return { profile, shortName, locked: true, target: null, broken: true };
    }
    const target = order.find((account) => account.inventory?.accountRef === policy.accountRef);
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
    };
  });

/** The quiet line under the diagram: who follows the order, and who is locked. */
export const describeClientsLine = (
  routes: ClientRoute[],
  join: JoinNames
): { copies: Copy[]; problem: boolean } => {
  if (routes.length === 0) return { copies: [{ key: `${R}.clients.none` }], problem: false };
  const following = routes.filter((route) => !route.locked);
  const locked = routes.filter((route) => route.locked);
  const copies: Copy[] = [];
  if (following.length > 0) {
    const names = join(following.map((route) => route.shortName));
    const key = following.length === 1 ? 'one' : following.length === 2 ? 'two' : 'many';
    copies.push({ key: `${R}.clients.${key}`, values: { names } });
  }
  locked.forEach((route) => {
    if (!route.target) {
      copies.push({ key: `${R}.clients.locked_missing`, values: { client: route.shortName } });
    } else {
      copies.push({
        key: route.broken ? `${R}.clients.locked_broken` : `${R}.clients.locked`,
        values: { client: route.shortName, account: route.target.label },
      });
    }
  });
  return { copies, problem: locked.some((route) => route.broken) };
};

/** Accounts of another provider, for the one quiet line (e.g. Codex). */
export const otherProviderLine = (files: AuthFileItem[], provider: string): Copy | null => {
  const count = files.filter(
    (file) => accountProviderKey(file) === provider && !isAccountDisabled(file)
  ).length;
  if (count === 0) return null;
  return count === 1 ? { key: `${R}.codex.one` } : { key: `${R}.codex.many`, values: { count } };
};
