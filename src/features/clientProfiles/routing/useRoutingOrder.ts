import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient, authFilesApi } from '@/services/api';
import { useConfigStore, useNotificationStore } from '@/stores';
import { useClientProfilesStore } from '@/stores/useClientProfilesStore';
import { notifyAuthFilesChanged } from '@/features/authFiles/authFilesEvents';
import { useAccountQuota } from '@/features/quota/hooks/useAccountQuota';
import { providerLabel } from '@/features/dashboard/utils';
import type { AuthFileItem } from '@/types';
import { useClientRoutesData } from '../hooks/useClientRoutesData';
import {
  buildOrder,
  routingProviders,
  type FormatWhen,
  type JoinNames,
  type OrderModel,
} from './routingOrder';
import {
  makeGuardedUndo,
  reordersInFlight,
  runExclusiveReorder,
  runReorder,
  type ReorderEffects,
} from './reorderFlow';
export {
  QUOTA_MAX_AGE_MS,
  settleQuotaReads,
  takeStaleQuotaTargets,
  type QuotaFreshness,
} from '@/features/quota/quotaFreshness';

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

export interface RoutingSection {
  /** Provider key ("claude", "codex", …). */
  provider: string;
  /** Display name ("Claude", "Codex", …); proper nouns, not translated. */
  name: string;
  model: OrderModel;
  saving: boolean;
  simulateOut: string | null;
}

type PerProvider<T> = Record<string, T>;

/**
 * Account order per provider for the Routing page, with real priority writes (see
 * reorderFlow). One section per provider that has accounts, derived from the Accounts list.
 * Each provider has its own optimistic order, preview, saving state, one-at-a-time slot and
 * Undo; a reorder only ever plans and writes that provider's accounts. Writes keep going if the
 * page closes; only a connection change stops them.
 */
export function useRoutingOrder() {
  const { t, i18n } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const snapshot = useClientProfilesStore((state) => state.snapshot);
  const config = useConfigStore((state) => state.config);
  const data = useClientRoutesData();
  const { files, strategy, reloadFiles } = data;
  // Five-hour and weekly quota (Claude, Codex) from the shared cache, kept fresh.
  const { quotaFor } = useAccountQuota(files);

  const [overrides, setOverrides] = useState<PerProvider<Record<string, number> | null>>({});
  const [saving, setSaving] = useState<PerProvider<boolean>>({});
  const [simulateOut, setSimulateOut] = useState<PerProvider<string | null>>({});
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    // Reorders started by an earlier visit may still be writing: show them, and block new
    // ones for the same provider until they finish.
    reordersInFlight(apiClient.getConnectionRevision()).forEach(({ scope, done }) => {
      setSaving((prev) => ({ ...prev, [scope]: true }));
      void done.then(() => {
        if (mountedRef.current) setSaving((prev) => ({ ...prev, [scope]: false }));
      });
    });
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const sessionAffinity = config?.routingSessionAffinity === true;
  const buildFrom = useCallback(
    (
      provider: string,
      list: AuthFileItem[],
      extra: { overrides?: Record<string, number> | null; out?: string | null }
    ) =>
      strategy
        ? buildOrder({
            files: list,
            provider,
            strategy,
            sessionAffinity,
            inventory: snapshot?.accounts ?? [],
            quotaFor,
            priorityOverrides: extra.overrides ?? undefined,
            simulateOut: extra.out ?? null,
          })
        : null,
    [quotaFor, sessionAffinity, snapshot, strategy]
  );

  const sections: RoutingSection[] | null = useMemo(() => {
    if (!files || !strategy) return null;
    return routingProviders(files).flatMap((provider) => {
      const model = buildFrom(provider, files, {
        overrides: overrides[provider],
        out: simulateOut[provider],
      });
      return model
        ? [
            {
              provider,
              // routingProviders leaves out "unknown", so the fallback is never shown.
              name: providerLabel(provider, provider),
              model,
              saving: saving[provider] === true,
              simulateOut: simulateOut[provider] ?? null,
            },
          ]
        : [];
    });
  }, [buildFrom, files, overrides, saving, simulateOut, strategy]);

  const locale = i18n.language || 'en';
  const formatWhen = useMemo(() => buildWhenFormatter(t, locale), [t, locale]);
  const joinNames = useMemo(() => buildNameJoiner(locale), [locale]);

  const setPreview = useCallback((provider: string, accountId: string | null) => {
    setSimulateOut((prev) => ({ ...prev, [provider]: accountId }));
  }, []);

  const setOrderRef = useRef<(provider: string, ids: string[]) => Promise<void>>(async () => {});
  const setOrder = useCallback(
    async (provider: string, ids: string[]) => {
      const section = sections?.find((item) => item.provider === provider);
      if (!section) return;
      const { model } = section;
      const revision = apiClient.getConnectionRevision();
      const previous = model.order.map((account) => account.id);
      const fx: ReorderEffects = {
        connectionRevision: () => apiClient.getConnectionRevision(),
        patchAccount: (name, patch) => authFilesApi.patchFields(name, patch),
        isPageOpen: () => mountedRef.current,
        setOverrides: (value) => setOverrides((prev) => ({ ...prev, [provider]: value })),
        setSaving: (value) => setSaving((prev) => ({ ...prev, [provider]: value })),
        reloadFiles,
        notifyAccountsChanged: notifyAuthFilesChanged,
        notify: (message, type, action) => showNotification(message, type, undefined, action),
        t: (key, values) => t(key, values),
        firstLabelIn: (list) => buildFrom(provider, list, {})?.order[0]?.label ?? null,
      };
      // Undo is bound to this connection, page visit and provider, and re-plans from the
      // page's data at the time it is pressed (setOrderRef always holds the latest setOrder).
      const undo = makeGuardedUndo({
        connectionRevision: () => apiClient.getConnectionRevision(),
        isPageOpen: () => mountedRef.current,
        apply: () => setOrderRef.current(provider, previous),
        scope: provider,
      });
      setPreview(provider, null);
      // One reorder per connection and provider at a time, even across page visits.
      await runExclusiveReorder(
        revision,
        () => runReorder(model.order, ids, fx, () => void undo()),
        provider
      );
    },
    [buildFrom, reloadFiles, sections, setPreview, showNotification, t]
  );
  useEffect(() => {
    setOrderRef.current = setOrder;
  }, [setOrder]);

  return {
    ...data,
    sections,
    setOrder,
    setPreview,
    formatWhen,
    joinNames,
  };
}
