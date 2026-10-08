/**
 * Client profile management API (CLIProxyAPI CPA-002, contract version 1, `/v8/management`).
 *
 * The backend is the source of truth. This module normalizes snake_case on read, serializes on
 * write and keeps raw-field handling out of components. Read results never carry raw client
 * keys or OAuth metadata: only whitelisted fields are copied.
 */

import { apiClient } from './client';
import { isRecord } from '@/utils/helpers';
import {
  CLIENT_PROFILE_PROVIDERS,
  type ClientProfile,
  type ClientProfileAccount,
  type ClientProfileAccountState,
  type ClientProfileDraft,
  type ClientProfileErrorInfo,
  type ClientProfileKey,
  type ClientProfileMutation,
  type ClientProfilePolicies,
  type ClientProfilePolicy,
  type ClientProfilePreview,
  type ClientProfileProvider,
  type ClientProfileSessionBehavior,
  type ClientProfilesCapabilities,
  type ClientProfilesSnapshot,
  type ClientProfilesSupport,
  type ClientProfileTargetState,
  type ClientProfileTargetStates,
  type WritableClientProfilePolicies,
} from '@/types/clientProfiles';

export const CLIENT_PROFILES_CONTRACT_VERSION = 1;

const TARGET_STATES: ReadonlySet<string> = new Set<ClientProfileTargetState>([
  'automatic',
  'available',
  'target_removed',
  'target_unavailable',
  'target_unsupported',
  'duplicate_account_ref',
  'provider_mismatch',
  'invalid_account_ref',
  'unknown_mode',
  'unknown_provider',
]);
const ACCOUNT_ONLY_STATES: ReadonlySet<string> = new Set(['not_enrolled', 'unavailable']);

const readString = (value: unknown): string => (typeof value === 'string' ? value : '');
const readTrimmed = (value: unknown): string => readString(value).trim();
const readStrings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
const readCount = (value: unknown): number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;

const isProvider = (value: string): value is ClientProfileProvider =>
  (CLIENT_PROFILE_PROVIDERS as readonly string[]).includes(value);

const normalizeTargetState = (value: unknown): ClientProfileTargetState => {
  const state = readTrimmed(value);
  return TARGET_STATES.has(state) ? (state as ClientProfileTargetState) : 'unknown';
};

const normalizeAccountState = (value: unknown): ClientProfileAccountState => {
  const state = readTrimmed(value);
  return ACCOUNT_ONLY_STATES.has(state)
    ? (state as ClientProfileAccountState)
    : normalizeTargetState(state);
};

const normalizeSessionBehavior = (value: unknown): ClientProfileSessionBehavior =>
  value === 'fresh_session_required' ? 'fresh_session_required' : 'unknown';

const normalizePolicy = (value: unknown): ClientProfilePolicy => {
  const record = isRecord(value) ? value : {};
  const mode = readTrimmed(record.mode);
  const accountRef = readTrimmed(record.account_ref);
  if (mode === 'automatic' && !accountRef) return { mode: 'automatic' };
  if (mode === 'only' && accountRef) return { mode: 'only', accountRef };
  return accountRef
    ? { mode: 'unknown', rawMode: mode, accountRef }
    : { mode: 'unknown', rawMode: mode };
};

const normalizePolicies = (value: unknown): ClientProfilePolicies => {
  const record = isRecord(value) ? value : {};
  return {
    claude: normalizePolicy(record.claude),
    codex: normalizePolicy(record.codex),
  };
};

const normalizeProfile = (value: unknown): ClientProfile | null => {
  if (!isRecord(value)) return null;
  const profileRef = readTrimmed(value.profile_ref);
  if (!profileRef) return null;
  return {
    profileRef,
    label: readTrimmed(value.label),
    revision: readCount(value.revision),
    policies: normalizePolicies(value.policies),
  };
};

const normalizeKey = (value: unknown): ClientProfileKey | null => {
  if (!isRecord(value)) return null;
  const keyRef = readTrimmed(value.key_ref);
  if (!keyRef) return null;
  // Whitelist: the association never exposes key material, and nothing else is copied.
  return {
    keyRef,
    label: readTrimmed(value.label),
    profileRef: readTrimmed(value.profile_ref),
    revision: readCount(value.revision),
  };
};

const normalizeAccount = (value: unknown): ClientProfileAccount | null => {
  if (!isRecord(value)) return null;
  const credentialRef = readTrimmed(value.credential_ref);
  if (!credentialRef) return null;
  return {
    credentialRef,
    accountRef: readTrimmed(value.account_ref) || null,
    provider: readTrimmed(value.provider).toLowerCase(),
    label: readTrimmed(value.label),
    available: value.available === true,
    state: normalizeAccountState(value.state),
    enrollmentSupported: value.enrollment_supported === true,
    targetSupported: value.target_supported === true,
  };
};

const normalizeList = <T>(value: unknown, normalize: (item: unknown) => T | null): T[] =>
  Array.isArray(value) ? value.map(normalize).filter((item): item is T => item !== null) : [];

const normalizeProviderStates = (
  value: unknown
): Partial<Record<ClientProfileProvider, ClientProfileTargetState>> => {
  const states: Partial<Record<ClientProfileProvider, ClientProfileTargetState>> = {};
  if (!isRecord(value)) return states;
  Object.entries(value).forEach(([provider, state]) => {
    if (isProvider(provider)) states[provider] = normalizeTargetState(state);
  });
  return states;
};

const normalizeTargetStates = (value: unknown): ClientProfileTargetStates => {
  const states: ClientProfileTargetStates = {};
  if (!isRecord(value)) return states;
  Object.entries(value).forEach(([profileRef, providers]) => {
    states[profileRef] = normalizeProviderStates(providers);
  });
  return states;
};

export const normalizeClientProfilesSnapshot = (
  payload: unknown,
  etag: string | null
): ClientProfilesSnapshot => {
  const record = isRecord(payload) ? payload : {};
  return {
    revision: readTrimmed(record.revision) || (etag ?? '').trim(),
    profiles: normalizeList(record.profiles, normalizeProfile),
    keys: normalizeList(record.keys, normalizeKey),
    accounts: normalizeList(record.accounts, normalizeAccount),
    targetStates: normalizeTargetStates(record.target_states),
  };
};

export const normalizeClientProfilesCapabilities = (payload: unknown): ClientProfilesSupport => {
  const record = isRecord(payload) ? payload : {};
  if (record.contract_version !== CLIENT_PROFILES_CONTRACT_VERSION || record.management !== true) {
    return { supported: false, reason: 'incompatible_contract' };
  }
  const capabilities: ClientProfilesCapabilities = {
    contractVersion: CLIENT_PROFILES_CONTRACT_VERSION,
    management: true,
    // Only an explicit true means enforcement is active.
    enforcement: record.enforcement === true,
    strictRequests: readTrimmed(record.strict_requests),
    providers: readStrings(record.providers),
    modes: readStrings(record.modes),
    sessionBehavior: normalizeSessionBehavior(record.session_behavior),
    bindingRequires: readStrings(record.binding_requires),
    enrollmentStores: readStrings(record.enrollment_stores),
    enrollmentStorage: readStrings(record.enrollment_storage),
    unsupported: readStrings(record.unsupported),
  };
  return { supported: true, capabilities };
};

const normalizeMutation = <T>(
  payload: unknown,
  normalizeResult: (value: unknown) => T
): ClientProfileMutation<T> => {
  const record = isRecord(payload) ? payload : {};
  return {
    revision: readTrimmed(record.revision),
    result: normalizeResult(record.result),
    sessionBehavior: normalizeSessionBehavior(record.session_behavior),
  };
};

const normalizeDeleted = (value: unknown): { deleted: string } => ({
  deleted: isRecord(value) ? readTrimmed(value.deleted) : '',
});

const requireProfile = (value: unknown): ClientProfile => {
  const profile = normalizeProfile(value);
  if (!profile) throw new Error('Invalid client profile response');
  return profile;
};

const requireKey = (value: unknown): ClientProfileKey => {
  const key = normalizeKey(value);
  if (!key) throw new Error('Invalid client key association response');
  return key;
};

export const serializeClientProfilePolicies = (policies: WritableClientProfilePolicies) =>
  Object.fromEntries(
    CLIENT_PROFILE_PROVIDERS.map((provider) => {
      const policy = policies[provider];
      return [
        provider,
        policy.mode === 'only'
          ? { mode: 'only', account_ref: policy.accountRef }
          : { mode: 'automatic' },
      ];
    })
  ) as Record<ClientProfileProvider, { mode: string; account_ref?: string }>;

const serializeDraft = (draft: ClientProfileDraft) => ({
  label: draft.label.trim(),
  policies: serializeClientProfilePolicies(draft.policies),
});

/** Profile/key mutations need the exact list ETag; never send a write without one. */
const ifMatch = (revision: string) => {
  const value = revision.trim();
  if (!value) throw new Error('A client profile revision is required for this change');
  return { headers: { 'If-Match': value } };
};

const readEtag = (headers: unknown): string | null => {
  if (!headers) return null;
  const getter = (headers as { get?: (name: string) => unknown }).get;
  const value =
    typeof getter === 'function'
      ? getter.call(headers, 'etag')
      : isRecord(headers)
        ? (headers.etag ?? headers.ETag)
        : undefined;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
};

const encodeRef = (ref: string) => encodeURIComponent(ref.trim());

export const readClientProfileError = (error: unknown): ClientProfileErrorInfo => {
  if (!isRecord(error)) return { status: null, code: null, field: null };
  const status = typeof error.status === 'number' ? error.status : null;
  const data = isRecord(error.data) ? error.data : null;
  const envelope = data && isRecord(data.error) ? data.error : null;
  const code = readTrimmed(envelope?.code) || readTrimmed(error.apiCode) || null;
  const field = readTrimmed(envelope?.field) || null;
  return { status, code, field };
};

export const isClientProfilesNotFound = (error: unknown): boolean =>
  readClientProfileError(error).status === 404;

export type KeyUpdate = { apiKey?: string; label?: string; profileRef?: string };

export const clientProfilesApi = {
  /** Capability probe. 404 or an unknown contract means Unsupported; other errors throw. */
  async probe(): Promise<ClientProfilesSupport> {
    try {
      return normalizeClientProfilesCapabilities(
        await apiClient.get<unknown>('/client-profiles/capabilities')
      );
    } catch (error) {
      if (isClientProfilesNotFound(error)) return { supported: false, reason: 'not_found' };
      throw error;
    }
  },

  async list(): Promise<ClientProfilesSnapshot> {
    const response = await apiClient.getRaw('/client-profiles');
    return normalizeClientProfilesSnapshot(response.data, readEtag(response.headers));
  },

  async createProfile(
    revision: string,
    draft: ClientProfileDraft
  ): Promise<ClientProfileMutation<ClientProfile>> {
    const config = ifMatch(revision);
    return normalizeMutation(
      await apiClient.post<unknown>('/client-profiles', serializeDraft(draft), config),
      requireProfile
    );
  },

  /** Complete replacement: both mandatory rules and the label are always sent. */
  async updateProfile(
    revision: string,
    profileRef: string,
    draft: ClientProfileDraft
  ): Promise<ClientProfileMutation<ClientProfile | null>> {
    const config = ifMatch(revision);
    return normalizeMutation(
      await apiClient.put<unknown>(
        `/client-profiles/${encodeRef(profileRef)}`,
        serializeDraft(draft),
        config
      ),
      normalizeProfile
    );
  },

  async deleteProfile(
    revision: string,
    profileRef: string
  ): Promise<ClientProfileMutation<{ deleted: string }>> {
    const config = ifMatch(revision);
    return normalizeMutation(
      await apiClient.delete<unknown>(`/client-profiles/${encodeRef(profileRef)}`, config),
      normalizeDeleted
    );
  },

  async preview(
    input: { profileRef: string } | { policies: WritableClientProfilePolicies }
  ): Promise<ClientProfilePreview> {
    const body =
      'profileRef' in input
        ? { profile_ref: input.profileRef }
        : { policies: serializeClientProfilePolicies(input.policies) };
    const payload = await apiClient.post<unknown>('/client-profiles/preview', body);
    const record = isRecord(payload) ? payload : {};
    return {
      revision: readTrimmed(record.revision),
      policies: normalizePolicies(record.policies),
      targetStates: normalizeProviderStates(record.target_states),
      enforcement: record.enforcement === true,
      strictRequests: readTrimmed(record.strict_requests),
      sessionBehavior: normalizeSessionBehavior(record.session_behavior),
    };
  },

  async listKeys(): Promise<ClientProfileKey[]> {
    const payload = await apiClient.get<unknown>('/client-profile-keys');
    return normalizeList(isRecord(payload) ? payload.keys : null, normalizeKey);
  },

  /** `apiKey` must be an existing legacy `access.api-keys` value; it is never echoed back. */
  async associateKey(
    revision: string,
    input: { label: string; profileRef: string; apiKey: string }
  ): Promise<ClientProfileMutation<ClientProfileKey>> {
    const config = ifMatch(revision);
    return normalizeMutation(
      await apiClient.post<unknown>(
        '/client-profile-keys',
        { label: input.label.trim(), profile_ref: input.profileRef, api_key: input.apiKey.trim() },
        config
      ),
      requireKey
    );
  },

  /** Move, relabel or rotate. Omitted (or empty) fields are retained by the backend. */
  async updateKey(
    revision: string,
    keyRef: string,
    update: KeyUpdate
  ): Promise<ClientProfileMutation<ClientProfileKey | null>> {
    const config = ifMatch(revision);
    const body: Record<string, string> = {};
    if (update.apiKey?.trim()) body.api_key = update.apiKey.trim();
    if (update.label?.trim()) body.label = update.label.trim();
    if (update.profileRef?.trim()) body.profile_ref = update.profileRef.trim();
    return normalizeMutation(
      await apiClient.put<unknown>(`/client-profile-keys/${encodeRef(keyRef)}`, body, config),
      normalizeKey
    );
  },

  /** Removes the association AND revokes the legacy key value on the gateway. */
  async deleteKey(
    revision: string,
    keyRef: string
  ): Promise<ClientProfileMutation<{ deleted: string }>> {
    const config = ifMatch(revision);
    return normalizeMutation(
      await apiClient.delete<unknown>(`/client-profile-keys/${encodeRef(keyRef)}`, config),
      normalizeDeleted
    );
  },

  async listAccounts(): Promise<ClientProfileAccount[]> {
    const payload = await apiClient.get<unknown>('/client-profile-accounts');
    return normalizeList(isRecord(payload) ? payload.accounts : null, normalizeAccount);
  },

  /** Enrollment edits the credential record, not the config, so it takes no If-Match. */
  async enroll(credentialRef: string): Promise<{ credentialRef: string; accountRef: string }> {
    const payload = await apiClient.post<unknown>('/client-profile-accounts/enroll', {
      credential_ref: credentialRef,
    });
    const record = isRecord(payload) ? payload : {};
    return {
      credentialRef: readTrimmed(record.credential_ref) || credentialRef,
      accountRef: readTrimmed(record.account_ref),
    };
  },
};

/** Contract failure categories the UI explains. Codes come from CPA-002's domain envelope. */
export type ClientProfileFailureKind =
  | 'stale'
  | 'reload_pending'
  | 'profile_in_use'
  | 'last_client_key'
  | 'key_exists'
  | 'key_missing'
  /** The key value is already associated (with this or another profile). */
  | 'key_linked'
  | 'target_invalid'
  | 'websocket_auth_required'
  | 'invalid_label'
  | 'already_enrolled'
  | 'enrollment_unsupported'
  | 'credential_changed'
  | 'not_found'
  | 'activation_unavailable'
  | 'invalid_config'
  | 'invalid'
  | 'persistence'
  | 'unknown';

const TARGET_FAILURE_CODES: ReadonlySet<string> = new Set([
  'target_removed',
  'target_unavailable',
  'target_unsupported',
  'duplicate_account_ref',
  'provider_mismatch',
  'invalid_account_ref',
]);

export const classifyClientProfileError = ({
  status,
  code,
}: ClientProfileErrorInfo): ClientProfileFailureKind => {
  if (status === 412 || status === 428 || code === 'stale_revision') return 'stale';
  if (code === 'reload_pending') return 'reload_pending';
  if (code === 'profile_in_use') return 'profile_in_use';
  if (code === 'last_client_key') return 'last_client_key';
  if (code === 'key_already_exists') return 'key_exists';
  if (code === 'key_removed') return 'key_missing';
  if (code === 'invalid_key_association') return 'key_linked';
  if (code && TARGET_FAILURE_CODES.has(code)) return 'target_invalid';
  if (code === 'websocket_auth_required') return 'websocket_auth_required';
  if (code === 'invalid_label') return 'invalid_label';
  if (code === 'already_enrolled') return 'already_enrolled';
  if (code === 'enrollment_unsupported') return 'enrollment_unsupported';
  if (code === 'credential_changed' || code === 'credential_removed') return 'credential_changed';
  if (code === 'activation_unavailable' || code === 'credential_owner_unavailable') {
    return 'activation_unavailable';
  }
  if (code === 'invalid_persisted_config') return 'invalid_config';
  if (status === 404) return 'not_found';
  if (status === 400 || status === 422) return 'invalid';
  if (status === 500 || code === 'persistence_failed') return 'persistence';
  return 'unknown';
};
