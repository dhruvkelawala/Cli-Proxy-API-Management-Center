/**
 * Configured connection context for a client profile: how that client reaches the gateway.
 *
 * The backend has no field for this, so it is an operator note kept in this browser per
 * gateway (like API key names). It describes configured topology, never live health: a
 * MacBook entry does not prove the tunnel is up. Unset stays "not set".
 */

import { obfuscatedStorage } from '@/services/storage/secureStorage';

export const CONNECTION_CONTEXTS = ['mini_local', 'macbook_tunnel'] as const;
export type ConnectionContext = (typeof CONNECTION_CONTEXTS)[number];

const STORAGE_PREFIX = 'client-profile-context:v1:';

const isConnectionContext = (value: unknown): value is ConnectionContext =>
  typeof value === 'string' && (CONNECTION_CONTEXTS as readonly string[]).includes(value);

export function readConnectionContexts(apiBase: string): Record<string, ConnectionContext> {
  try {
    const stored = obfuscatedStorage.getItem<unknown>(STORAGE_PREFIX + apiBase);
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
    return Object.fromEntries(
      Object.entries(stored).filter((entry): entry is [string, ConnectionContext] =>
        isConnectionContext(entry[1])
      )
    );
  } catch {
    return {};
  }
}

/** Merge with current storage so another tab's notes are not discarded. */
export function saveConnectionContext(
  apiBase: string,
  profileRef: string,
  context: ConnectionContext | null
): boolean {
  try {
    const contexts = new Map(Object.entries(readConnectionContexts(apiBase)));
    if (context) contexts.set(profileRef, context);
    else contexts.delete(profileRef);
    if (contexts.size) {
      obfuscatedStorage.setItem(STORAGE_PREFIX + apiBase, Object.fromEntries(contexts));
    } else {
      obfuscatedStorage.removeItem(STORAGE_PREFIX + apiBase);
    }
    return true;
  } catch {
    return false;
  }
}
