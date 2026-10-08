import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient, authFilesApi } from '@/services/api';
import { applyConfigPatch } from '@/services/api/configPatch';
import { notifyAuthFilesChanged } from '@/features/authFiles/authFilesEvents';
import { deriveAccountTitle } from '@/features/authFiles/identity';
import { useAuthStore, useConfigStore } from '@/stores';
import type { AuthFileItem } from '@/types';
import {
  IDLE_SAVE,
  applyRoutingEdits,
  applyTuningPatchToFile,
  buildAccountTuningPatch,
  effectiveRoutingEdits,
  hasAccountTuningErrors,
  isAccountTuningDirty,
  isTunableAccount,
  readRoutingSettings,
  retainFailedTuningEdits,
  saveAccountTunings,
  saveGlobalRouting,
  summarizeAccountSave,
  validateAccountTuning,
  validateAffinityTtl,
  type AccountSaveOutcome,
  type AccountTuningEdits,
  type AccountTuningErrors,
  type RoutingSaveDeps,
  type RoutingSettingsEdits,
  type RoutingSettingsValues,
  type SaveStatus,
} from './routingSettingsState';

export interface AccountSaveState {
  phase: 'idle' | 'saving' | 'done';
  outcome: AccountSaveOutcome | null;
  savedCount: number;
  /** Failed accounts keep their drafts; the message is the backend error when it gave one. */
  failures: { name: string; label?: string; message: string }[];
}

const IDLE_ACCOUNT_SAVE: AccountSaveState = {
  phase: 'idle',
  outcome: null,
  savedCount: 0,
  failures: [],
};

/**
 * One editor for the shared load-balancing settings.
 *
 * The saved strategy and session affinity are read from the config store, the single cached
 * copy of /config that the Config page also refreshes. This hook only keeps touched-field
 * drafts on top of it and writes them through the revision-aware config patch, then
 * invalidates and refetches the store. Account priority and weight live on the auth files
 * and are saved with separate auth-file field patches: the two never share a success claim.
 */
export function useRoutingSettings() {
  const { t } = useTranslation();
  const config = useConfigStore((state) => state.config);
  const connectionStatus = useAuthStore((state) => state.connectionStatus);

  const [edits, setEdits] = useState<RoutingSettingsEdits>({});
  const [globalSave, setGlobalSave] = useState<SaveStatus>(IDLE_SAVE);
  const [files, setFiles] = useState<AuthFileItem[] | null>(null);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [filesLoading, setFilesLoading] = useState(false);
  const [tuningEdits, setTuningEdits] = useState<Record<string, AccountTuningEdits>>({});
  const [accountSave, setAccountSave] = useState<AccountSaveState>(IDLE_ACCOUNT_SAVE);

  const mountedRef = useRef(true);
  /** Bumped on reset and unmount. A completion from an older generation is ignored. */
  const generationRef = useRef(0);
  const sessionRevisionRef = useRef(apiClient.getConnectionRevision());
  const savingRef = useRef({ global: false, accounts: false });

  const beginOperation = useCallback((): RoutingSaveDeps => {
    const generation = generationRef.current;
    return {
      connectionRevision: () => apiClient.getConnectionRevision(),
      applyConfigPlan: applyConfigPatch,
      patchAccount: (name, patch) => authFilesApi.patchFields(name, patch),
      isCurrent: () => mountedRef.current && generation === generationRef.current,
    };
  }, []);

  const loadAccounts = useCallback(async () => {
    const deps = beginOperation();
    const revision = deps.connectionRevision();
    const isCurrent = () => deps.isCurrent?.() === true && revision === deps.connectionRevision();
    setFilesLoading(true);
    setFilesError(null);
    try {
      const response = await authFilesApi.list();
      if (!isCurrent()) return;
      setFiles(response.files.filter(isTunableAccount));
    } catch (error: unknown) {
      if (!isCurrent()) return;
      setFilesError(error instanceof Error ? error.message : '');
    } finally {
      if (isCurrent()) setFilesLoading(false);
    }
  }, [beginOperation]);

  const loadConfig = useCallback(async () => {
    try {
      await useConfigStore.getState().fetchConfig();
    } catch {
      // The band shows its loading state until the store has a config.
    }
  }, []);

  // Mount, and again whenever the session changes: drop every draft and status so nothing
  // from the previous connection can be saved against, or shown for, the new one.
  useEffect(() => {
    mountedRef.current = true;
    const revision = apiClient.getConnectionRevision();
    if (revision !== sessionRevisionRef.current) {
      sessionRevisionRef.current = revision;
      generationRef.current += 1;
      savingRef.current = { global: false, accounts: false };
      setEdits({});
      setGlobalSave(IDLE_SAVE);
      setFiles(null);
      setFilesError(null);
      setTuningEdits({});
      setAccountSave(IDLE_ACCOUNT_SAVE);
    }
    void loadConfig();
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
    };
  }, [connectionStatus, loadConfig]);

  const saved = useMemo(() => readRoutingSettings(config), [config]);
  const pendingEdits = useMemo(
    () => (saved ? effectiveRoutingEdits(saved, edits) : {}),
    [saved, edits]
  );
  const values: RoutingSettingsValues | null = saved ? applyRoutingEdits(saved, edits) : null;
  const dirty = Object.keys(pendingEdits).length > 0;
  const ttlError = validateAffinityTtl(values?.sessionAffinityTtl ?? '');

  const setEdit = useCallback((next: RoutingSettingsEdits) => {
    setEdits((prev) => ({ ...prev, ...next }));
    setGlobalSave(IDLE_SAVE);
  }, []);

  const discardGlobal = useCallback(() => {
    setEdits({});
    setGlobalSave(IDLE_SAVE);
  }, []);

  const saveGlobal = useCallback(async () => {
    if (!saved || !dirty || ttlError || savingRef.current.global) return;
    savingRef.current.global = true;
    const deps = beginOperation();
    const generation = generationRef.current;
    setGlobalSave({ phase: 'saving' });
    const result = await saveGlobalRouting(deps, saved, edits);
    if (generation === generationRef.current) savingRef.current.global = false;
    if (result.kind === 'stale') return;

    // The saved baseline always comes from the server, including after a failed write: a
    // multi-field patch can be partly applied, and the retained drafts are re-diffed against it.
    useConfigStore.getState().clearCache('routing/strategy');
    let refreshed = true;
    try {
      await useConfigStore.getState().fetchConfig(true);
    } catch {
      refreshed = false;
    }
    if (!deps.isCurrent?.()) return;

    if (result.kind === 'failed') {
      setGlobalSave({ phase: 'failed', message: result.message });
    } else if (!refreshed) {
      setGlobalSave({
        phase: 'failed',
        message: t('config_management.routing_settings.reload_failed'),
      });
    } else {
      setEdits({});
      setGlobalSave({ phase: 'saved' });
    }
  }, [beginOperation, dirty, edits, saved, t, ttlError]);

  const setTuning = useCallback((name: string, next: AccountTuningEdits) => {
    setTuningEdits((prev) => ({ ...prev, [name]: { ...prev[name], ...next } }));
  }, []);

  const tuningErrors = useMemo(() => {
    const result: Record<string, AccountTuningErrors> = {};
    Object.entries(tuningEdits).forEach(([name, accountEdits]) => {
      const errors = validateAccountTuning(accountEdits);
      if (hasAccountTuningErrors(errors)) result[name] = errors;
    });
    return result;
  }, [tuningEdits]);

  const dirtyAccounts = useMemo(
    () =>
      (files ?? [])
        .filter((file) => isAccountTuningDirty(file, tuningEdits[file.name]))
        .map((file) => file.name),
    [files, tuningEdits]
  );
  const hasTuningErrors = Object.keys(tuningErrors).length > 0;

  const discardAccounts = useCallback(() => {
    setTuningEdits({});
    setAccountSave(IDLE_ACCOUNT_SAVE);
  }, []);

  const saveAccounts = useCallback(async () => {
    if (!files || dirtyAccounts.length === 0 || hasTuningErrors || savingRef.current.accounts) {
      return;
    }
    savingRef.current.accounts = true;
    const deps = beginOperation();
    const generation = generationRef.current;
    setAccountSave({ ...IDLE_ACCOUNT_SAVE, phase: 'saving' });
    const entries = dirtyAccounts.flatMap((name) => {
      const file = files.find((candidate) => candidate.name === name);
      return file ? [{ name, file, edits: tuningEdits[name] ?? {} }] : [];
    });
    const result = await saveAccountTunings(deps, entries);
    if (generation === generationRef.current) savingRef.current.accounts = false;
    if (result.kind === 'stale') return;

    const patches = new Map(
      entries
        .filter((entry) => result.saved.includes(entry.name))
        .map((entry) => [entry.name, buildAccountTuningPatch(entry.file, entry.edits)] as const)
    );
    setFiles((prev) =>
      prev
        ? prev.map((file) => {
            const patch = patches.get(file.name);
            return patch ? applyTuningPatchToFile(file, patch) : file;
          })
        : prev
    );
    setTuningEdits((prev) => retainFailedTuningEdits(prev, result));
    setAccountSave({
      phase: 'done',
      outcome: summarizeAccountSave(result),
      savedCount: result.saved.length,
      failures: result.failed.map((failure) => {
        const file = files.find((candidate) => candidate.name === failure.name);
        return {
          ...failure,
          label: file ? deriveAccountTitle(file).title || file.name : undefined,
        };
      }),
    });
    if (result.saved.length > 0) {
      notifyAuthFilesChanged();
      void loadAccounts();
    }
  }, [beginOperation, dirtyAccounts, files, hasTuningErrors, loadAccounts, tuningEdits]);

  return {
    loaded: values !== null,
    values,
    saved,
    dirty,
    ttlError,
    globalSave,
    setEdit,
    discardGlobal,
    saveGlobal,
    accounts: {
      files,
      loading: filesLoading,
      error: filesError,
      edits: tuningEdits,
      errors: tuningErrors,
      dirtyNames: dirtyAccounts,
      hasErrors: hasTuningErrors,
      save: accountSave,
      load: loadAccounts,
      setTuning,
      discard: discardAccounts,
      saveAll: saveAccounts,
    },
  };
}
