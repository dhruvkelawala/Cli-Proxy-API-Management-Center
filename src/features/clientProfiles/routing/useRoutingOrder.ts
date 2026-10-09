import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient, authFilesApi } from '@/services/api';
import { useConfigStore, useNotificationStore, useQuotaStore } from '@/stores';
import { useClientProfilesStore } from '@/stores/useClientProfilesStore';
import { notifyAuthFilesChanged } from '@/features/authFiles/authFilesEvents';
import { accountProviderKey, isAccountDisabled } from '@/features/authFiles/accountPresentation';
import { useQuotaBatchLoader } from '@/features/quota/hooks/useQuotaBatchLoader';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import type { AuthFileItem } from '@/types';
import { useClientRoutesData } from '../hooks/useClientRoutesData';
import {
  buildOrder,
  summarizeClaudeQuota,
  type FormatWhen,
  type JoinNames,
  type OrderModel,
} from './routingOrder';
import { runReorder, type ReorderEffects } from './reorderFlow';

const PROVIDER = 'claude';
/** Quota older than this is re-read when the page opens. */
export const QUOTA_MAX_AGE_MS = 5 * 60_000;
/**
 * When this page last asked for each account's quota (per connection). The Quota page's cache
 * has no timestamps, so anything this page has not loaded recently counts as stale.
 */
const quotaRequestedAt = new Map<string, number>();

/** Accounts whose cached quota should be (re)loaded now. Marks the ones it returns. */
export const takeStaleQuotaTargets = (
  files: readonly AuthFileItem[],
  connection: number,
  now: number,
  requestedAt: Map<string, number> = quotaRequestedAt
): AuthFileItem[] =>
  files.filter((file) => {
    if (isAccountDisabled(file)) return false;
    const marker = `${connection}:${getQuotaCacheKey(file)}`;
    const last = requestedAt.get(marker);
    if (last !== undefined && now - last < QUOTA_MAX_AGE_MS) return false;
    requestedAt.set(marker, now);
    return true;
  });

/** "today at 9:06 PM", "tomorrow at 9:00 AM", "Sat 10:00 AM" in the UI language. */
export const buildWhenFormatter = (
  t: (key: string, values?: Record<string, string>) => string,
  locale: string,
  now: () => Date = () => new Date()
): FormatWhen => {
  return (ms) => {
    const date = new Date(ms);
    const today = now();
    const startOf = (value: Date) =>
      new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
    const days = Math.round((startOf(date) - startOf(today)) / 86_400_000);
    const time = date.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
    if (days === 0) return t('routing.when.today', { time });
    if (days === 1) return t('routing.when.tomorrow', { time });
    return t('routing.when.other', {
      day: date.toLocaleDateString(locale, { weekday: 'short' }),
      time,
    });
  };
};

type ListFormatCtor = new (
  locale: string,
  options: { style: 'long'; type: 'conjunction' }
) => { format: (names: string[]) => string };

/** "Mini and MacBook" / "Mini、MacBook" / "Mini и MacBook" via Intl.ListFormat. */
export const buildNameJoiner = (locale: string): JoinNames => {
  const ListFormat = (Intl as unknown as { ListFormat?: ListFormatCtor }).ListFormat;
  try {
    if (!ListFormat) throw new Error('unsupported');
    const list = new ListFormat(locale, { style: 'long', type: 'conjunction' });
    return (names) => list.format(names);
  } catch {
    return (names) => names.join(', ');
  }
};

/**
 * Claude account order for the Routing page, with real priority writes (see reorderFlow).
 * Writes keep going if the page closes; only a connection change stops them.
 */
export function useRoutingOrder() {
  const { t, i18n } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const snapshot = useClientProfilesStore((state) => state.snapshot);
  const config = useConfigStore((state) => state.config);
  const data = useClientRoutesData();
  const { files, strategy, reloadFiles } = data;
  const claudeQuota = useQuotaStore((state) => state.claudeQuota);
  const { loadQuota } = useQuotaBatchLoader();

  const [overrides, setOverrides] = useState<Record<string, number> | null>(null);
  const [saving, setSaving] = useState(false);
  const [simulateOut, setSimulateOut] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const savingRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const providerFiles = useMemo(
    () => (files ?? []).filter((file) => accountProviderKey(file) === PROVIDER),
    [files]
  );

  // Weekly room left comes from the Quota page's cache and loader. On open, anything this page
  // has not read in the last five minutes is re-read once.
  useEffect(() => {
    const stale = takeStaleQuotaTargets(
      providerFiles,
      apiClient.getConnectionRevision(),
      Date.now()
    );
    if (stale.length) void loadQuota(stale.map((file) => ({ file, type: PROVIDER })));
  }, [providerFiles, loadQuota]);

  const sessionAffinity = config?.routingSessionAffinity === true;
  const buildFrom = useCallback(
    (
      list: AuthFileItem[],
      extra: { overrides?: Record<string, number> | null; out?: string | null }
    ) =>
      strategy
        ? buildOrder({
            files: list,
            provider: PROVIDER,
            strategy,
            sessionAffinity,
            inventory: snapshot?.accounts ?? [],
            quotaFor: (file: AuthFileItem) =>
              summarizeClaudeQuota(claudeQuota[getQuotaCacheKey(file)]),
            priorityOverrides: extra.overrides ?? undefined,
            simulateOut: extra.out ?? null,
          })
        : null,
    [claudeQuota, sessionAffinity, snapshot, strategy]
  );
  const model: OrderModel | null = useMemo(
    () => (files ? buildFrom(files, { overrides, out: simulateOut }) : null),
    [buildFrom, files, overrides, simulateOut]
  );

  const locale = i18n.language || 'en';
  const formatWhen = useMemo(() => buildWhenFormatter(t, locale), [t, locale]);
  const joinNames = useMemo(() => buildNameJoiner(locale), [locale]);

  const setOrderRef = useRef<(ids: string[]) => Promise<void>>(async () => {});
  const setOrder = useCallback(
    async (ids: string[]) => {
      if (!model || savingRef.current) return;
      const previous = model.order.map((account) => account.id);
      const fx: ReorderEffects = {
        connectionRevision: () => apiClient.getConnectionRevision(),
        patchAccount: (name, patch) => authFilesApi.patchFields(name, patch),
        isPageOpen: () => mountedRef.current,
        setOverrides,
        setSaving: (next) => {
          savingRef.current = next;
          setSaving(next);
        },
        reloadFiles,
        notifyAccountsChanged: notifyAuthFilesChanged,
        notify: (message, type, action) => showNotification(message, type, undefined, action),
        t: (key, values) => t(key, values),
        firstLabelIn: (list) => buildFrom(list, {})?.order[0]?.label ?? null,
      };
      setSimulateOut(null);
      savingRef.current = true;
      try {
        await runReorder(model.order, ids, fx, () => void setOrderRef.current(previous));
      } finally {
        savingRef.current = false;
      }
    },
    [buildFrom, model, reloadFiles, showNotification, t]
  );
  useEffect(() => {
    setOrderRef.current = setOrder;
  }, [setOrder]);

  return {
    ...data,
    model,
    saving,
    setOrder,
    simulateOut,
    setSimulateOut,
    formatWhen,
    joinNames,
  };
}
