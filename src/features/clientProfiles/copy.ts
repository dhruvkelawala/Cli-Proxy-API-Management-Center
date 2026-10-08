/**
 * i18n key selection for client routes. Policy explanations live beside the model that owns
 * them; components only pick keys from here so wording stays consistent across views.
 */

import type { TFunction } from 'i18next';
import type { ClientProfilesFailure } from '@/stores/useClientProfilesStore';
import {
  CLIENT_PROFILE_PROVIDERS,
  type ClientProfileProvider,
  type ClientProfileTargetState,
} from '@/types/clientProfiles';
import type { PolicyCell } from './model';

export const CR = 'client_routes';

export const targetStateKey = (state: ClientProfileTargetState): string => `${CR}.states.${state}`;

export const failureKey = (failure: Pick<ClientProfilesFailure, 'kind'>): string =>
  `${CR}.errors.${failure.kind}`;

/**
 * Provider whose rule the gateway rejected. ValidateTargets re-checks every Only rule on a
 * save and reports the failing one as `field: "policies.<provider>"`.
 */
export const failureProvider = (
  failure: Pick<ClientProfilesFailure, 'error'>
): ClientProfileProvider | null => {
  const match = /^policies\.(.+)$/.exec(failure.error.field ?? '');
  const provider = match?.[1];
  return provider && (CLIENT_PROFILE_PROVIDERS as readonly string[]).includes(provider)
    ? (provider as ClientProfileProvider)
    : null;
};

/** Failures where re-reading the gateway state is the right next step. */
export const failureOffersReload = (failure: Pick<ClientProfilesFailure, 'kind'>): boolean =>
  [
    'stale',
    'reload_pending',
    'not_found',
    'key_missing',
    'key_linked',
    'already_enrolled',
    'credential_changed',
    'target_invalid',
  ].includes(failure.kind);

export const providerLabelKey = (provider: string): string => `${CR}.providers.${provider}`;

/** Plain-text summary of a rule, used for the cell's accessible name. */
export const describeCellText = (t: TFunction, cell: PolicyCell): string => {
  if (cell.kind === 'unknown') {
    return `${t(`${CR}.pill.unknown_rule`)}, ${t(`${CR}.pill.will_fail`)}`;
  }
  if (cell.kind === 'only') {
    const name = cell.accountLabel ?? t(`${CR}.pill.removed_account`);
    const only = t(`${CR}.pill.only`, { account: name });
    return cell.willFail
      ? `${only}, ${t(`${CR}.pill.will_fail`)}: ${t(targetStateKey(cell.state))}`
      : `${only}, ${
          cell.state === 'available'
            ? t(`${CR}.pill.available`)
            : t(`${CR}.pill.availability_unknown`)
        }`;
  }
  const automatic = t(`${CR}.pill.automatic`);
  if (cell.willFail)
    return `${automatic}, ${t(`${CR}.pill.will_fail`)}: ${t(`${CR}.pill.pool_empty`)}`;
  return cell.pool.known ? automatic : `${automatic}, ${t(`${CR}.pill.pool_unknown`)}`;
};
