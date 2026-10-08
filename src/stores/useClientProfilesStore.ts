/**
 * Client profile state shared by the Client routes page and the Accounts page.
 *
 * - Capability first: an older backend (404) is Unsupported and no write is attempted.
 * - Every load and mutation is tied to the management connection that started it. Results that
 *   complete after a connection switch, logout or reset are dropped, never applied.
 * - Writes are never optimistic: the snapshot only changes after the server accepted the write,
 *   and is then re-read so target states and the ETag come from the server.
 */

import { create } from 'zustand';
import { apiClient } from '@/services/api/client';
import {
  classifyClientProfileError,
  clientProfilesApi,
  readClientProfileError,
  type ClientProfileFailureKind,
} from '@/services/api/clientProfiles';
import type {
  ClientProfileErrorInfo,
  ClientProfileMutation,
  ClientProfileSessionBehavior,
  ClientProfilesCapabilities,
  ClientProfilesSnapshot,
} from '@/types/clientProfiles';

export type ClientProfilesStatus = 'idle' | 'loading' | 'ready' | 'unsupported' | 'error';

export type ClientProfilesFailure = {
  kind: ClientProfileFailureKind | 'aborted' | 'unsupported';
  error: ClientProfileErrorInfo;
};

export type ClientProfilesOutcome<T> =
  | { ok: true; result: T; sessionBehavior: ClientProfileSessionBehavior }
  | ({ ok: false } & ClientProfilesFailure);

interface ClientProfilesState {
  status: ClientProfilesStatus;
  capabilities: ClientProfilesCapabilities | null;
  unsupportedReason: 'not_found' | 'incompatible_contract' | null;
  snapshot: ClientProfilesSnapshot | null;
  /** Last load failure. A background refresh failure keeps the previous snapshot visible. */
  loadFailure: ClientProfilesFailure | null;
  refreshing: boolean;
  /** Connection the current state belongs to. */
  connectionRevision: number | null;
  /** True while any write is in flight, so other write controls can wait. */
  mutating: boolean;

  load: (options?: { force?: boolean }) => Promise<void>;
  /** Run one profile/key write with the current ETag, then re-read the list. */
  mutate: <T>(
    write: (revision: string) => Promise<ClientProfileMutation<T>>
  ) => Promise<ClientProfilesOutcome<T>>;
  enroll: (credentialRef: string) => Promise<ClientProfilesOutcome<string>>;
  reset: () => void;
}

const EMPTY_ERROR: ClientProfileErrorInfo = { status: null, code: null, field: null };

let generation = 0;
/** Latest load wins: an older list response never overwrites a newer one. */
let loadSequence = 0;
let inFlightLoad: { generation: number; promise: Promise<void> } | null = null;

const failureFrom = (error: unknown): ClientProfilesFailure => {
  const info = readClientProfileError(error);
  return { kind: classifyClientProfileError(info), error: info };
};

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

const initialState = {
  status: 'idle' as ClientProfilesStatus,
  capabilities: null,
  unsupportedReason: null,
  snapshot: null,
  loadFailure: null,
  refreshing: false,
  connectionRevision: null,
  mutating: false,
};

export const useClientProfilesStore = create<ClientProfilesState>((set, get) => {
  /** A result may be applied only if nothing reset the store and the connection is unchanged. */
  const isCurrent = (startedGeneration: number, connection: number) =>
    startedGeneration === generation && connection === apiClient.getConnectionRevision();

  const loadOnce = async (force: boolean): Promise<void> => {
    const sequence = (loadSequence += 1);
    const connection = apiClient.getConnectionRevision();
    if (get().connectionRevision !== null && get().connectionRevision !== connection) {
      // State from another connection must never be shown, even briefly.
      generation += 1;
      set({ ...initialState });
    }
    const started = generation;
    const state = get();
    const hasSnapshot = state.snapshot !== null;
    set({
      status: hasSnapshot ? state.status : 'loading',
      refreshing: hasSnapshot,
      connectionRevision: connection,
    });

    try {
      let capabilities = state.capabilities;
      if (!capabilities || force) {
        const support = await clientProfilesApi.probe();
        if (!isCurrent(started, connection)) return;
        if (!support.supported) {
          set({
            ...initialState,
            status: 'unsupported',
            unsupportedReason: support.reason,
            connectionRevision: connection,
          });
          return;
        }
        capabilities = support.capabilities;
      }
      const snapshot = await clientProfilesApi.list();
      if (!isCurrent(started, connection) || sequence !== loadSequence) return;
      set({
        status: 'ready',
        capabilities,
        unsupportedReason: null,
        snapshot,
        loadFailure: null,
        refreshing: false,
      });
    } catch (error) {
      if (!isCurrent(started, connection) || sequence !== loadSequence) return;
      const failure = failureFrom(error);
      if (failure.kind === 'not_found' && !get().snapshot) {
        set({
          ...initialState,
          status: 'unsupported',
          unsupportedReason: 'not_found',
          connectionRevision: connection,
        });
        return;
      }
      set((current) => ({
        status: current.snapshot ? current.status : 'error',
        loadFailure: failure,
        refreshing: false,
      }));
    }
  };

  const startLoad = (force: boolean): Promise<void> => {
    const entry = { generation, promise: Promise.resolve() };
    entry.promise = loadOnce(force).finally(() => {
      if (inFlightLoad === entry) inFlightLoad = null;
    });
    inFlightLoad = entry;
    return entry.promise;
  };

  return {
    ...initialState,

    load: (options) => {
      const force = options?.force === true;
      if (inFlightLoad && inFlightLoad.generation === generation && !force) {
        return inFlightLoad.promise;
      }
      return startLoad(force);
    },

    mutate: async (write) => {
      const { status, snapshot, connectionRevision } = get();
      const connection = apiClient.getConnectionRevision();
      if (status !== 'ready' || !snapshot) {
        return { ok: false, kind: 'unsupported', error: EMPTY_ERROR };
      }
      if (connectionRevision !== connection) {
        return { ok: false, kind: 'aborted', error: EMPTY_ERROR };
      }
      const started = generation;
      set({ mutating: true });
      try {
        const response = await write(snapshot.revision);
        if (!isCurrent(started, connection)) {
          return { ok: false, kind: 'aborted', error: EMPTY_ERROR };
        }
        // Chain later writes on the new ETag even before the re-read lands.
        set((current) =>
          current.snapshot && response.revision
            ? { snapshot: { ...current.snapshot, revision: response.revision } }
            : {}
        );
        // Never reuse a read that started before the write.
        await startLoad(false);
        return { ok: true, result: response.result, sessionBehavior: response.sessionBehavior };
      } catch (error) {
        if (!isCurrent(started, connection) || isAbort(error)) {
          return { ok: false, kind: 'aborted', error: EMPTY_ERROR };
        }
        return { ok: false, ...failureFrom(error) };
      } finally {
        if (started === generation) set({ mutating: false });
      }
    },

    enroll: async (credentialRef) => {
      const { status, connectionRevision } = get();
      const connection = apiClient.getConnectionRevision();
      if (status !== 'ready') return { ok: false, kind: 'unsupported', error: EMPTY_ERROR };
      if (connectionRevision !== connection) {
        return { ok: false, kind: 'aborted', error: EMPTY_ERROR };
      }
      const started = generation;
      set({ mutating: true });
      try {
        const result = await clientProfilesApi.enroll(credentialRef);
        if (!isCurrent(started, connection)) {
          return { ok: false, kind: 'aborted', error: EMPTY_ERROR };
        }
        await startLoad(false);
        return { ok: true, result: result.accountRef, sessionBehavior: 'unknown' };
      } catch (error) {
        if (!isCurrent(started, connection)) {
          return { ok: false, kind: 'aborted', error: EMPTY_ERROR };
        }
        return { ok: false, ...failureFrom(error) };
      } finally {
        if (started === generation) set({ mutating: false });
      }
    },

    reset: () => {
      generation += 1;
      inFlightLoad = null;
      set({ ...initialState });
    },
  };
});
