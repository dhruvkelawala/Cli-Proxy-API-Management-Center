import { DEFAULT_API_PORT, MANAGEMENT_API_PREFIX } from './constants';

export const normalizeApiBase = (input: string): string => {
  let base = (input || '').trim();
  if (!base) return '';
  base = base.replace(/\/+$/i, '');
  base = base.replace(/\/v8\/management$/i, '');
  if (!/^https?:\/\//i.test(base)) {
    base = `http://${base}`;
  }
  return base;
};

/**
 * Host[:port] of the configured management base, for display only.
 * Never includes credentials, paths or query strings from the configured URL.
 */
export const gatewayDisplayHost = (apiBase: string): string => {
  const normalized = normalizeApiBase(apiBase);
  if (!normalized) return '';
  try {
    return new URL(normalized).host;
  } catch {
    return '';
  }
};

export const computeApiUrl = (base: string): string => {
  const normalized = normalizeApiBase(base);
  if (!normalized) return '';
  return `${normalized}${MANAGEMENT_API_PREFIX}`;
};

export const detectApiBaseFromLocation = (): string => {
  try {
    const { protocol, hostname, port } = window.location;
    const normalizedPort = port ? `:${port}` : '';
    return normalizeApiBase(`${protocol}//${hostname}${normalizedPort}`);
  } catch (error) {
    console.warn('Failed to detect api base from location, fallback to default', error);
    return normalizeApiBase(`http://localhost:${DEFAULT_API_PORT}`);
  }
};
