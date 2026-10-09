/**
 * "Clear login data" on the Management Center page: always asks first, and only on confirmation
 * signs out and forgets the saved connection. Dependencies are passed in so the behaviour can be
 * tested without a browser.
 */

import type { TFunction } from 'i18next';
import { STORAGE_KEY_AUTH } from '@/utils/constants';

export const LOGIN_STORAGE_KEYS = [
  STORAGE_KEY_AUTH,
  'isLoggedIn',
  'apiBase',
  'apiUrl',
  'managementKey',
] as const;

export interface ClearLoginDataDeps {
  t: TFunction;
  confirm: (options: {
    title: string;
    message: string;
    variant: 'danger';
    confirmText: string;
    onConfirm: () => void;
  }) => void;
  logout: () => void;
  storage: Pick<Storage, 'removeItem'> | undefined;
  notify: (message: string, type: 'success') => void;
}

export function requestClearLoginData({ t, confirm, logout, storage, notify }: ClearLoginDataDeps) {
  confirm({
    title: t('system_info.clear_login_title', { defaultValue: 'Clear Login Storage' }),
    message: t('system_info.clear_login_confirm'),
    variant: 'danger',
    confirmText: t('common.confirm'),
    onConfirm: () => {
      logout();
      if (!storage) return;
      LOGIN_STORAGE_KEYS.forEach((key) => storage.removeItem(key));
      notify(t('notification.login_storage_cleared'), 'success');
    },
  });
}
