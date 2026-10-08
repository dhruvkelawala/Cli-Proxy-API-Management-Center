import type { AuthFileFieldsPatch } from '@/services/api/authFiles';
import { hasConfigPatchChanges, type ConfigPatchPlan } from '@/services/api/configPatch';
import {
  accountProviderKey,
  isAccountDisabled,
  resolveAccountAvailability,
} from '@/features/authFiles/accountPresentation';
import { deriveAccountTitle } from '@/features/authFiles/identity';
import { parsePriorityValue } from '@/features/authFiles/constants';
import type { AuthFileItem, Config } from '@/types';
import type { RoutingStrategy } from '@/types/visualConfig';
import {
  parseCredentialWeightText,
  readCredentialWeight,
  validateCredentialWeightText,
  type CredentialWeightError,
} from '@/utils/credentialWeight';
import { parseRoutingStrategy } from '@/hooks/useVisualConfig';
import type { RoutingAccountInput, RoutingAvailability } from './routingPresentation';

/**
 * Pure state and save orchestration for the shared load-balancing editor.
 *
 * Two independent writes exist and are never combined into one claim of success:
 * 1. Global strategy and session affinity: a revision-aware config field patch.
 * 2. Per-account priority and weight: one auth-file field patch per account.
 *
 * Drafts are touched-field overlays on the saved baseline. An untouched field is never
 * serialized, so a saved fill-first strategy stays fill-first and unrelated metadata is kept.
 */

export const ROUTING_PATHS = {
  strategy: ['routing', 'strategy'],
  sessionAffinity: ['routing', 'session-affinity'],
  sessionAffinityTtl: ['routing', 'session-affinity-ttl'],
} as const;

export const ROUTING_STRATEGIES: readonly RoutingStrategy[] = [
  'round-robin',
  'weighted-round-robin',
  'fill-first',
];

// ---------------------------------------------------------------------------
// Global routing settings (strategy + session affinity)
// ---------------------------------------------------------------------------

export interface RoutingSettingsValues {
  strategy: RoutingStrategy;
  sessionAffinity: boolean;
  sessionAffinityTtl: string;
}

export type RoutingSettingsEdits = Partial<RoutingSettingsValues>;

/** Saved settings as reported by the config store. Null until the config has loaded. */
export const readRoutingSettings = (config: Config | null): RoutingSettingsValues | null => {
  if (!config) return null;
  return {
    strategy: parseRoutingStrategy(config.routingStrategy),
    sessionAffinity: config.routingSessionAffinity === true,
    sessionAffinityTtl: config.routingSessionAffinityTtl ?? '',
  };
};

const normalizeTtl = (value: string): string => value.trim();

/**
 * What Go's time.ParseDuration accepts: optional sign, then one or more decimal numbers (a
 * leading-dot fraction like .5 and a trailing dot like 1. are both fine) each followed by a
 * unit (ns, us, µs, μs, ms, s, m, h). A bare 0 is also valid. Blank means the backend default.
 */
const DURATION_PATTERN =
  /^[-+]?(?:\d+\.?\d*|\.\d+)(?:ns|us|µs|μs|ms|s|m|h)(?:(?:\d+\.?\d*|\.\d+)(?:ns|us|µs|μs|ms|s|m|h))*$/;
const ZERO_PATTERN = /^[-+]?0$/;

export const validateAffinityTtl = (value: string): 'invalid' | null => {
  const ttl = normalizeTtl(value);
  return !ttl || ZERO_PATTERN.test(ttl) || DURATION_PATTERN.test(ttl) ? null : 'invalid';
};

/** Edits that actually differ from the saved baseline. Matching edits are dropped. */
export const effectiveRoutingEdits = (
  base: RoutingSettingsValues,
  edits: RoutingSettingsEdits
): RoutingSettingsEdits => {
  const result: RoutingSettingsEdits = {};
  if (edits.strategy !== undefined && edits.strategy !== base.strategy) {
    result.strategy = edits.strategy;
  }
  if (edits.sessionAffinity !== undefined && edits.sessionAffinity !== base.sessionAffinity) {
    result.sessionAffinity = edits.sessionAffinity;
  }
  if (
    edits.sessionAffinityTtl !== undefined &&
    normalizeTtl(edits.sessionAffinityTtl) !== normalizeTtl(base.sessionAffinityTtl)
  ) {
    result.sessionAffinityTtl = edits.sessionAffinityTtl;
  }
  return result;
};

/**
 * Validates only a TTL the user has actually changed. An unusual value that is already saved
 * must never block saving other settings.
 */
export const validateTouchedTtl = (
  base: RoutingSettingsValues,
  edits: RoutingSettingsEdits
): 'invalid' | null => {
  const touched = effectiveRoutingEdits(base, edits).sessionAffinityTtl;
  return touched === undefined ? null : validateAffinityTtl(touched);
};

export const hasRoutingEdits = (base: RoutingSettingsValues, edits: RoutingSettingsEdits) =>
  Object.keys(effectiveRoutingEdits(base, edits)).length > 0;

export const applyRoutingEdits = (
  base: RoutingSettingsValues,
  edits: RoutingSettingsEdits
): RoutingSettingsValues => ({
  strategy: edits.strategy ?? base.strategy,
  sessionAffinity: edits.sessionAffinity ?? base.sessionAffinity,
  sessionAffinityTtl: edits.sessionAffinityTtl ?? base.sessionAffinityTtl,
});

/**
 * Field-level plan for the existing config mutation pipeline. Only touched fields appear;
 * a blank TTL deletes the key so the backend default applies again.
 */
export const buildRoutingSettingsPlan = (
  base: RoutingSettingsValues,
  edits: RoutingSettingsEdits
): ConfigPatchPlan | null => {
  const changed = effectiveRoutingEdits(base, edits);
  const routing: Record<string, unknown> = {};
  const deletions: string[][] = [];
  if (changed.strategy !== undefined) routing[ROUTING_PATHS.strategy[1]] = changed.strategy;
  if (changed.sessionAffinity !== undefined) {
    routing[ROUTING_PATHS.sessionAffinity[1]] = changed.sessionAffinity;
  }
  if (changed.sessionAffinityTtl !== undefined) {
    const ttl = normalizeTtl(changed.sessionAffinityTtl);
    if (ttl) routing[ROUTING_PATHS.sessionAffinityTtl[1]] = ttl;
    else deletions.push([...ROUTING_PATHS.sessionAffinityTtl]);
  }
  const plan: ConfigPatchPlan = {
    patch: Object.keys(routing).length ? { routing } : {},
    deletions,
  };
  return hasConfigPatchChanges(plan) ? plan : null;
};

// ---------------------------------------------------------------------------
// Per-account priority and weight
// ---------------------------------------------------------------------------

export interface AccountTuningDraft {
  priority: string;
  weight: string;
}

export type AccountTuningEdits = Partial<AccountTuningDraft>;

export type AccountTuningErrors = {
  priority?: 'integer';
  weight?: CredentialWeightError;
};

export const readAccountTuningText = (file: AuthFileItem): AccountTuningDraft => ({
  priority: typeof file.priority === 'number' ? String(file.priority) : '',
  weight: typeof file.weight === 'number' ? String(file.weight) : '',
});

export const validateAccountTuning = (draft: AccountTuningEdits): AccountTuningErrors => {
  const errors: AccountTuningErrors = {};
  if (draft.priority !== undefined) {
    const text = draft.priority.trim();
    if (text && parsePriorityValue(text) === undefined) errors.priority = 'integer';
  }
  if (draft.weight !== undefined) {
    const error = validateCredentialWeightText(draft.weight);
    if (error) errors.weight = error;
  }
  return errors;
};

export const hasAccountTuningErrors = (errors: AccountTuningErrors) =>
  errors.priority !== undefined || errors.weight !== undefined;

/**
 * Same field semantics as the credential details editor: blank priority restores the
 * default 0, blank weight restores the default through null, and untouched or unchanged
 * fields are omitted. Throws nothing; invalid text yields no field.
 */
export const buildAccountTuningPatch = (
  file: Pick<AuthFileItem, 'priority' | 'weight'>,
  edits: AccountTuningEdits
): AuthFileFieldsPatch => {
  const patch: AuthFileFieldsPatch = {};
  const errors = validateAccountTuning(edits);

  if (edits.priority !== undefined && !errors.priority) {
    const original = typeof file.priority === 'number' ? file.priority : undefined;
    const text = edits.priority.trim();
    const next = text ? parsePriorityValue(text) : undefined;
    if (next === undefined) {
      if (original !== undefined && original !== 0) patch.priority = 0;
    } else if (next === 0) {
      if (original !== undefined && original !== 0) patch.priority = 0;
    } else if (next !== original) {
      patch.priority = next;
    }
  }

  if (edits.weight !== undefined && !errors.weight) {
    const original = readCredentialWeight(file.weight);
    const next = parseCredentialWeightText(edits.weight);
    if (next === undefined) {
      if (original !== undefined) patch.weight = null;
    } else if (next !== original) {
      patch.weight = next;
    }
  }

  return patch;
};

export const isAccountTuningDirty = (
  file: Pick<AuthFileItem, 'priority' | 'weight'>,
  edits: AccountTuningEdits | undefined
): boolean => Boolean(edits) && Object.keys(buildAccountTuningPatch(file, edits ?? {})).length > 0;

const availabilityOf = (file: AuthFileItem): RoutingAvailability => {
  const availability = resolveAccountAvailability(file);
  if (availability === null || availability === 'available') return 'available';
  if (availability === 'coolingDown') return 'unavailable';
  // The backend only skips credentials flagged unavailable; a bare warning status is unknown.
  if (availability === 'attention') return file.unavailable === true ? 'unavailable' : 'unknown';
  return 'unknown';
};

/**
 * Presentation input for one account. Draft priority and weight (when valid) feed the
 * illustrative shares so the preview follows what is typed; invalid text falls back to the
 * saved value rather than guessing.
 */
export const toRoutingAccountInput = (
  file: AuthFileItem,
  edits?: AccountTuningEdits
): RoutingAccountInput => {
  const errors = validateAccountTuning(edits ?? {});
  let priority: number | undefined = typeof file.priority === 'number' ? file.priority : undefined;
  let weight: number | undefined = typeof file.weight === 'number' ? file.weight : undefined;
  if (edits?.priority !== undefined && !errors.priority) {
    priority = edits.priority.trim() ? parsePriorityValue(edits.priority) : undefined;
  }
  if (edits?.weight !== undefined && !errors.weight) {
    weight = parseCredentialWeightText(edits.weight);
  }
  const title = deriveAccountTitle(file);
  return {
    id: String(file.name),
    label: title.title || String(file.name),
    provider: accountProviderKey(file),
    enabled: !isAccountDisabled(file),
    availability: availabilityOf(file),
    priority,
    weight,
  };
};

/** Accounts that can be edited here: file-backed credentials, not runtime-only virtual ones. */
export const isTunableAccount = (file: AuthFileItem): boolean => {
  const raw = file['runtime_only'] ?? file.runtimeOnly;
  return !(raw === true || raw === 'true');
};

// ---------------------------------------------------------------------------
// Save orchestration
// ---------------------------------------------------------------------------

export type SaveStatus =
  | { phase: 'idle' }
  | { phase: 'saving' }
  | { phase: 'saved' }
  /** The write succeeded but the saved settings could not be re-read: the baseline is stale. */
  | { phase: 'reload_failed' }
  | { phase: 'failed'; message: string };

export const IDLE_SAVE: SaveStatus = { phase: 'idle' };

export interface RoutingSaveDeps {
  /** The apiClient connection revision at call time. A change means a different session. */
  connectionRevision: () => number;
  /** Revision-aware config field mutation (applyConfigPatch). */
  applyConfigPlan: (plan: ConfigPatchPlan, connectionRevision: number) => Promise<void>;
  /** One auth-file field patch (authFilesApi.patchFields). */
  patchAccount: (name: string, patch: AuthFileFieldsPatch) => Promise<unknown>;
  /** Extra staleness check, e.g. an unmounted editor or a superseded operation. */
  isCurrent?: () => boolean;
}

export type GlobalRoutingSaveResult =
  | { kind: 'noop' }
  | { kind: 'saved' }
  | { kind: 'failed'; message: string }
  /** The connection changed or the editor went away: callers must not touch state. */
  | { kind: 'stale' };

const errorMessage = (error: unknown): string =>
  error instanceof Error && error.message ? error.message : '';

const isStale = (deps: RoutingSaveDeps, revision: number): boolean =>
  revision !== deps.connectionRevision() || deps.isCurrent?.() === false;

export const saveGlobalRouting = async (
  deps: RoutingSaveDeps,
  base: RoutingSettingsValues,
  edits: RoutingSettingsEdits
): Promise<GlobalRoutingSaveResult> => {
  const plan = buildRoutingSettingsPlan(base, edits);
  if (!plan) return { kind: 'noop' };
  const revision = deps.connectionRevision();
  try {
    await deps.applyConfigPlan(plan, revision);
  } catch (error: unknown) {
    if (isStale(deps, revision)) return { kind: 'stale' };
    return { kind: 'failed', message: errorMessage(error) };
  }
  return isStale(deps, revision) ? { kind: 'stale' } : { kind: 'saved' };
};

export interface AccountTuningSaveEntry {
  name: string;
  file: Pick<AuthFileItem, 'priority' | 'weight'>;
  edits: AccountTuningEdits;
}

export type AccountTuningSaveResult =
  | {
      kind: 'done';
      /** Patched successfully. Their drafts may be dropped once the list is re-read. */
      saved: string[];
      /** Rejected or invalid. Drafts must be retained. */
      failed: { name: string; message: string }[];
      /** Not attempted because they had nothing to write. */
      unchanged: string[];
    }
  | { kind: 'stale' };

/**
 * Saves each account independently and sequentially. One failing account never hides the
 * others' outcome, and nothing here reports the whole batch as atomic.
 */
export const saveAccountTunings = async (
  deps: RoutingSaveDeps,
  entries: AccountTuningSaveEntry[]
): Promise<AccountTuningSaveResult> => {
  const revision = deps.connectionRevision();
  const saved: string[] = [];
  const failed: { name: string; message: string }[] = [];
  const unchanged: string[] = [];

  for (const entry of entries) {
    if (isStale(deps, revision)) return { kind: 'stale' };
    const errors = validateAccountTuning(entry.edits);
    if (hasAccountTuningErrors(errors)) {
      failed.push({ name: entry.name, message: '' });
      continue;
    }
    const patch = buildAccountTuningPatch(entry.file, entry.edits);
    if (Object.keys(patch).length === 0) {
      unchanged.push(entry.name);
      continue;
    }
    try {
      await deps.patchAccount(entry.name, patch);
    } catch (error: unknown) {
      if (isStale(deps, revision)) return { kind: 'stale' };
      failed.push({ name: entry.name, message: errorMessage(error) });
      continue;
    }
    if (isStale(deps, revision)) return { kind: 'stale' };
    saved.push(entry.name);
  }
  return { kind: 'done', saved, failed, unchanged };
};

const sameEdits = (a: AccountTuningEdits | undefined, b: AccountTuningEdits | undefined) =>
  (a?.priority ?? undefined) === (b?.priority ?? undefined) &&
  (a?.weight ?? undefined) === (b?.weight ?? undefined);

/**
 * Drops the draft of an account that was saved or had nothing to write, but only while it
 * still equals what was submitted. A field typed while the save was in flight is a newer
 * draft and stays. Failed and unattempted accounts always keep their drafts.
 */
export const retainFailedTuningEdits = (
  edits: Record<string, AccountTuningEdits>,
  result: Extract<AccountTuningSaveResult, { kind: 'done' }>,
  submitted: Record<string, AccountTuningEdits>
): Record<string, AccountTuningEdits> => {
  const settled = new Set([...result.saved, ...result.unchanged]);
  return Object.fromEntries(
    Object.entries(edits).filter(
      ([name, current]) => !settled.has(name) || !sameEdits(current, submitted[name])
    )
  );
};

export type AccountSaveOutcome = 'saved' | 'partial' | 'failed';

/** Honest batch summary: success only when every attempted account was written. */
export const summarizeAccountSave = (
  result: Extract<AccountTuningSaveResult, { kind: 'done' }>
): AccountSaveOutcome => {
  if (result.failed.length === 0) return 'saved';
  return result.saved.length > 0 ? 'partial' : 'failed';
};

/** Applies a successful patch to the locally held list item so drafts do not reappear dirty. */
export const applyTuningPatchToFile = (
  file: AuthFileItem,
  patch: AuthFileFieldsPatch
): AuthFileItem => {
  const next: AuthFileItem = { ...file };
  if (patch.priority !== undefined) {
    if (patch.priority === 0) delete next.priority;
    else next.priority = patch.priority;
  }
  if (patch.weight !== undefined) {
    if (patch.weight === null) delete next.weight;
    else next.weight = patch.weight;
  }
  return next;
};
