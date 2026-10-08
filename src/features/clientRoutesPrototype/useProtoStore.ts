/**
 * PROTOTYPE (throwaway). In-memory store shared by all variants and the state readout.
 * No persistence and no network: "Save" is simulated with a short delay so the owner can see
 * pending/saved/failed states. Hard-coded English strings are intentional.
 */
import { create } from 'zustand';
import {
  applyGroup,
  groupLabel,
  initialState,
  policyLabel,
  providerLabel,
  type Availability,
  type ProtoPolicy,
  type ProtoRouting,
  type ProtoState,
  type ProviderId,
  type SaveGroup,
} from './prototypeModel';

interface ProtoActions {
  setPolicy: (profileId: string, provider: ProviderId, policy: ProtoPolicy) => void;
  setRouting: (patch: Partial<ProtoRouting>) => void;
  setAccountTuning: (accountId: string, patch: { priority?: number; weight?: number }) => void;
  setEnabled: (accountId: string, enabled: boolean) => void;
  setAvailability: (accountId: string, availability: Availability) => void;
  save: (group: SaveGroup) => void;
  saveMany: (groups: SaveGroup[]) => void;
  discard: (group: SaveGroup) => void;
  setFailNextSave: (fail: boolean) => void;
  reset: () => void;
}

const SAVE_DELAY_MS = 550;
const pushLog = (log: string[], line: string) => [line, ...log].slice(0, 12);

export const useProtoStore = create<ProtoState & ProtoActions>()((set, get) => ({
  ...initialState(),

  setPolicy: (profileId, provider, policy) =>
    set((s) => {
      const draft = structuredClone(s.draft);
      const profile = draft.profiles.find((p) => p.id === profileId);
      if (!profile) return s;
      profile.policies[provider] = policy;
      return {
        draft,
        error: null,
        log: pushLog(
          s.log,
          `Draft: ${profile.label} · ${providerLabel(provider)} → ${policyLabel(draft, policy)}`
        ),
      };
    }),

  setRouting: (patch) =>
    set((s) => ({
      draft: { ...s.draft, routing: { ...s.draft.routing, ...patch } },
      error: null,
      log: pushLog(s.log, `Draft: shared routing ${JSON.stringify(patch)}`),
    })),

  setAccountTuning: (accountId, patch) =>
    set((s) => ({
      draft: {
        ...s.draft,
        accounts: s.draft.accounts.map((a) => (a.id === accountId ? { ...a, ...patch } : a)),
      },
      error: null,
      log: pushLog(s.log, `Draft: ${accountId} ${JSON.stringify(patch)}`),
    })),

  // Enable/disable is an existing, immediately-saved account action.
  setEnabled: (accountId, enabled) =>
    set((s) => {
      const patch = (snap: ProtoState['draft']) => ({
        ...snap,
        accounts: snap.accounts.map((a) => (a.id === accountId ? { ...a, enabled } : a)),
      });
      return {
        draft: patch(s.draft),
        saved: patch(s.saved),
        log: pushLog(s.log, `Saved: ${accountId} ${enabled ? 'enabled' : 'disabled'}`),
      };
    }),

  // Simulation only: the real UI reads availability, it cannot set it.
  setAvailability: (accountId, availability) =>
    set((s) => {
      const patch = (snap: ProtoState['draft']) => ({
        ...snap,
        accounts: snap.accounts.map((a) => (a.id === accountId ? { ...a, availability } : a)),
      });
      return {
        draft: patch(s.draft),
        saved: patch(s.saved),
        log: pushLog(s.log, `Simulated: ${accountId} availability → ${availability}`),
      };
    }),

  save: (group) => get().saveMany([group]),

  saveMany: (groups) => {
    if (get().saving || groups.length === 0) return;
    set({ saving: groups[0], error: null });
    window.setTimeout(() => {
      const s = get();
      if (s.failNextSave) {
        set({
          saving: null,
          failNextSave: false,
          error: {
            group: groups[0],
            message: `Gateway rejected the save (simulated). Your draft is kept; nothing changed on the proxy.`,
          },
          log: pushLog(
            s.log,
            `Save FAILED: ${groups.map((g) => groupLabel(s.draft, g)).join(', ')}`
          ),
        });
        return;
      }
      const saved = groups.reduce((acc, g) => applyGroup(s.draft, acc, g), s.saved);
      set({
        saved,
        saving: null,
        log: pushLog(
          s.log,
          `Saved on proxy: ${groups.map((g) => groupLabel(s.draft, g)).join(', ')}`
        ),
      });
    }, SAVE_DELAY_MS);
  },

  discard: (group) =>
    set((s) => ({
      draft: applyGroup(s.saved, s.draft, group),
      error: null,
      log: pushLog(s.log, `Discarded: ${groupLabel(s.draft, group)}`),
    })),

  setFailNextSave: (failNextSave) => set({ failNextSave }),

  reset: () => set(initialState()),
}));
