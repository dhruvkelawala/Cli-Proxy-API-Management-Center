/**
 * PROTOTYPE (throwaway, branch prototype/client-routes-friendly).
 *
 * One read model for the three friendly Client routes variants. Reads the real stores (client
 * profiles, Accounts list, saved shared routing settings, cached Claude quota). Every "write" is
 * a local optimistic override plus a "Prototype — not saved" toast: nothing here calls a mutating
 * Management API endpoint. The only network calls are reads (lists, config, quota).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/services/api';
import { useAuthStore, useConfigStore, useQuotaStore } from '@/stores';
import { useClientProfilesStore } from '@/stores/useClientProfilesStore';
import type { AuthFileItem, ClaudeQuotaState } from '@/types';
import type { RoutingStrategy } from '@/types/visualConfig';
import type { ClientProfileAccount } from '@/types/clientProfiles';
import { gatewayDisplayHost } from '@/utils/connection';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import {
  accountProviderKey,
  isAccountDisabled,
  resolveAccountAvailability,
} from '@/features/authFiles/accountPresentation';
import { deriveAccountTitle } from '@/features/authFiles/identity';
import { buildRoutingPresentation } from '@/features/config/routing/routingPresentation';
import { CLAUDE_CONFIG } from '@/features/quota/providers/claude/data';
import { useClientRoutesData } from '../hooks/useClientRoutesData';
import { credentialRefForAuthFile, isFailingTargetState } from '../model';

export type Health = 'available' | 'attention' | 'cooling' | 'limit' | 'disabled' | 'unknown';

/**
 * Where an account stands for Automatic right now:
 * active = gets new chats; next = same level, waits its turn (fill-first);
 * backup = lower level, steps in when everything above is out; resting/off = not usable.
 */
export type AutoRole = 'active' | 'next' | 'backup' | 'resting' | 'off';

export type QuotaSummary = {
  status: 'loading' | 'ready' | 'none';
  /** Percent left in the 5-hour window, 0-100. */
  sessionLeft: number | null;
  sessionReset: string;
  sessionResetAt: number | null;
  /** Percent left this week, 0-100. */
  weekLeft: number | null;
  weekReset: string;
  weekResetAt: number | null;
};

export type ProtoAccount = {
  id: string;
  /** Stable colour slot (A, B, …) by label; never changes when the order changes. */
  letter: string;
  initial: string;
  label: string;
  email: string;
  file: AuthFileItem;
  inventory: ClientProfileAccount | null;
  /** Has a durable account reference already (set up for "Only"). */
  ready: boolean;
  health: Health;
  healthText: string;
  /** Cooldown deadline, if the server reported one. */
  retryAt: number | null;
  /** Requests can reach this account right now (ignores the what-if preview). */
  usable: boolean;
  /** Treated as out of room by the "what if" preview. */
  simulatedOut: boolean;
  priority: number;
  /** 0 = goes first. Accounts on the same level share a rank. */
  rank: number;
  weight: number;
  /** Share of new Automatic chats, 0-100; null when not getting any now. */
  share: number | null;
  role: AutoRole;
  quota: QuotaSummary;
};

export type Choice = 'auto' | string;

export type ProtoClient = {
  ref: string;
  name: string;
  shortName: string;
  keyCount: number;
  saved: Choice;
  choice: Choice;
  changed: boolean;
  target: ProtoAccount | null;
  /** Only rule whose target can't be used: requests fail. */
  broken: boolean;
  brokenReason: string | null;
  /** Saved rule that the prototype can't map (unknown mode, removed target). */
  unknownRule: boolean;
};

export type StrategyKey = RoutingStrategy;

/** Friendly names for priority + strategy: first/backup, take turns, split by weight. */
export type Arrangement = 'backup' | 'turns' | 'split';

export type ProtoModel = {
  status: 'loading' | 'ready' | 'unsupported' | 'error';
  host: string;
  /** Colour order (by label). */
  accounts: ProtoAccount[];
  /** Automatic order: first → backup. */
  order: ProtoAccount[];
  /** Accounts getting new Automatic chats right now. */
  serving: ProtoAccount[];
  clients: ProtoClient[];
  strategy: StrategyKey;
  /** Every usable account is on one level: the strategy decides; otherwise priority does. */
  sameLevel: boolean;
  sessionAffinity: boolean;
  enforcement: boolean | null;
  codex: { accounts: number; allAutomatic: boolean };
  simulateOut: string | null;
  setSimulateOut: (accountId: string | null) => void;
  setChoice: (ref: string, choice: Choice) => void;
  setStrategy: (strategy: StrategyKey) => void;
  setWeight: (accountId: string, weight: number) => void;
  /** New first→backup order (ids). Writes distinct priorities locally. */
  setOrder: (ids: string[]) => void;
  /** Put every account on one level (the strategy then shares between them). */
  setSameLevel: (same: boolean) => void;
  setSessionAffinity: (on: boolean) => void;
  arrangement: Arrangement;
  setArrangement: (next: Arrangement) => void;
  toast: { id: number; text: string; detail?: string } | null;
  dismissToast: () => void;
  refresh: () => void;
};

const LETTERS = 'ABCDEFGH';
const NOT_SAVED = 'Prototype — not saved.';

export const formatClock = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** "today 14:20", "tomorrow 09:00", "Sat 10:00". */
export const formatWhen = (ms: number) => {
  const date = new Date(ms);
  const today = new Date();
  const days = Math.round(
    (new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() -
      new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) /
      86_400_000
  );
  const clock = formatClock(ms);
  if (days === 0) return `today at ${clock}`;
  if (days === 1) return `tomorrow at ${clock}`;
  return `${date.toLocaleDateString([], { weekday: 'short' })} ${clock}`;
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

const describeHealth = (
  file: AuthFileItem
): { health: Health; text: string; retryAt: number | null } => {
  const availability = resolveAccountAvailability(file);
  const retryAt = readRetryAt(file);
  if (availability === null) return { health: 'disabled', text: 'Turned off', retryAt };
  if (file.unavailable === true || availability === 'coolingDown') {
    return {
      health: 'cooling',
      text: retryAt ? `Cooling down until ${formatClock(retryAt)}` : 'Cooling down',
      retryAt,
    };
  }
  if (availability === 'attention') {
    return { health: 'attention', text: 'Available, a few recent errors', retryAt };
  }
  if (availability === 'available') return { health: 'available', text: 'Available', retryAt };
  return { health: 'unknown', text: 'Status unknown', retryAt };
};

const NO_QUOTA: QuotaSummary = {
  status: 'none',
  sessionLeft: null,
  sessionReset: '',
  sessionResetAt: null,
  weekLeft: null,
  weekReset: '',
  weekResetAt: null,
};

const summarizeQuota = (state: ClaudeQuotaState | undefined): QuotaSummary => {
  if (!state || state.status === 'idle' || state.status === 'error') return NO_QUOTA;
  if (state.status === 'loading') return { ...NO_QUOTA, status: 'loading' };
  const session = state.windows.find((window) => window.periodHours === 5) ?? state.windows[0];
  const week = state.windows.find((window) => window !== session && window.periodHours === 168);
  const left = (used: number | null | undefined) =>
    typeof used === 'number' ? Math.max(0, Math.min(100, Math.round(100 - used))) : null;
  if (!session && !week) return NO_QUOTA;
  return {
    status: 'ready',
    sessionLeft: left(session?.usedPercent),
    sessionReset: session?.resetLabel ?? '',
    sessionResetAt: session?.resetAtMs ?? null,
    weekLeft: left(week?.usedPercent),
    weekReset: week?.resetLabel ?? '',
    weekResetAt: week?.resetAtMs ?? null,
  };
};

const shortNameOf = (label: string) => label.split('·')[0].trim() || label;

export function useProtoRoutesModel(): ProtoModel {
  const { t } = useTranslation();
  const storeStatus = useClientProfilesStore((state) => state.status);
  const snapshot = useClientProfilesStore((state) => state.snapshot);
  const capabilities = useClientProfilesStore((state) => state.capabilities);
  const apiBase = useAuthStore((state) => state.apiBase);
  const config = useConfigStore((state) => state.config);
  const { files, strategy: savedStrategy, refresh } = useClientRoutesData();
  const claudeQuota = useQuotaStore((state) => state.claudeQuota);
  const setClaudeQuota = useQuotaStore((state) => state.setClaudeQuota);

  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [strategyOverride, setStrategyOverride] = useState<StrategyKey | null>(null);
  const [affinityOverride, setAffinityOverride] = useState<boolean | null>(null);
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [priorities, setPriorities] = useState<Record<string, number>>({});
  const [simulateOut, setSimulateOut] = useState<string | null>(null);
  const [toast, setToast] = useState<ProtoModel['toast']>(null);
  const toastSeq = useRef(0);

  const notSaved = useCallback((text: string, detail = NOT_SAVED) => {
    toastSeq.current += 1;
    setToast({ id: toastSeq.current, text, detail });
  }, []);

  const claudeFiles = useMemo(
    () =>
      (files ?? [])
        .filter((file) => accountProviderKey(file) === 'claude')
        .sort((a, b) =>
          (deriveAccountTitle(a).title || a.name).localeCompare(
            deriveAccountTitle(b).title || b.name
          )
        ),
    [files]
  );

  // Quota is read-only: reuse the Quota page cache, fetch missing Claude entries once.
  const requested = useRef(new Set<string>());
  useEffect(() => {
    const connection = apiClient.getConnectionRevision();
    claudeFiles.forEach((file) => {
      if (isAccountDisabled(file)) return;
      const key = getQuotaCacheKey(file);
      if (claudeQuota[key] || requested.current.has(key)) return;
      requested.current.add(key);
      setClaudeQuota((prev) => ({ ...prev, [key]: CLAUDE_CONFIG.buildLoadingState() }));
      CLAUDE_CONFIG.fetchQuota(file, t)
        .then((data) => {
          if (connection !== apiClient.getConnectionRevision()) return;
          setClaudeQuota((prev) => ({ ...prev, [key]: CLAUDE_CONFIG.buildSuccessState(data) }));
        })
        .catch((error: unknown) => {
          if (connection !== apiClient.getConnectionRevision()) return;
          const message = error instanceof Error ? error.message : 'Quota unavailable';
          setClaudeQuota((prev) => ({ ...prev, [key]: CLAUDE_CONFIG.buildErrorState(message) }));
        });
    });
  }, [claudeFiles, claudeQuota, setClaudeQuota, t]);

  const strategy: StrategyKey = strategyOverride ?? savedStrategy ?? 'round-robin';
  const sessionAffinity = affinityOverride ?? config?.routingSessionAffinity === true;

  const accounts = useMemo<ProtoAccount[]>(() => {
    const inventory = snapshot?.accounts ?? [];
    const base = claudeFiles.map((file, index) => {
      const id = typeof file.id === 'string' && file.id ? file.id : file.name;
      const ref = credentialRefForAuthFile(file);
      const match = ref ? (inventory.find((item) => item.credentialRef === ref) ?? null) : null;
      const { health, text, retryAt } = describeHealth(file);
      const label = deriveAccountTitle(file).title || file.email || file.name;
      const savedPriority =
        typeof file.priority === 'number' && Number.isSafeInteger(file.priority)
          ? file.priority
          : 0;
      return {
        id,
        file,
        letter: LETTERS[index] ?? String(index + 1),
        initial: label.trim().charAt(0).toUpperCase() || '?',
        label,
        email: typeof file.email === 'string' ? file.email : '',
        inventory: match,
        ready: Boolean(match?.accountRef),
        health,
        healthText: text,
        retryAt,
        usable: health === 'available' || health === 'attention' || health === 'unknown',
        simulatedOut: simulateOut === id,
        priority: priorities[id] ?? savedPriority,
        weight: weights[id] ?? (typeof file.weight === 'number' ? file.weight : 1),
      };
    });
    const presentation = buildRoutingPresentation({
      strategy,
      sessionAffinity: { enabled: sessionAffinity },
      accounts: base.map((account) => ({
        id: account.id,
        label: account.label,
        provider: 'claude',
        enabled: account.health !== 'disabled',
        availability:
          account.health === 'cooling' || account.simulatedOut ? 'unavailable' : 'available',
        priority: account.priority,
        weight: account.weight,
      })),
    });
    const levels = Array.from(new Set(base.map((account) => account.priority))).sort(
      (a, b) => b - a
    );
    return base.map((account, index) => {
      const item = presentation.accounts[index];
      const share = item?.sharePercent ?? null;
      let role: AutoRole;
      if (account.health === 'disabled') role = 'off';
      else if (!account.usable || account.simulatedOut) role = 'resting';
      else if (share !== null && share > 0) role = 'active';
      else if (item?.reason === 'standby') role = 'next';
      else role = 'backup';
      const quota = summarizeQuota(claudeQuota[getQuotaCacheKey(account.file)]);
      let { health, healthText } = account;
      if (account.simulatedOut) {
        health = 'cooling';
        healthText = 'Out of room (preview)';
      }
      if ((health === 'available' || health === 'attention') && quota.status === 'ready') {
        const weekOut = quota.weekLeft === 0;
        const sessionOut = quota.sessionLeft === 0;
        if (weekOut || sessionOut) {
          health = 'limit';
          const at = weekOut ? quota.weekResetAt : quota.sessionResetAt;
          healthText = at ? `At its limit until ${formatWhen(at)}` : 'At its limit';
        }
      }
      return {
        ...account,
        health,
        healthText,
        rank: levels.indexOf(account.priority),
        share: share !== null && share > 0 ? share : null,
        role,
        quota,
      };
    });
  }, [
    claudeFiles,
    claudeQuota,
    priorities,
    sessionAffinity,
    simulateOut,
    snapshot,
    strategy,
    weights,
  ]);

  const order = useMemo(
    () =>
      [...accounts].sort(
        (a, b) => b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
      ),
    [accounts]
  );
  const serving = order.filter((account) => account.role === 'active');
  const usableLevels = new Set(
    accounts.filter((account) => account.health !== 'disabled').map((account) => account.priority)
  );
  const sameLevel = usableLevels.size <= 1;

  const clients = useMemo<ProtoClient[]>(() => {
    if (!snapshot) return [];
    return snapshot.profiles.map((profile) => {
      const policy = profile.policies.claude;
      let saved: Choice = 'auto';
      let unknownRule = false;
      if (policy.mode === 'only') {
        const target = accounts.find(
          (account) => account.inventory?.accountRef === policy.accountRef
        );
        if (target) saved = target.id;
        else unknownRule = true;
      } else if (policy.mode !== 'automatic') {
        unknownRule = true;
      }
      const choice = choices[profile.profileRef] ?? saved;
      const target = choice === 'auto' ? null : (accounts.find((a) => a.id === choice) ?? null);
      const shortName = shortNameOf(profile.label);
      const reported = snapshot.targetStates[profile.profileRef]?.claude;
      const reportedFailing =
        choice === saved && policy.mode === 'only' && reported
          ? isFailingTargetState(reported)
          : false;
      let brokenReason: string | null = null;
      if (target && (!target.usable || target.simulatedOut)) {
        brokenReason =
          target.health === 'disabled'
            ? `${target.label} is turned off, so ${shortName} can’t use Claude until you switch.`
            : `${target.label} is out of room${
                target.retryAt && !target.simulatedOut
                  ? ` until ${formatClock(target.retryAt)}`
                  : ''
              }, so ${shortName} is stopped. Switch to Automatic to keep working.`;
      } else if (reportedFailing || (choice === saved && unknownRule && policy.mode === 'only')) {
        brokenReason = `The account ${shortName} is locked to isn’t available, so ${shortName} is stopped.`;
      }
      return {
        ref: profile.profileRef,
        name: profile.label,
        shortName,
        keyCount: snapshot.keys.filter((key) => key.profileRef === profile.profileRef).length,
        saved,
        choice,
        changed: choice !== saved,
        target,
        broken: brokenReason !== null,
        brokenReason,
        unknownRule,
      };
    });
  }, [accounts, choices, snapshot]);

  const setChoice = useCallback(
    (ref: string, choice: Choice) => {
      const client = clients.find((item) => item.ref === ref);
      if (!client || client.choice === choice) return;
      setChoices((prev) => ({ ...prev, [ref]: choice }));
      const target = choice === 'auto' ? null : accounts.find((a) => a.id === choice);
      if (!target) {
        notSaved(`${client.shortName} → Automatic`);
        return;
      }
      const extra = [
        !target.ready ? `Would first set up ${target.label} for “Only” (one time, automatic).` : '',
        !target.usable ? `The gateway would refuse this while ${target.label} is out of room.` : '',
      ]
        .filter(Boolean)
        .join(' ');
      notSaved(
        `${client.shortName} → only ${target.label}`,
        `${NOT_SAVED}${extra ? ` ${extra}` : ''}`
      );
    },
    [accounts, clients, notSaved]
  );

  const setStrategy = useCallback(
    (next: StrategyKey) => {
      setStrategyOverride(next);
      notSaved(`Same-level accounts now: ${STRATEGY_COPY[next].title.toLowerCase()}`);
    },
    [notSaved]
  );

  const weightToast = useRef<number | null>(null);
  const setWeight = useCallback(
    (accountId: string, weight: number) => {
      setWeights((prev) => ({ ...prev, [accountId]: weight }));
      if (weightToast.current) window.clearTimeout(weightToast.current);
      weightToast.current = window.setTimeout(() => notSaved('Split updated'), 350);
    },
    [notSaved]
  );

  const setOrder = useCallback(
    (ids: string[]) => {
      const next: Record<string, number> = {};
      ids.forEach((id, index) => {
        next[id] = (ids.length - 1 - index) * 10;
      });
      setPriorities(next);
      const first = accounts.find((account) => account.id === ids[0]);
      const backup = accounts.find((account) => account.id === ids[1]);
      notSaved(
        first && backup ? `${first.label} first, ${backup.label} as backup` : 'Order updated',
        `Prototype — not saved (would set priorities ${ids.map((_, i) => (ids.length - 1 - i) * 10).join('/')}).`
      );
    },
    [accounts, notSaved]
  );

  const setSameLevel = useCallback(
    (same: boolean) => {
      if (same) {
        const next: Record<string, number> = {};
        accounts.forEach((account) => {
          next[account.id] = order[0]?.priority ?? 0;
        });
        setPriorities(next);
        notSaved(
          'Accounts now share one level',
          `${NOT_SAVED} The sharing style decides who goes.`
        );
      } else {
        const ids = order.map((account) => account.id);
        const next: Record<string, number> = {};
        ids.forEach((id, index) => {
          next[id] = (ids.length - 1 - index) * 10;
        });
        setPriorities(next);
        notSaved(`${order[0]?.label ?? 'First'} first, the rest as backup`);
      }
    },
    [accounts, notSaved, order]
  );

  const setSessionAffinity = useCallback(
    (on: boolean) => {
      setAffinityOverride(on);
      notSaved(on ? 'Chats stay on their account' : 'Every request picks again');
    },
    [notSaved]
  );

  const arrangement: Arrangement = !sameLevel
    ? 'backup'
    : strategy === 'weighted-round-robin'
      ? 'split'
      : strategy === 'round-robin'
        ? 'turns'
        : 'backup';

  const setArrangement = useCallback(
    (next: Arrangement) => {
      const ids = order.map((account) => account.id);
      const priorityMap: Record<string, number> = {};
      ids.forEach((id, index) => {
        priorityMap[id] =
          next === 'backup' ? (ids.length - 1 - index) * 10 : (order[0]?.priority ?? 0);
      });
      setPriorities(priorityMap);
      setStrategyOverride(
        next === 'backup' ? 'fill-first' : next === 'turns' ? 'round-robin' : 'weighted-round-robin'
      );
      notSaved(
        next === 'backup'
          ? `${order[0]?.label ?? 'First'} first, ${order[1]?.label ?? 'the other'} as backup`
          : next === 'turns'
            ? 'Accounts now take turns'
            : 'Accounts now split by weight'
      );
    },
    [notSaved, order]
  );

  const codexFiles = (files ?? []).filter((file) => accountProviderKey(file) === 'codex');
  const status =
    storeStatus === 'unsupported'
      ? 'unsupported'
      : storeStatus === 'error'
        ? 'error'
        : storeStatus === 'ready' && snapshot && files
          ? 'ready'
          : 'loading';

  return {
    status,
    host: gatewayDisplayHost(apiBase),
    accounts,
    order,
    serving,
    clients,
    strategy,
    sameLevel,
    sessionAffinity,
    enforcement: capabilities ? capabilities.enforcement : null,
    codex: {
      accounts: codexFiles.length,
      allAutomatic: (snapshot?.profiles ?? []).every((p) => p.policies.codex.mode === 'automatic'),
    },
    simulateOut,
    setSimulateOut,
    setChoice,
    setStrategy,
    setWeight,
    setOrder,
    setSameLevel,
    setSessionAffinity,
    arrangement,
    setArrangement,
    toast,
    dismissToast: useCallback(() => setToast(null), []),
    refresh: () => void refresh(),
  };
}

export const STRATEGY_COPY: Record<StrategyKey, { short: string; title: string; body: string }> = {
  'fill-first': {
    short: 'One until full',
    title: 'Use one until it’s full',
    body: 'Everything goes to the first account; the next steps in only when it runs out.',
  },
  'round-robin': {
    short: 'Take turns',
    title: 'Take turns',
    body: 'Each new chat goes to the next account in line, so they share evenly.',
  },
  'weighted-round-robin': {
    short: 'Split by weight',
    title: 'Split by weight',
    body: 'Accounts take turns, but a heavier account gets more of the new chats.',
  },
};

/**
 * The answer to "where do new conversations go?" in one or two plain sentences.
 * `lead` is the main line; `follow` the fallback line.
 */
export const describeServing = (model: ProtoModel): { lead: string; follow: string } => {
  const { order, serving, sameLevel } = model;
  if (serving.length === 0) {
    return {
      lead: 'No Claude account has room right now.',
      follow: 'New conversations will fail until one recovers.',
    };
  }
  if (sameLevel && serving.length > 1) {
    return {
      lead: `New conversations are shared between ${serving.map((a) => a.label).join(' and ')}.`,
      follow: 'If one runs out, the other carries on alone.',
    };
  }
  const [now] = serving;
  const ahead = order.filter((a) => a.rank < now.rank && a.role === 'resting');
  if (ahead.length) {
    const out = ahead[0];
    const back =
      out.retryAt && !out.simulatedOut ? formatWhen(out.retryAt) : 'when it has room again';
    return {
      lead: `${out.label} is out, so new conversations go to ${now.label}.`,
      follow: `They move back to ${out.label} ${back}.`,
    };
  }
  const next = order.find((a) => a.id !== now.id && (a.role === 'next' || a.role === 'backup'));
  return {
    lead: `New conversations go to ${now.label}.`,
    follow: next
      ? `If ${now.label} runs out, they switch to ${next.label} automatically.`
      : `There is no backup right now.`,
  };
};

/**
 * "Use the one that resets sooner first": weekly room left on an account is lost at its reset,
 * so the account resetting sooner should be first. Null when unknown or already right.
 */
export const resetHint = (
  model: ProtoModel
): { account: ProtoAccount; text: string; good: boolean } | null => {
  const [first, second] = model.order;
  if (!first || !second || model.sameLevel || first.role === 'resting') return null;
  const a = first.quota.weekResetAt;
  const b = second.quota.weekResetAt;
  if (!a || !b) return null;
  if (second.health === 'disabled' || second.health === 'cooling') return null;
  if (b < a - 30 * 60_000 && (second.quota.weekLeft ?? 0) > 0) {
    return {
      account: second,
      good: false,
      text: `${second.label} resets sooner (${formatWhen(b)}), so its ${second.quota.weekLeft}% left is lost unless it goes first.`,
    };
  }
  if (a < b) {
    return {
      account: first,
      good: true,
      text: `${first.label} resets sooner (${formatWhen(a)}), so using it first wastes nothing.`,
    };
  }
  return null;
};

/** "Mini and MacBook both use this order." (+ any Mac locked in Advanced.) */
export const describeMacs = (model: ProtoModel): { text: string; problem: boolean } => {
  const auto = model.clients.filter((client) => !client.target && !client.unknownRule);
  const locked = model.clients.filter((client) => client.target || client.unknownRule);
  const names = (list: ProtoClient[]) =>
    list.length <= 2
      ? list.map((c) => c.shortName).join(' and ')
      : `${list
          .slice(0, -1)
          .map((c) => c.shortName)
          .join(', ')} and ${list[list.length - 1].shortName}`;
  if (model.clients.length === 0) return { text: 'No Macs are set up yet.', problem: false };
  if (locked.length === 0) {
    return {
      text:
        auto.length === 1
          ? `${auto[0].shortName} uses this order.`
          : `${names(auto)} ${auto.length === 2 ? 'both' : 'all'} use this order.`,
      problem: false,
    };
  }
  const parts = locked.map((client) =>
    client.broken
      ? `${client.shortName} is locked to ${client.target?.label ?? 'a missing account'} and is stopped`
      : `${client.shortName} is locked to ${client.target?.label ?? 'another account'}`
  );
  const head = auto.length
    ? `${names(auto)} ${auto.length === 1 ? 'uses' : 'use'} this order. `
    : '';
  return {
    text: `${head}${parts.join('; ')} (see Advanced).`,
    problem: locked.some((c) => c.broken),
  };
};

/** Plain-language one-liner for a Mac's current choice. */
export const describeChoice = (client: ProtoClient, model: ProtoModel): string => {
  if (client.broken && client.brokenReason) return client.brokenReason;
  if (!client.target) {
    const { serving, order } = model;
    if (serving.length === 0)
      return `${client.shortName} has no Claude account with room right now.`;
    if (serving.length > 1) {
      return `${client.shortName} shares between ${serving.map((a) => a.label).join(' and ')}.`;
    }
    const backup = order.find((a) => a.role === 'next' || a.role === 'backup');
    return backup
      ? `${client.shortName} uses ${serving[0].label}; ${backup.label} is the backup.`
      : `${client.shortName} uses ${serving[0].label} (no backup available).`;
  }
  const others = model.accounts.filter((a) => a.id !== client.target?.id).map((a) => a.label);
  return `${client.shortName} only uses ${client.target.label}. If it runs out, ${client.shortName} stops${
    others.length ? ` — no fallback to ${others.join(' or ')}` : ''
  }.`;
};

export const STRICT_WARNING = (mac: string, account: string) =>
  `If ${account} runs out, ${mac} stops working instead of falling back.`;

export const AFFINITY_COPY = {
  on: 'A conversation stays on the account it started on, so long chats don’t hop around.',
  off: 'Every request picks again, so a long chat can move between accounts.',
};
