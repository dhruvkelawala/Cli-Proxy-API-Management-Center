/**
 * The Overview page's read model: each provider's accounts in routing order with their recent
 * traffic, and the one sentence that says how the system is doing. React-free; copy is returned
 * as i18n key descriptors so it can be tested without rendering.
 *
 * Account state (who serves, who is cooling down, who is out) comes from the Routing page's
 * buildOrder, so both pages always agree.
 */

import { accountProviderKey } from '@/features/authFiles/accountPresentation';
import {
  buildOrder,
  healthCopy,
  healthTone,
  type Copy,
  type FormatWhen,
  type JoinNames,
  type OrderAccount,
  type OrderModel,
} from '@/features/clientProfiles/routing/routingOrder';
import { NO_QUOTA, type QuotaSummary } from '@/features/quota/quotaSummary';
import type { AuthFileItem } from '@/types';
import type { RoutingStrategy } from '@/types/visualConfig';
import { normalizeRecentRequestUsageEntry } from '@/utils/recentRequests';

const O = 'overview';

/* ------------------------------------------------------------------ */
/* Traffic                                                             */
/* ------------------------------------------------------------------ */

/** Buckets (10 minutes each) that count as "now" for the live dots. */
export const RECENT_BUCKETS = 3;

export interface Traffic {
  /** Over the whole recent window the backend reports (20 × 10 minutes). */
  success: number;
  failed: number;
  /** Over the last RECENT_BUCKETS buckets. */
  recentSuccess: number;
  recentFailed: number;
}

export const NO_TRAFFIC: Traffic = { success: 0, failed: 0, recentSuccess: 0, recentFailed: 0 };

export const trafficOf = (file: AuthFileItem): Traffic => {
  const buckets = normalizeRecentRequestUsageEntry(file).recentRequests;
  const recent = buckets.slice(-RECENT_BUCKETS);
  const sum = (list: typeof buckets, key: 'success' | 'failed') =>
    list.reduce((total, bucket) => total + bucket[key], 0);
  return {
    success: sum(buckets, 'success'),
    failed: sum(buckets, 'failed'),
    recentSuccess: sum(recent, 'success'),
    recentFailed: sum(recent, 'failed'),
  };
};

const addTraffic = (a: Traffic, b: Traffic): Traffic => ({
  success: a.success + b.success,
  failed: a.failed + b.failed,
  recentSuccess: a.recentSuccess + b.recentSuccess,
  recentFailed: a.recentFailed + b.recentFailed,
});

export const trafficTotal = (traffic: Traffic) => traffic.success + traffic.failed;
export const recentTotal = (traffic: Traffic) => traffic.recentSuccess + traffic.recentFailed;

/* ------------------------------------------------------------------ */
/* Providers                                                           */
/* ------------------------------------------------------------------ */

export interface OverviewAccount {
  account: OrderAccount;
  traffic: Traffic;
}

export interface ProviderGroup {
  provider: string;
  model: OrderModel;
  /** Enabled accounts in routing order, then turned-off ones. */
  accounts: OverviewAccount[];
  traffic: Traffic;
}

/** Providers the user lives in come first; the rest by size, then name. */
const PROVIDER_ORDER = ['claude', 'codex'];

export interface BuildGroupsInput {
  files: AuthFileItem[];
  strategy: RoutingStrategy;
  sessionAffinity: boolean;
  quotaFor?: (file: AuthFileItem) => QuotaSummary;
}

export const buildProviderGroups = ({
  files,
  strategy,
  sessionAffinity,
  quotaFor = () => NO_QUOTA,
}: BuildGroupsInput): ProviderGroup[] => {
  const providers = Array.from(new Set(files.map(accountProviderKey)));
  const groups = providers.map((provider): ProviderGroup => {
    const model = buildOrder({ files, provider, strategy, sessionAffinity, quotaFor });
    const accounts = [...model.order, ...model.off].map((account) => ({
      account,
      traffic: trafficOf(account.file),
    }));
    const traffic = accounts.reduce((total, item) => addTraffic(total, item.traffic), NO_TRAFFIC);
    return { provider, model, accounts, traffic };
  });
  const rank = (provider: string) => {
    const index = PROVIDER_ORDER.indexOf(provider);
    return index < 0 ? PROVIDER_ORDER.length : index;
  };
  return groups.sort(
    (a, b) =>
      rank(a.provider) - rank(b.provider) ||
      b.accounts.length - a.accounts.length ||
      a.provider.localeCompare(b.provider)
  );
};

/* ------------------------------------------------------------------ */
/* The sentence                                                        */
/* ------------------------------------------------------------------ */

export type OverviewTone = 'ok' | 'warn' | 'bad' | 'idle';

export interface OverviewSentence {
  tone: OverviewTone;
  title: Copy[];
  subtitle: Copy[];
}

export type ConnectionState = 'connected' | 'connecting' | 'disconnected' | 'error' | string;

export interface DescribeOverviewInput {
  connection: ConnectionState;
  /** null while the account list is loading (or could never be read). */
  groups: ProviderGroup[] | null;
  /** The latest account-list read failed. */
  filesFailed?: boolean;
  providerLabel: (provider: string) => string;
  formatWhen: FormatWhen;
  join: JoinNames;
}

type Situation =
  | { kind: 'ok'; group: ProviderGroup; serving: OrderAccount[] }
  | { kind: 'switched'; group: ProviderGroup; out: OrderAccount; serving: OrderAccount }
  | { kind: 'none'; group: ProviderGroup }
  | { kind: 'all_off'; group: ProviderGroup };

const situationOf = (group: ProviderGroup): Situation => {
  const { model } = group;
  if (model.order.length === 0) return { kind: 'all_off', group };
  const [now] = model.serving;
  if (!now) return { kind: 'none', group };
  if (!model.shared) {
    const out = model.order.find(
      (account) => account.rank < now.rank && account.role === 'resting' && !account.weightExcluded
    );
    if (out) return { kind: 'switched', group, out, serving: now };
  }
  return { kind: 'ok', group, serving: model.serving };
};

/** Failure share (0-100) of the recent window at or above which the sentence says so. */
export const FAILING_PERCENT = 20;
/** Fewer requests than this are too few to call anything failing. */
const FAILING_MIN_REQUESTS = 10;

const isFailing = (traffic: Traffic) => {
  const total = trafficTotal(traffic);
  return total >= FAILING_MIN_REQUESTS && (traffic.failed / total) * 100 >= FAILING_PERCENT;
};

/** Enabled accounts that need a person: errors, or resting without being the reason for a switch. */
const attentionNames = (situations: Situation[]): string[] =>
  situations.flatMap((situation) =>
    situation.group.model.order
      .filter(
        (account) =>
          account.health === 'attention' ||
          (account.role === 'resting' &&
            !account.weightExcluded &&
            !(situation.kind === 'switched' && situation.out.id === account.id))
      )
      .map((account) => account.label)
  );

/** The account name, or nothing when it only repeats the provider ("Codex is on Codex"). */
const sameName = (account: OrderAccount, provider: string) =>
  account.label.trim().toLowerCase() === provider.trim().toLowerCase();

const outKey = (account: OrderAccount) =>
  account.health === 'limit' ? 'limit' : account.health === 'cooling' ? 'cooling' : 'out';

/** One short sentence for a provider that is not the headline. */
const otherLine = (situation: Situation, label: string, join: JoinNames): Copy => {
  const provider = label;
  switch (situation.kind) {
    case 'none':
      return { key: `${O}.line.none`, values: { provider } };
    case 'all_off':
      return { key: `${O}.line.all_off`, values: { provider } };
    case 'switched':
      return {
        key: `${O}.line.switched_${outKey(situation.out)}`,
        values: { provider, out: situation.out.label, account: situation.serving.label },
      };
    default: {
      const { serving } = situation;
      if (serving.length > 1) {
        return {
          key: `${O}.line.shared`,
          values: { provider, accounts: join(serving.map((a) => a.label)) },
        };
      }
      return sameName(serving[0], provider)
        ? { key: `${O}.line.running`, values: { provider } }
        : { key: `${O}.line.on`, values: { provider, account: serving[0].label } };
    }
  }
};

/**
 * The headline (one or two short sentences) and the quiet line under it. The headline names
 * the most important thing: the gateway is unreachable, requests are failing, a provider has no
 * account that can serve, an account ran out and traffic moved, or all is well and who serves.
 */
export const describeOverview = ({
  connection,
  groups,
  providerLabel,
  formatWhen,
  join,
  filesFailed = false,
}: DescribeOverviewInput): OverviewSentence => {
  if (connection === 'connecting') {
    return { tone: 'idle', title: [{ key: `${O}.hero.connecting` }], subtitle: [] };
  }
  if (connection !== 'connected') {
    return {
      tone: 'bad',
      title: [{ key: `${O}.hero.offline` }],
      subtitle: [{ key: `${O}.hero.offline_follow` }],
    };
  }
  if (groups === null) {
    return filesFailed
      ? {
          tone: 'bad',
          title: [{ key: `${O}.hero.unreadable` }],
          subtitle: [{ key: `${O}.hero.unreadable_follow` }],
        }
      : { tone: 'idle', title: [{ key: `${O}.hero.loading` }], subtitle: [] };
  }
  if (groups.length === 0) {
    return {
      tone: 'idle',
      title: [{ key: `${O}.hero.empty` }],
      subtitle: [{ key: `${O}.hero.empty_follow` }],
    };
  }

  const situations = groups.map(situationOf);
  const label = (situation: Situation) => providerLabel(situation.group.provider);
  const attention = attentionNames(situations);
  const total = groups.reduce((sum, group) => addTraffic(sum, group.traffic), NO_TRAFFIC);

  // The headline situation: worst first, else the first provider.
  const headline =
    situations.find((s) => s.kind === 'none') ??
    situations.find((s) => s.kind === 'switched') ??
    situations.find((s) => s.kind === 'ok') ??
    situations[0];

  const title: Copy[] = [];
  const subtitle: Copy[] = [];
  let tone: OverviewTone = 'ok';
  const provider = label(headline);

  if (isFailing(total)) {
    tone = 'bad';
    title.push({
      key: `${O}.hero.failing`,
      values: { percent: Math.round((total.failed / trafficTotal(total)) * 100) },
    });
  }

  switch (headline.kind) {
    case 'none':
      tone = 'bad';
      title.push({ key: `${O}.hero.none`, values: { provider } });
      subtitle.push({ key: `${O}.hero.none_follow` });
      break;
    case 'all_off':
      if (tone !== 'bad') tone = 'warn';
      title.push({ key: `${O}.hero.all_off`, values: { provider } });
      break;
    case 'switched': {
      if (tone !== 'bad') tone = 'warn';
      const { out, serving } = headline;
      title.push({
        key: `${O}.hero.switched_${outKey(out)}`,
        values: { out: out.label, provider, account: serving.label },
      });
      subtitle.push(
        out.retryAt
          ? { key: `${O}.hero.back_at`, values: { out: out.label, when: formatWhen(out.retryAt) } }
          : { key: `${O}.hero.back_later`, values: { out: out.label } }
      );
      break;
    }
    default: {
      const { serving, group } = headline;
      const quiet = recentTotal(total) === 0;
      if (title.length === 0) {
        if (attention.length > 0) tone = 'warn';
        else title.push({ key: quiet ? `${O}.hero.quiet` : `${O}.hero.flowing` });
      }
      if (serving.length > 1) {
        title.push({
          key: `${O}.hero.shared`,
          values: { provider, accounts: join(serving.map((a) => a.label)) },
        });
      } else {
        const [now] = serving;
        title.push(
          sameName(now, provider)
            ? { key: `${O}.hero.running`, values: { provider } }
            : { key: `${O}.hero.on`, values: { provider, account: now.label } }
        );
        const backup = group.model.order.find(
          (account) =>
            account.id !== now.id && (account.role === 'next' || account.role === 'backup')
        );
        if (backup) {
          subtitle.push({
            key: `${O}.hero.backup`,
            values: { account: now.label, provider, backup: backup.label },
          });
        }
      }
    }
  }

  situations
    .filter((situation) => situation !== headline)
    .forEach((situation) => subtitle.push(otherLine(situation, label(situation), join)));

  const nearlyOut = situations.flatMap((situation) =>
    situation.group.model.order
      .filter((account) => account.nearlyOut && account.role !== 'off')
      .map((account) => account.label)
  );
  if (nearlyOut.length > 0) {
    if (tone === 'ok') tone = 'warn';
    subtitle.push({
      key: nearlyOut.length === 1 ? `${O}.hero.nearly_out_one` : `${O}.hero.nearly_out_many`,
      values: { names: join(nearlyOut) },
    });
  }

  if (attention.length > 0) {
    subtitle.push({
      key: attention.length === 1 ? `${O}.hero.attention_one` : `${O}.hero.attention_many`,
      values: { names: join(attention) },
    });
  }

  return { tone, title, subtitle };
};

/** Sentences joined for display: no space between Chinese sentences, one elsewhere. */
export const joinSentences = (sentences: string[], language: string): string =>
  sentences.join(/^zh/i.test(language) ? '' : ' ');

/* ------------------------------------------------------------------ */
/* Time                                                                */
/* ------------------------------------------------------------------ */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "2h 10m", "1d 16h", "45m" until an instant, as an i18n key descriptor. */
export const durationCopy = (targetMs: number, now: number): Copy => {
  const left = targetMs - now;
  if (left < MINUTE) return { key: `${O}.in.now` };
  if (left < HOUR) return { key: `${O}.in.m`, values: { m: Math.floor(left / MINUTE) } };
  if (left < DAY) {
    return {
      key: `${O}.in.hm`,
      values: { h: Math.floor(left / HOUR), m: Math.floor((left % HOUR) / MINUTE) },
    };
  }
  return {
    key: `${O}.in.dh`,
    values: { d: Math.floor(left / DAY), h: Math.floor((left % DAY) / HOUR) },
  };
};

/* ------------------------------------------------------------------ */
/* The flow                                                            */
/* ------------------------------------------------------------------ */

/**
 * live: serving now (accent). idle: a backup waiting. warn: cooling down or out of room.
 * bad: errors. off: turned off.
 */
export type FlowAccountState = 'live' | 'idle' | 'warn' | 'bad' | 'off';

export const flowStateOf = (account: OrderAccount): FlowAccountState => {
  if (account.role === 'off') return 'off';
  if (account.role === 'active') return 'live';
  if (account.health === 'cooling' || account.health === 'limit') return 'warn';
  if (account.weightExcluded) return 'off';
  if (account.role === 'resting') return 'bad';
  return 'idle';
};

/**
 * How much a path carries, 0-1: its share of the busiest account's recent traffic. Accounts
 * that cannot serve now carry nothing, whatever they did earlier in the window.
 */
export const flowVolume = (item: OverviewAccount, busiest: number): number => {
  const state = flowStateOf(item.account);
  if (state === 'off' || state === 'warn' || busiest <= 0) return 0;
  return Math.min(1, recentTotal(item.traffic) / busiest);
};

/** Failed share (0-1) of an account's recent traffic. */
export const flowFailures = (traffic: Traffic): number => {
  const total = recentTotal(traffic);
  return total > 0 ? traffic.recentFailed / total : 0;
};

/** What an account node says: serving, standing by, or its health in plain words. */
export const accountStatusCopy = (
  account: OrderAccount,
  formatWhen: FormatWhen
): { tone: 'ok' | 'warn' | 'bad' | 'off' | 'unknown'; copy: Copy } => {
  if (account.role === 'active') {
    if (account.nearlyOut) return { tone: 'warn', copy: { key: `${O}.state.serving_nearly_out` } };
    return account.health === 'attention'
      ? { tone: 'ok', copy: { key: `${O}.state.serving_errors` } }
      : { tone: 'ok', copy: { key: `${O}.state.serving` } };
  }
  if (account.role === 'next' || account.role === 'backup') {
    return account.health === 'attention'
      ? { tone: 'ok', copy: { key: 'routing.health.attention' } }
      : { tone: 'ok', copy: { key: `${O}.state.standby` } };
  }
  return { tone: healthTone(account), copy: healthCopy(account, formatWhen) };
};
