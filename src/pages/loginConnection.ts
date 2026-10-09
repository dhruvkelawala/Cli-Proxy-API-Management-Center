/**
 * Which address the login page connects to, and when it should show the connection details.
 * React-free so the rules can be tested: the address shown is always the address used.
 */

import { LegacyBackendError } from '@/services/api/legacyBackendProbe';
import { isRecord } from '@/utils/helpers';
import { normalizeApiBase } from '@/utils/connection';

/** The address a submit uses: the custom one only while "custom" is ticked and filled in. */
export const resolveLoginBase = (input: {
  custom: boolean;
  customBase: string;
  detectedBase: string;
}): string =>
  input.custom && input.customBase.trim() ? normalizeApiBase(input.customBase) : input.detectedBase;

/** A saved address that is not the page's own starts with "custom" ticked. */
export const startsWithCustomBase = (
  savedBase: string | null | undefined,
  detectedBase: string
) => {
  const saved = normalizeApiBase(savedBase ?? '');
  return Boolean(saved) && saved !== normalizeApiBase(detectedBase);
};

/**
 * Errors that usually mean "wrong address" (unreachable, no v8 API there, an old backend): the
 * page opens its connection details so the address can be checked.
 */
export const isConnectionError = (error: unknown): boolean => {
  if (error instanceof LegacyBackendError) return true;
  if (!isRecord(error)) return false;
  if (error.status === 404) return true;
  const code = typeof error.code === 'string' ? error.code : '';
  const message = typeof error.message === 'string' ? error.message.toLowerCase() : '';
  return code === 'ERR_NETWORK' || message.includes('network error');
};
