import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient, authFilesApi } from '@/services/api';
import { useConfigStore } from '@/stores';
import { useClientProfilesStore } from '@/stores/useClientProfilesStore';
import type { AuthFileItem } from '@/types';
import { AUTH_FILES_CHANGED_EVENT } from '@/features/authFiles/authFilesEvents';
import { readRoutingStrategy } from '../model';

/**
 * Everything the Client routes page reads: client profiles (store), the Accounts list for the
 * illustrative pool, and the saved config (strategy, client keys, WebSocket auth). The shared
 * routing band refreshes the config store itself after saving the strategy.
 * Account list results from a previous connection are dropped.
 */
export function useClientRoutesData() {
  const load = useClientProfilesStore((state) => state.load);
  const config = useConfigStore((state) => state.config);
  const fetchConfig = useConfigStore((state) => state.fetchConfig);
  /** null = not loaded or failed: the pool is then shown as unknown, never guessed. */
  const [files, setFiles] = useState<AuthFileItem[] | null>(null);
  const filesRequestRef = useRef(0);

  const loadFiles = useCallback(async () => {
    const request = (filesRequestRef.current += 1);
    const connection = apiClient.getConnectionRevision();
    try {
      const response = await authFilesApi.list();
      if (request !== filesRequestRef.current) return;
      if (connection !== apiClient.getConnectionRevision()) return;
      setFiles(response.files);
    } catch {
      if (request === filesRequestRef.current) setFiles(null);
    }
  }, []);

  const refresh = useCallback(
    async (force = true) => {
      await Promise.allSettled([load({ force }), loadFiles(), fetchConfig(force)]);
    },
    [fetchConfig, load, loadFiles]
  );

  // Priority/weight/enablement edits (including the shared routing band) change the pool.
  useEffect(() => {
    const handleChange = () => {
      void loadFiles();
      void load({ force: false });
    };
    window.addEventListener(AUTH_FILES_CHANGED_EVENT, handleChange);
    return () => window.removeEventListener(AUTH_FILES_CHANGED_EVENT, handleChange);
  }, [load, loadFiles]);

  useEffect(() => {
    void Promise.allSettled([load(), loadFiles(), fetchConfig()]);
    return () => {
      filesRequestRef.current += 1;
    };
  }, [fetchConfig, load, loadFiles]);

  return {
    files,
    strategy: readRoutingStrategy(config?.routingStrategy),
    apiKeys: config ? (config.apiKeys ?? []) : null,
    wsAuth: config ? config.wsAuth !== false : null,
    refresh,
    reloadFiles: loadFiles,
  };
}
