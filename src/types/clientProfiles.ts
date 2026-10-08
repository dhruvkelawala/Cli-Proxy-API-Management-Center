/**
 * Client profile (per-client subscription routing) types, normalized from the v8 Management API
 * contract in CLIProxyAPI `plans/client-profile-api.md` (CPA-002, contract version 1).
 *
 * Raw client API keys and OAuth metadata never appear in these types: the backend projection
 * excludes them, and the dashboard only sends a raw key value when associating or rotating one.
 */

/** Providers with independent client profile rules. Both are mandatory on every profile. */
export const CLIENT_PROFILE_PROVIDERS = ['claude', 'codex'] as const;
export type ClientProfileProvider = (typeof CLIENT_PROFILE_PROVIDERS)[number];

export type ClientProfilePolicy =
  | { mode: 'automatic' }
  | { mode: 'only'; accountRef: string }
  /** A persisted rule the dashboard cannot interpret. Shown as-is, never rewritten silently. */
  | { mode: 'unknown'; rawMode: string; accountRef?: string };

export type ClientProfilePolicies = Record<ClientProfileProvider, ClientProfilePolicy>;

/** A policy the dashboard is allowed to write (contract modes `automatic` and `only`). */
export type WritableClientProfilePolicy = Exclude<ClientProfilePolicy, { mode: 'unknown' }>;
export type WritableClientProfilePolicies = Record<
  ClientProfileProvider,
  WritableClientProfilePolicy
>;

export interface ClientProfile {
  profileRef: string;
  label: string;
  /** Per-profile edit counter (starts at 1). Not the list ETag. */
  revision: number;
  policies: ClientProfilePolicies;
}

/** Association of one existing client API key to a profile. Holds no key material. */
export interface ClientProfileKey {
  keyRef: string;
  label: string;
  profileRef: string;
  revision: number;
}

/** Target resolution states reported by the backend for an Only rule. */
export type ClientProfileTargetState =
  | 'automatic'
  | 'available'
  | 'target_removed'
  | 'target_unavailable'
  | 'target_unsupported'
  | 'duplicate_account_ref'
  | 'provider_mismatch'
  | 'invalid_account_ref'
  | 'unknown_mode'
  | 'unknown_provider'
  /** Not reported, or reported with a value this dashboard does not know. */
  | 'unknown';

/** Inventory-level account state: a target state, or one of the account-only states. */
export type ClientProfileAccountState = ClientProfileTargetState | 'not_enrolled' | 'unavailable';

export interface ClientProfileAccount {
  /** Opaque transient handle, only valid for enrollment. Never a policy target. */
  credentialRef: string;
  /** Durable policy target; null until the credential is enrolled. */
  accountRef: string | null;
  provider: string;
  label: string;
  /** Inventory-level enablement/unavailability, not model eligibility or quota. */
  available: boolean;
  state: ClientProfileAccountState;
  enrollmentSupported: boolean;
  targetSupported: boolean;
}

export type ClientProfileTargetStates = Record<
  string,
  Partial<Record<ClientProfileProvider, ClientProfileTargetState>>
>;

export interface ClientProfilesSnapshot {
  /** Quoted ETag string; send unchanged as If-Match on profile/key mutations. */
  revision: string;
  profiles: ClientProfile[];
  keys: ClientProfileKey[];
  accounts: ClientProfileAccount[];
  targetStates: ClientProfileTargetStates;
}

export type ClientProfileSessionBehavior = 'fresh_session_required' | 'unknown';

export interface ClientProfilesCapabilities {
  contractVersion: number;
  management: boolean;
  /** False until backend CPA-003: strict (Only) keys are rejected with 503. */
  enforcement: boolean;
  strictRequests: string;
  providers: string[];
  modes: string[];
  sessionBehavior: ClientProfileSessionBehavior;
  bindingRequires: string[];
  enrollmentStores: string[];
  enrollmentStorage: string[];
  unsupported: string[];
}

export type ClientProfilesSupport =
  | { supported: true; capabilities: ClientProfilesCapabilities }
  | { supported: false; reason: 'not_found' | 'incompatible_contract' };

export interface ClientProfileMutation<T> {
  /** New quoted ETag after the write. */
  revision: string;
  result: T;
  sessionBehavior: ClientProfileSessionBehavior;
}

export interface ClientProfilePreview {
  revision: string;
  policies: ClientProfilePolicies;
  targetStates: Partial<Record<ClientProfileProvider, ClientProfileTargetState>>;
  enforcement: boolean;
  strictRequests: string;
  sessionBehavior: ClientProfileSessionBehavior;
}

export interface ClientProfileDraft {
  label: string;
  policies: WritableClientProfilePolicies;
}

/** Normalized domain error: HTTP status plus the backend machine code and optional field. */
export interface ClientProfileErrorInfo {
  status: number | null;
  code: string | null;
  field: string | null;
}
