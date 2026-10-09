import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient, authFilesApi } from '@/services/api';
import { applyConfigPatch } from '@/services/api/configPatch';
import { useConfigStore, useNotificationStore, useQuotaStore } from '@/stores';
import { useClientProfilesStore } from '@/stores/useClientProfilesStore';
import { notifyAuthFilesChanged } from '@/features/authFiles/authFilesEvents';
import { accountProviderKey, isAccountDisabled } from '@/features/authFiles/accountPresentation';
import {
  saveAccountTunings,
  type RoutingSaveDeps,
} from '@/features/config/routing/routingSettingsState';
import { useQuotaBatchLoader } from '@/features/quota/hooks/useQuotaBatchLoader';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import type { AuthFileItem } from '@/types';
import { useClientRoutesData } from '../hooks/useClientRoutesData';
import {
  buildOrder,
  planOrderPriorities,
  priorityChanges,
  summarizeClaudeQuota,
  type FormatWhen,
  type JoinNames,
  type OrderModel,
  type PriorityChange,
} from './routingOrder';

const PROVIDER = 'claude';

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

export type OrderSaveResult =
  | { kind: 'stale' }
  | { kind: 'done'; saved: string[]; failed: { name: string; message: string } | null };

/**
 * Writes reorder priority changes in the given order through the shared routing save helper
 * (one `PATCH /credentials/fields` per account) and stops at the first failure.
 */
export const saveOrderChanges = async (
  deps: RoutingSaveDeps,
  changes: ReadonlyArray<Pick<PriorityChange, 'name' | 'from' | 'to'>>
): Promise<OrderSaveResult> => {
  const saved: string[] = [];
  for (const change of changes) {
    const result = await saveAccountTunings(deps, [
      {
        name: change.name,
        file: { priority: change.from },
        edits: { priority: String(change.to) },
      },
    ]);
    if (result.kind === 'stale') return { kind: 'stale' };
    const [failure] = result.failed;
    if (failure) return { kind: 'done', saved, failed: failure };
    saved.push(...result.saved);
  }
  return { kind: 'done', saved, failed: null };
};

/**
 * Claude account order for the Routing page, with real priority writes.
 *
 * Reordering is optimistic: the new priorities show at once, then each changed account is
 * patched (`PATCH /credentials/fields`, via the shared routing save helper the Priorities &
 * weights sheet uses). Any failure rolls the order back, re-reads the list and raises an error
 * toast. Results from another connection, or after unmount, are dropped.
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

  // Weekly room left comes from the Quota page's cache and loader; fetch what's missing once.
  const requested = useRef(new Set<string>());
  useEffect(() => {
    const connection = apiClient.getConnectionRevision();
    const missing = providerFiles.filter((file) => {
      if (isAccountDisabled(file)) return false;
      const key = getQuotaCacheKey(file);
      const marker = `${connection}:${key}`;
      if (claudeQuota[key] || requested.current.has(marker)) return false;
      requested.current.add(marker);
      return true;
    });
    if (missing.length) void loadQuota(missing.map((file) => ({ file, type: PROVIDER })));
  }, [providerFiles, claudeQuota, loadQuota]);

  const sessionAffinity = config?.routingSessionAffinity === true;
  const model: OrderModel | null = useMemo(() => {
    if (!files || !strategy) return null;
    return buildOrder({
      files,
      provider: PROVIDER,
      strategy,
      sessionAffinity,
      inventory: snapshot?.accounts ?? [],
      quotaFor: (file: AuthFileItem) => summarizeClaudeQuota(claudeQuota[getQuotaCacheKey(file)]),
      priorityOverrides: overrides ?? undefined,
      simulateOut,
    });
  }, [claudeQuota, files, overrides, sessionAffinity, simulateOut, snapshot, strategy]);

  const locale = i18n.language || 'en';
  const formatWhen = useMemo(() => buildWhenFormatter(t, locale), [t, locale]);
  const joinNames = useMemo(() => buildNameJoiner(locale), [locale]);

  const setOrder = useCallback(
    async (ids: string[]) => {
      if (!model || savingRef.current) return;
      const plan = planOrderPriorities(model.order, ids);
      const changes = priorityChanges(model.order, plan);
      if (changes.length === 0) return;
      const first = model.order.find((account) => account.id === ids[0]);

      savingRef.current = true;
      setSaving(true);
      setSimulateOut(null);
      setOverrides(plan);

      const revision = apiClient.getConnectionRevision();
      const deps: RoutingSaveDeps = {
        connectionRevision: () => apiClient.getConnectionRevision(),
        applyConfigPlan: applyConfigPatch,
        patchAccount: (name, patch) => authFilesApi.patchFields(name, patch),
        isCurrent: () => mountedRef.current && revision === apiClient.getConnectionRevision(),
      };
      // One account at a time, demotions first, stopping at the first failure so a broken
      // write never goes on to promote another account.
      const result = await saveOrderChanges(deps, changes);
      savingRef.current = false;
      if (result.kind === 'stale') {
        setOverrides(null);
        setSaving(false);
        return;
      }
      const failure = result.failed;
      if (failure) {
        // Roll back to what the gateway last reported, then re-read: a partial write is real.
        setOverrides(null);
        showNotification(
          failure.message
            ? t('routing.save_failed_detail', { message: failure.message })
            : t('routing.save_failed'),
          'error'
        );
        if (result.saved.length > 0) notifyAuthFilesChanged();
        await reloadFiles();
        if (mountedRef.current) setSaving(false);
        return;
      }
      notifyAuthFilesChanged();
      await reloadFiles();
      if (!mountedRef.current) return;
      setOverrides(null);
      setSaving(false);
      if (first) showNotification(t('routing.saved', { account: first.label }), 'success');
    },
    [model, reloadFiles, showNotification, t]
  );

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
