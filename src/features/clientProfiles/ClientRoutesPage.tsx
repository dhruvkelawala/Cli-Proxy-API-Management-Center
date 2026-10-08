import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { IconPlus } from '@/components/ui/icons';
import { usePageTransitionLayer } from '@/components/common/PageTransitionLayer';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { useAuthStore } from '@/stores';
import { useClientProfilesStore } from '@/stores/useClientProfilesStore';
import { gatewayDisplayHost } from '@/utils/connection';
import type { ClientProfileProvider } from '@/types/clientProfiles';
import {
  readConnectionContexts,
  saveConnectionContext,
  type ConnectionContext,
} from './connectionContext';
import { buildPoolPreview, buildProfileRows, countAutomaticProfiles, matrixCellId } from './model';
import { CR } from './copy';
import { useClientRoutesData } from './hooks/useClientRoutesData';
import { ClientRoutesMatrix } from './components/ClientRoutesMatrix';
import { CollapsibleSharedRoutingBand } from './components/CollapsibleSharedRoutingBand';
import { EnforcementNotice, FailureNotice, Notice } from './components/Notices';
import { PolicySheet } from './components/PolicySheet';
import { ProfileSheet } from './components/ProfileSheet';
import styles from './ClientRoutesPage.module.scss';

type SheetState =
  | {
      kind: 'policy';
      profileRef: string;
      provider: ClientProfileProvider;
      open: boolean;
      id: number;
    }
  | { kind: 'profile'; profileRef: string | null; open: boolean; id: number };

let sheetSequence = 0;

/**
 * Client routes: which subscription each client profile may use, per provider.
 * Matrix overview; a cell opens the rule editor; the profile name opens profile & keys.
 */
export function ClientRoutesPage() {
  const { t } = useTranslation();
  const status = useClientProfilesStore((state) => state.status);
  const capabilities = useClientProfilesStore((state) => state.capabilities);
  const snapshot = useClientProfilesStore((state) => state.snapshot);
  const loadFailure = useClientProfilesStore((state) => state.loadFailure);
  const unsupportedReason = useClientProfilesStore((state) => state.unsupportedReason);
  const refreshing = useClientProfilesStore((state) => state.refreshing);
  const load = useClientProfilesStore((state) => state.load);
  const apiBase = useAuthStore((state) => state.apiBase);
  const { files, strategy, apiKeys, wsAuth, refresh } = useClientRoutesData();

  const [contextVersion, setContextVersion] = useState(0);
  const contexts = useMemo(
    () => readConnectionContexts(apiBase),
    // contextVersion re-reads after a local edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [apiBase, contextVersion]
  );
  const handleContextChange = useCallback(
    (profileRef: string, context: ConnectionContext | null) => {
      saveConnectionContext(apiBase, profileRef, context);
      setContextVersion((version) => version + 1);
    },
    [apiBase]
  );

  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [sheetDirty, setSheetDirty] = useState(false);
  const closeSheet = useCallback(() => {
    setSheet((current) => (current ? { ...current, open: false } : current));
    setSheetDirty(false);
  }, []);

  const pageTransitionLayer = usePageTransitionLayer();
  const isCurrentLayer = pageTransitionLayer ? pageTransitionLayer.isCurrentLayer : true;
  const unsavedDialog = useMemo(
    () => ({
      title: t('common.unsaved_changes_title'),
      message: t('common.unsaved_changes_message'),
      confirmText: t('common.confirm'),
      cancelText: t('common.cancel'),
    }),
    [t]
  );
  useUnsavedChangesGuard({
    enabled: isCurrentLayer,
    shouldBlock: sheetDirty,
    dialog: unsavedDialog,
  });
  useHeaderRefresh(refresh, isCurrentLayer);

  const rows = useMemo(
    () => (snapshot ? buildProfileRows(snapshot, files, strategy) : []),
    [files, snapshot, strategy]
  );
  const ready = status === 'ready' && snapshot && capabilities;
  const host = gatewayDisplayHost(apiBase);

  const openCell = (profileRef: string, provider: ClientProfileProvider) =>
    setSheet({ kind: 'policy', profileRef, provider, open: true, id: (sheetSequence += 1) });
  const openProfile = (profileRef: string | null) =>
    setSheet({ kind: 'profile', profileRef, open: true, id: (sheetSequence += 1) });
  /**
   * "Manage profile" from the rule editor (its unsaved-changes check already passed). Focus moves
   * to the originating cell first, so closing the profile sheet returns there rather than to a
   * button in the rule sheet that no longer exists.
   */
  const switchToProfile = (profileRef: string, provider: ClientProfileProvider) => {
    document
      .querySelector<HTMLElement>(`[data-cell="${matrixCellId(profileRef, provider)}"]`)
      ?.focus({ preventScroll: true });
    setSheetDirty(false);
    openProfile(profileRef);
  };
  // The band writes the config file; client profile ETags hash that file, so re-read the list.
  const handleBandConfigWritten = useCallback(() => void load({ fresh: true }), [load]);

  const sheetProfile =
    sheet && sheet.profileRef && snapshot
      ? (snapshot.profiles.find((profile) => profile.profileRef === sheet.profileRef) ?? null)
      : null;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerCopy}>
          <h1 className={styles.title}>{t(`${CR}.title`)}</h1>
          <p className={styles.subtitle}>{t(`${CR}.subtitle`)}</p>
          {host && status !== 'unsupported' && (
            <p className={styles.meta}>{t(`${CR}.gateway`, { host })}</p>
          )}
        </div>
        {ready && (
          <Button onClick={() => openProfile(null)} className={styles.newButton}>
            <IconPlus size={16} aria-hidden="true" />
            {t(`${CR}.new_profile`)}
          </Button>
        )}
      </header>

      {/* Shared load balancing for Automatic rules (CPA-008), collapsed so the matrix leads. */}
      {status !== 'unsupported' && (
        <CollapsibleSharedRoutingBand
          automaticClientCount={snapshot ? countAutomaticProfiles(snapshot) : undefined}
          onConfigWritten={handleBandConfigWritten}
        />
      )}

      {ready && <EnforcementNotice capabilities={capabilities} />}

      {(status === 'idle' || status === 'loading') && (
        <div className={styles.loading} role="status">
          <LoadingSpinner size={18} />
          <span>{t(`${CR}.loading`)}</span>
        </div>
      )}

      {status === 'unsupported' && (
        <Notice title={t(`${CR}.unsupported.title`)}>
          <p>
            {unsupportedReason === 'incompatible_contract'
              ? t(`${CR}.unsupported.incompatible`)
              : t(`${CR}.unsupported.body`)}
          </p>
        </Notice>
      )}

      {status === 'error' && loadFailure && (
        <div className={styles.errorBlock}>
          <FailureNotice failure={loadFailure} title={t(`${CR}.load_error_title`)} />
          <Button variant="secondary" size="sm" onClick={() => void load({ force: true })}>
            {t(`${CR}.retry`)}
          </Button>
        </div>
      )}

      {ready && loadFailure && (
        <FailureNotice
          failure={loadFailure}
          title={t(`${CR}.refresh_error_title`)}
          onReload={() => void load()}
          reloading={refreshing}
        />
      )}

      {ready &&
        (rows.length === 0 ? (
          <EmptyState
            title={t(`${CR}.empty.title`)}
            description={t(`${CR}.empty.body`)}
            action={
              <Button onClick={() => openProfile(null)}>
                <IconPlus size={16} aria-hidden="true" />
                {t(`${CR}.new_profile`)}
              </Button>
            }
          />
        ) : (
          <ClientRoutesMatrix
            rows={rows}
            contexts={contexts}
            onOpenCell={openCell}
            onOpenProfile={openProfile}
          />
        ))}

      {ready && sheet?.kind === 'policy' && (
        <PolicySheet
          key={sheet.id}
          open={sheet.open}
          profile={sheetProfile}
          provider={sheet.provider}
          snapshot={snapshot}
          capabilities={capabilities}
          files={files}
          pool={buildPoolPreview(sheet.provider, files, strategy)}
          context={contexts[sheet.profileRef] ?? null}
          onClose={closeSheet}
          onDirtyChange={setSheetDirty}
          onOpenProfile={() => switchToProfile(sheet.profileRef, sheet.provider)}
        />
      )}
      {ready && sheet?.kind === 'profile' && (
        <ProfileSheet
          key={sheet.id}
          open={sheet.open}
          mode={sheet.profileRef ? 'edit' : 'new'}
          profile={sheetProfile}
          snapshot={snapshot}
          capabilities={capabilities}
          context={sheet.profileRef ? (contexts[sheet.profileRef] ?? null) : null}
          apiKeys={apiKeys}
          wsAuth={wsAuth}
          apiBase={apiBase}
          onContextChange={handleContextChange}
          onClose={closeSheet}
          onDirtyChange={setSheetDirty}
        />
      )}
    </div>
  );
}
