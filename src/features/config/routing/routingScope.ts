import type { TFunction } from 'i18next';

const ROOT = 'config_management.routing_settings';

/** Scope notice beside the strategy save. Global: every Automatic client on the shared gateway. */
export const bandScopeText = (t: TFunction, automaticClientCount?: number): string =>
  automaticClientCount === undefined
    ? t(`${ROOT}.scope`)
    : t(`${ROOT}.scope_count`, { count: automaticClientCount });

/** Scope notice beside the account save. The count is an upper bound for those accounts. */
export const accountsScopeText = (t: TFunction, automaticClientCount?: number): string =>
  automaticClientCount === undefined
    ? t(`${ROOT}.sheet.scope`)
    : t(`${ROOT}.sheet.scope_count`, { count: automaticClientCount });
