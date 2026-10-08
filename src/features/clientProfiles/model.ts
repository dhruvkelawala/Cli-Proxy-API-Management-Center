/**
 * Client routes presentation model. React-free; consumed by tests/clientProfilesState.test.ts.
 *
 * Honesty rules (CPA-005):
 * - An Only rule is a configured target, never proof of which account served a request.
 * - A target that is disabled, unavailable, removed, ambiguous or unsupported means the
 *   profile's requests for that provider fail. Nothing substitutes another account.
 * - Automatic shows the eligible shared pool with illustrative shares; unknown stays unknown.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import {
  buildRoutingPresentation,
  type RoutingAccountPresentation,
  type RoutingAvailability,
} from '@/features/config/routing/routingPresentation';
import { accountProviderKey, isAccountDisabled } from '@/features/authFiles/accountPresentation';
import { deriveAccountTitle } from '@/features/authFiles/identity';
import type { AuthFileItem } from '@/types';
import type { RoutingStrategy } from '@/types/visualConfig';
import {
  CLIENT_PROFILE_PROVIDERS,
  type ClientProfile,
  type ClientProfileAccount,
  type ClientProfilePolicy,
  type ClientProfileProvider,
  type ClientProfilesSnapshot,
  type ClientProfileTargetState,
  type WritableClientProfilePolicies,
  type WritableClientProfilePolicy,
} from '@/types/clientProfiles';

export const ROUTING_STRATEGIES: readonly RoutingStrategy[] = [
  'round-robin',
  'weighted-round-robin',
  'fill-first',
];

export const readRoutingStrategy = (value: unknown): RoutingStrategy | null =>
  typeof value === 'string' && (ROUTING_STRATEGIES as readonly string[]).includes(value)
    ? (value as RoutingStrategy)
    : null;

/* ------------------------------------------------------------------ */
/* Identity joins (fail-safe: no match means no link, never a wrong one) */
/* ------------------------------------------------------------------ */

const hex = (input: string) => bytesToHex(sha256(new TextEncoder().encode(input)));

/**
 * CPA-002 derives the opaque `credential_ref` as `credential_` + SHA-256(auth ID). The Accounts
 * list exposes the same auth ID, so this links an account card to its inventory record. If the
 * backend changes the derivation, cards simply show no client links.
 */
export const credentialRefForAuthFile = (file: AuthFileItem): string | null => {
  const id = typeof file.id === 'string' ? file.id.trim() : '';
  return id ? `credential_${hex(id)}` : null;
};

/** Association records store SHA-256 of the trimmed key (backend `clientprofiles.Fingerprint`). */
export const clientKeyFingerprint = (apiKey: string): string => hex(apiKey.trim());

/* ------------------------------------------------------------------ */
/* Key picker: selections are fingerprints, never list positions       */
/* ------------------------------------------------------------------ */

export type ClientKeyChoice = { fingerprint: string; value: string };

/**
 * Client keys that can still be linked: present in `api-keys` and not associated with any
 * profile. `linked` is null when associations are unknown; every key is then offered and the
 * gateway rejects a duplicate association itself.
 */
export const linkableClientKeys = (
  apiKeys: readonly string[] | null,
  linked: ReadonlySet<string> | null
): ClientKeyChoice[] => {
  const seen = new Set<string>();
  const choices: ClientKeyChoice[] = [];
  for (const value of apiKeys ?? []) {
    if (!value.trim()) continue;
    const fingerprint = clientKeyFingerprint(value);
    if (seen.has(fingerprint) || linked?.has(fingerprint)) continue;
    seen.add(fingerprint);
    choices.push({ fingerprint, value });
  }
  return choices;
};

/** Identity of a key list's contents; a selection made against another list is void. */
export const clientKeyListSignature = (apiKeys: readonly string[] | null): string =>
  (apiKeys ?? []).map(clientKeyFingerprint).join(',');

export type ClientKeySelection = { fingerprint: string; listSignature: string } | null;

/** The fingerprint still selected, or '' once the key list changed or the key became linked. */
export const effectiveKeySelection = (
  selection: ClientKeySelection,
  apiKeys: readonly string[] | null,
  linked: ReadonlySet<string> | null
): string => {
  if (!selection || selection.listSignature !== clientKeyListSignature(apiKeys)) return '';
  return linkableClientKeys(apiKeys, linked).some(
    (choice) => choice.fingerprint === selection.fingerprint
  )
    ? selection.fingerprint
    : '';
};

/**
 * Resolve a selection against the key list as it is at submit time. Null when that exact key is
 * gone or already linked: the caller refuses instead of linking whatever now sits in its place.
 */
export const resolveKeyToLink = (
  fingerprint: string,
  apiKeys: readonly string[] | null,
  linked: ReadonlySet<string> | null
): string | null =>
  fingerprint
    ? (linkableClientKeys(apiKeys, linked).find((choice) => choice.fingerprint === fingerprint)
        ?.value ?? null)
    : null;

export const findAuthFileForAccount = (
  account: ClientProfileAccount,
  files: AuthFileItem[] | null
): AuthFileItem | null => {
  if (!files) return null;
  return files.find((file) => credentialRefForAuthFile(file) === account.credentialRef) ?? null;
};

export const findAccountForAuthFile = (
  file: AuthFileItem,
  accounts: ClientProfileAccount[]
): ClientProfileAccount | null => {
  const ref = credentialRefForAuthFile(file);
  return ref ? (accounts.find((account) => account.credentialRef === ref) ?? null) : null;
};

/** Same naming as the Accounts page (note, else email) when the card is known. */
export const accountDisplayLabel = (
  account: ClientProfileAccount,
  files: AuthFileItem[] | null
): string => {
  const file = findAuthFileForAccount(account, files);
  const title = file ? deriveAccountTitle(file).title : '';
  return title || account.label;
};

/* ------------------------------------------------------------------ */
/* Target resolution (mirrors clientprofiles.Resolve for drafts)       */
/* ------------------------------------------------------------------ */

/** Local mirror of the backend resolver, used for unsaved drafts and when a state is missing. */
export const resolveTargetState = (
  provider: ClientProfileProvider,
  policy: ClientProfilePolicy,
  accounts: ClientProfileAccount[]
): ClientProfileTargetState => {
  if (policy.mode === 'automatic') return 'automatic';
  if (policy.mode !== 'only') return 'unknown_mode';
  const matches = accounts.filter((account) => account.accountRef === policy.accountRef);
  if (matches.length === 0) return 'target_removed';
  if (matches.length > 1) return 'duplicate_account_ref';
  const [target] = matches;
  if (target.provider !== provider) return 'provider_mismatch';
  if (!target.targetSupported) return 'target_unsupported';
  if (!target.available) return 'target_unavailable';
  return 'available';
};

/** Every resolved state except these means requests with this rule fail. */
export const isFailingTargetState = (state: ClientProfileTargetState): boolean =>
  state !== 'automatic' && state !== 'available' && state !== 'unknown';

/* ------------------------------------------------------------------ */
/* Automatic: eligible shared pool                                     */
/* ------------------------------------------------------------------ */

export type PoolMember = {
  id: string;
  label: string;
  availability: RoutingAvailability;
  /** Illustrative configured share 0-100; null when the account is not a candidate now. */
  sharePercent: number | null;
  reasonKey: string;
  status: RoutingAccountPresentation['status'];
  reason: RoutingAccountPresentation['reason'];
};

export type PoolPreview =
  | { known: false }
  | {
      known: true;
      strategy: RoutingStrategy;
      members: PoolMember[];
      /** Candidates with a share (including standby), in display order. */
      candidates: PoolMember[];
      hasParticipants: boolean;
      hasUnknown: boolean;
    };

const routingAvailability = (file: AuthFileItem): RoutingAvailability => {
  if (file.unavailable === true) return 'unavailable';
  const status = typeof file.status === 'string' ? file.status.trim().toLowerCase() : '';
  return status === 'active' ? 'available' : 'unknown';
};

/**
 * Illustrative shared pool for one provider, from the Accounts list and the saved strategy.
 * Unknown when either is missing: the dashboard does not guess a pool.
 */
export const buildPoolPreview = (
  provider: ClientProfileProvider,
  files: AuthFileItem[] | null,
  strategy: RoutingStrategy | null
): PoolPreview => {
  if (!files || !strategy) return { known: false };
  const accounts = files
    .filter((file) => accountProviderKey(file) === provider)
    .map((file) => ({
      id: typeof file.id === 'string' && file.id ? file.id : file.name,
      label: deriveAccountTitle(file).title || file.name,
      provider,
      enabled: !isAccountDisabled(file),
      availability: routingAvailability(file),
      priority: typeof file.priority === 'number' ? file.priority : null,
      weight: typeof file.weight === 'number' ? file.weight : null,
    }));
  const presentation = buildRoutingPresentation({
    strategy,
    sessionAffinity: { enabled: false },
    accounts,
  });
  const members: PoolMember[] = presentation.accounts.map((account) => ({
    id: account.id,
    label: account.label,
    availability: account.availability,
    sharePercent: account.sharePercent,
    reasonKey: account.reasonKey,
    status: account.status,
    reason: account.reason,
  }));
  const candidates = members.filter((member) => member.sharePercent !== null);
  return {
    known: true,
    strategy,
    members,
    candidates,
    hasParticipants: candidates.length > 0,
    hasUnknown: candidates.some((member) => member.availability === 'unknown'),
  };
};

/* ------------------------------------------------------------------ */
/* Matrix cells                                                        */
/* ------------------------------------------------------------------ */

export type PolicyCell =
  | { kind: 'automatic'; provider: ClientProfileProvider; pool: PoolPreview; willFail: boolean }
  | {
      kind: 'only';
      provider: ClientProfileProvider;
      accountRef: string;
      account: ClientProfileAccount | null;
      accountLabel: string | null;
      state: ClientProfileTargetState;
      willFail: boolean;
    }
  | { kind: 'unknown'; provider: ClientProfileProvider; rawMode: string; willFail: true };

/** `data-cell` value of a matrix cell; sheets opened from a cell return focus to it. */
export const matrixCellId = (profileRef: string, provider: ClientProfileProvider): string =>
  `${profileRef}:${provider}`;

export type ProfileRow = {
  profile: ClientProfile;
  keyCount: number;
  cells: Record<ClientProfileProvider, PolicyCell>;
  /** Any rule here is Only: while enforcement is off, this profile's keys are rejected. */
  hasOnlyRule: boolean;
};

export const describePolicy = (
  provider: ClientProfileProvider,
  policy: ClientProfilePolicy,
  snapshot: Pick<ClientProfilesSnapshot, 'accounts'>,
  options: {
    reportedState?: ClientProfileTargetState;
    files: AuthFileItem[] | null;
    pool: PoolPreview;
  }
): PolicyCell => {
  if (policy.mode === 'automatic') {
    const pool = options.pool;
    return { kind: 'automatic', provider, pool, willFail: pool.known && !pool.hasParticipants };
  }
  if (policy.mode === 'unknown') {
    return { kind: 'unknown', provider, rawMode: policy.rawMode, willFail: true };
  }
  const matches = snapshot.accounts.filter((account) => account.accountRef === policy.accountRef);
  const account = matches.length === 1 ? matches[0] : null;
  const reported = options.reportedState;
  const state =
    reported && reported !== 'unknown'
      ? reported
      : resolveTargetState(provider, policy, snapshot.accounts);
  return {
    kind: 'only',
    provider,
    accountRef: policy.accountRef,
    account,
    accountLabel: account ? accountDisplayLabel(account, options.files) : null,
    state,
    willFail: isFailingTargetState(state),
  };
};

export const buildProfileRows = (
  snapshot: ClientProfilesSnapshot,
  files: AuthFileItem[] | null,
  strategy: RoutingStrategy | null
): ProfileRow[] => {
  const pools = Object.fromEntries(
    CLIENT_PROFILE_PROVIDERS.map((provider) => [
      provider,
      buildPoolPreview(provider, files, strategy),
    ])
  ) as Record<ClientProfileProvider, PoolPreview>;
  return snapshot.profiles.map((profile) => {
    const cells = Object.fromEntries(
      CLIENT_PROFILE_PROVIDERS.map((provider) => [
        provider,
        describePolicy(provider, profile.policies[provider], snapshot, {
          reportedState: snapshot.targetStates[profile.profileRef]?.[provider],
          files,
          pool: pools[provider],
        }),
      ])
    ) as Record<ClientProfileProvider, PolicyCell>;
    return {
      profile,
      keyCount: snapshot.keys.filter((key) => key.profileRef === profile.profileRef).length,
      cells,
      hasOnlyRule: CLIENT_PROFILE_PROVIDERS.some(
        (provider) => profile.policies[provider].mode !== 'automatic'
      ),
    };
  });
};

/** Profiles with at least one Automatic rule: the clients a shared strategy change affects. */
export const countAutomaticProfiles = (snapshot: ClientProfilesSnapshot | null): number =>
  snapshot
    ? snapshot.profiles.filter((profile) =>
        CLIENT_PROFILE_PROVIDERS.some((provider) => profile.policies[provider].mode === 'automatic')
      ).length
    : 0;

/* ------------------------------------------------------------------ */
/* Editor: Only targets                                                */
/* ------------------------------------------------------------------ */

export type TargetOptionStatus =
  /** Enrolled, supported and available. */
  | 'ready'
  /** Enrolled and supported, but disabled/unavailable: allowed, requests fail until it is back. */
  | 'will_fail'
  /** Not enrolled yet; can be prepared for strict routing in one step. */
  | 'needs_enrollment'
  /** Storage/credential type the backend cannot target. */
  | 'unsupported'
  /** Same account reference on several credentials. */
  | 'ambiguous';

export type TargetOption = {
  account: ClientProfileAccount;
  label: string;
  status: TargetOptionStatus;
  selectable: boolean;
};

export const describeTargetOption = (
  account: ClientProfileAccount,
  accounts: ClientProfileAccount[],
  files: AuthFileItem[] | null
): TargetOption => {
  const label = accountDisplayLabel(account, files);
  let status: TargetOptionStatus;
  if (!account.accountRef) {
    status = account.enrollmentSupported ? 'needs_enrollment' : 'unsupported';
  } else if (accounts.filter((item) => item.accountRef === account.accountRef).length > 1) {
    status = 'ambiguous';
  } else if (!account.targetSupported) {
    status = 'unsupported';
  } else if (!account.available) {
    status = 'will_fail';
  } else {
    status = 'ready';
  }
  return { account, label, status, selectable: status === 'ready' || status === 'will_fail' };
};

export const targetOptionsFor = (
  provider: ClientProfileProvider,
  accounts: ClientProfileAccount[],
  files: AuthFileItem[] | null
): TargetOption[] =>
  accounts
    .filter((account) => account.provider === provider)
    .map((account) => describeTargetOption(account, accounts, files));

/* ------------------------------------------------------------------ */
/* Drafts                                                              */
/* ------------------------------------------------------------------ */

export const toWritablePolicy = (
  policy: ClientProfilePolicy
): WritableClientProfilePolicy | null => (policy.mode === 'unknown' ? null : policy);

/**
 * Complete replacement body for a one-cell edit. Null when the other provider's saved rule
 * cannot be written back unchanged (an unknown persisted mode); the UI then explains it.
 */
export const policiesWithEdit = (
  profile: ClientProfile,
  provider: ClientProfileProvider,
  next: WritableClientProfilePolicy
): WritableClientProfilePolicies | null => {
  const policies = {} as WritableClientProfilePolicies;
  for (const item of CLIENT_PROFILE_PROVIDERS) {
    const policy = item === provider ? next : toWritablePolicy(profile.policies[item]);
    if (!policy) return null;
    policies[item] = policy;
  }
  return policies;
};

export const samePolicy = (a: ClientProfilePolicy, b: ClientProfilePolicy): boolean =>
  a.mode === b.mode && (a.mode !== 'only' || (b.mode === 'only' && a.accountRef === b.accountRef));

export const AUTOMATIC_POLICY: WritableClientProfilePolicy = { mode: 'automatic' };
export const DEFAULT_NEW_PROFILE_POLICIES: WritableClientProfilePolicies = {
  claude: AUTOMATIC_POLICY,
  codex: AUTOMATIC_POLICY,
};

/* ------------------------------------------------------------------ */
/* Accounts → profiles                                                 */
/* ------------------------------------------------------------------ */

export type PinnedProfile = { profile: ClientProfile; provider: ClientProfileProvider };

/** Profiles whose rule for the account's provider is Only this account. */
export const pinnedProfilesFor = (
  account: ClientProfileAccount,
  snapshot: ClientProfilesSnapshot
): PinnedProfile[] => {
  if (!account.accountRef) return [];
  const provider = CLIENT_PROFILE_PROVIDERS.find((item) => item === account.provider);
  if (!provider) return [];
  return snapshot.profiles
    .filter((profile) => {
      const policy = profile.policies[provider];
      return policy.mode === 'only' && policy.accountRef === account.accountRef;
    })
    .map((profile) => ({ profile, provider }));
};

export const isClientProfileProvider = (value: string): value is ClientProfileProvider =>
  (CLIENT_PROFILE_PROVIDERS as readonly string[]).includes(value);

/**
 * Per-profile edits for "Use only this subscription for…": checked profiles become Only this
 * account, unchecked profiles that were pinned to it return to Automatic. Others are untouched.
 */
export const planPinChanges = (
  account: ClientProfileAccount,
  snapshot: ClientProfilesSnapshot,
  checked: ReadonlySet<string>
): Array<{ profile: ClientProfile; policies: WritableClientProfilePolicies | null }> => {
  const provider = CLIENT_PROFILE_PROVIDERS.find((item) => item === account.provider);
  if (!provider || !account.accountRef) return [];
  const accountRef = account.accountRef;
  return snapshot.profiles.flatMap((profile) => {
    const policy = profile.policies[provider];
    const pinned = policy.mode === 'only' && policy.accountRef === accountRef;
    const wantPinned = checked.has(profile.profileRef);
    if (pinned === wantPinned) return [];
    const next: WritableClientProfilePolicy = wantPinned
      ? { mode: 'only', accountRef }
      : AUTOMATIC_POLICY;
    return [{ profile, policies: policiesWithEdit(profile, provider, next) }];
  });
};
