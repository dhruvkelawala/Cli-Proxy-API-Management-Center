import { useCallback, useEffect, useMemo, useState } from 'react';
import { useClientProfilesStore } from '@/stores/useClientProfilesStore';
import type { AuthFileItem } from '@/types';
import { buildAccountClientLinks, type AccountClientLinks } from '../accountLinks';
import { AccountPinSheet } from '../components/AccountPinSheet';
import { deriveAccountTitle } from '@/features/authFiles/identity';

type PinSheetState = { credentialRef: string; label: string; open: boolean; id: number };
let pinSheetSequence = 0;

/**
 * Accounts page integration: per-card client links and the pin sheet. On a gateway without
 * client profiles (Unsupported) or before they load, cards show nothing extra.
 */
export function useAccountClientRoutes(files: AuthFileItem[]) {
  const status = useClientProfilesStore((state) => state.status);
  const snapshot = useClientProfilesStore((state) => state.snapshot);
  const capabilities = useClientProfilesStore((state) => state.capabilities);
  const mutating = useClientProfilesStore((state) => state.mutating);
  const load = useClientProfilesStore((state) => state.load);

  // Re-read the inventory when enablement/availability of listed accounts changes.
  const availabilitySignature = files
    .map(
      (file) =>
        `${String(file.id ?? file.name)}:${file.disabled === true}:${file.unavailable === true}`
    )
    .join('|');
  useEffect(() => {
    void load();
  }, [availabilitySignature, load]);

  const links = useMemo(
    () =>
      status === 'ready' && snapshot
        ? buildAccountClientLinks(files, snapshot)
        : new Map<AuthFileItem, AccountClientLinks>(),
    [files, snapshot, status]
  );

  const [sheet, setSheet] = useState<PinSheetState | null>(null);
  const open = useCallback(
    (file: AuthFileItem) => {
      const link = links.get(file);
      if (!link) return;
      setSheet({
        credentialRef: link.account.credentialRef,
        label: deriveAccountTitle(file).title || file.name,
        open: true,
        id: (pinSheetSequence += 1),
      });
    },
    [links]
  );
  const close = useCallback(
    () => setSheet((current) => (current ? { ...current, open: false } : current)),
    []
  );

  const sheetAccount =
    sheet && snapshot
      ? (snapshot.accounts.find((account) => account.credentialRef === sheet.credentialRef) ?? null)
      : null;
  const sheetProvider = sheetAccount?.provider === 'codex' ? 'codex' : 'claude';

  const element =
    sheet && snapshot && capabilities ? (
      <AccountPinSheet
        key={sheet.id}
        open={sheet.open}
        account={sheetAccount}
        provider={sheetProvider}
        fallbackLabel={sheet.label}
        snapshot={snapshot}
        capabilities={capabilities}
        files={files}
        onClose={close}
      />
    ) : null;

  return {
    linksFor: (file: AuthFileItem) => links.get(file) ?? null,
    open,
    disabled: mutating,
    sheet: element,
  };
}
