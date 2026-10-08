/**
 * Account → client profile links shown on Accounts cards (CPA-005 step 7), from the safe
 * inventory projection. React-free.
 */

import type { AuthFileItem } from '@/types';
import type {
  ClientProfileAccount,
  ClientProfileProvider,
  ClientProfilesSnapshot,
} from '@/types/clientProfiles';
import { credentialRefForAuthFile, isClientProfileProvider, pinnedProfilesFor } from './model';

export type AccountClientLinks = {
  account: ClientProfileAccount;
  provider: ClientProfileProvider;
  /** Profiles whose rule for this provider is Only this account. */
  pinned: Array<{ profileRef: string; label: string }>;
  /** Pinned clients fail while this account is disabled/unavailable; nothing substitutes. */
  willFail: boolean;
  /** What "Use only this subscription for…" leads to. */
  action: 'choose' | 'enroll' | 'unsupported';
};

export const buildAccountClientLinks = (
  files: AuthFileItem[],
  snapshot: ClientProfilesSnapshot
): Map<AuthFileItem, AccountClientLinks> => {
  const byCredential = new Map(
    snapshot.accounts.map((account) => [account.credentialRef, account] as const)
  );
  const links = new Map<AuthFileItem, AccountClientLinks>();
  files.forEach((file) => {
    const ref = credentialRefForAuthFile(file);
    const account = ref ? byCredential.get(ref) : undefined;
    if (!account || !isClientProfileProvider(account.provider)) return;
    const pinned = pinnedProfilesFor(account, snapshot).map(({ profile }) => ({
      profileRef: profile.profileRef,
      label: profile.label,
    }));
    const action = !account.accountRef
      ? account.enrollmentSupported
        ? 'enroll'
        : 'unsupported'
      : account.targetSupported
        ? 'choose'
        : 'unsupported';
    links.set(file, {
      account,
      provider: account.provider,
      pinned,
      willFail: pinned.length > 0 && (!account.available || account.state !== 'available'),
      action,
    });
  });
  return links;
};
