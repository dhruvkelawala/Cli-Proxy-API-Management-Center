import { useEffect, useState } from 'react';
import { apiClient } from '@/services/api/client';
import { clientProfilesApi } from '@/services/api/clientProfiles';

/**
 * Fingerprints of client keys already linked to any profile; null while unknown (the gateway
 * still rejects a duplicate association). Associations change with every profile/key write, so
 * they are re-read with each list revision. Results from a previous connection are dropped.
 */
export function useLinkedKeyFingerprints(revision: string): ReadonlySet<string> | null {
  const [linked, setLinked] = useState<ReadonlySet<string> | null>(null);
  useEffect(() => {
    let cancelled = false;
    const connection = apiClient.getConnectionRevision();
    clientProfilesApi
      .linkedKeyFingerprints()
      .then((next) => {
        if (!cancelled && connection === apiClient.getConnectionRevision()) setLinked(next);
      })
      .catch(() => {
        if (!cancelled) setLinked(null);
      });
    return () => {
      cancelled = true;
    };
  }, [revision]);
  return linked;
}
