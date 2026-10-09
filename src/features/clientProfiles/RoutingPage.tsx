import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { MoreDisclosure, PageHeader } from '@/components/flow';
import { usePageTransitionLayer } from '@/components/common/PageTransitionLayer';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { useAuthStore } from '@/stores';
import { useClientProfilesStore } from '@/stores/useClientProfilesStore';
import {
  SharedRoutingBand,
  type SharedRoutingBandState,
} from '@/features/config/routing/SharedRoutingBand';
import { CLIENT_PROFILE_PROVIDERS, type ClientProfileProvider } from '@/types/clientProfiles';
import {
  readConnectionContexts,
  saveConnectionContext,
  type ConnectionContext,
} from './connectionContext';
import { buildPoolPreview, countAutomaticProfiles, matrixCellId } from './model';
import { CR } from './copy';
import {
  isSharedBandForcedOpen,
  sharedBandSaveFinished,
  sharedBandSummaryParts,
} from './sharedBand';
import { FailureNotice } from './components/Notices';
import { QuietNotice } from './routing/QuietNotice';
import { PolicySheet } from './components/PolicySheet';
import { ProfileSheet } from './components/ProfileSheet';
import { RoutingSection } from './routing/RoutingSection';
import { RoutingMore } from './routing/RoutingMore';
import {
  describeClientRoutes,
  describeServing,
  profilesSupportNoticeKey,
} from './routing/routingOrder';
import { useRoutingOrder } from './routing/useRoutingOrder';
import styles from './routing/RoutingPage.module.scss';

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

/** No accounts at all: the page-level "nothing to route yet" sentence. */
const EMPTY_MODEL = {
  order: [],
  off: [],
  serving: [],
  sameLevel: true,
  shared: false,
  tie: false,
} satisfies Parameters<typeof describeServing>[0];

/**
 * Routing (#/client-routes): one section per provider that has accounts (Claude, then Codex,
 * then the rest): who goes first, who is the backup, and whether every client follows that
 * order. Reordering writes real account priorities. Rare settings (shared
 * strategy, session affinity, weights, per-client locks, client keys) live under one More.
 */
export function RoutingPage() {
  const { t } = useTranslation();
  const status = useClientProfilesStore((state) => state.status);
  const capabilities = useClientProfilesStore((state) => state.capabilities);
  const snapshot = useClientProfilesStore((state) => state.snapshot);
  const loadFailure = useClientProfilesStore((state) => state.loadFailure);
  const refreshing = useClientProfilesStore((state) => state.refreshing);
  const load = useClientProfilesStore((state) => state.load);
  const apiBase = useAuthStore((state) => state.apiBase);
  const routing = useRoutingOrder();
  const { files, strategy, apiKeys, wsAuth, refresh, sections, filesFailed, reloadFiles } = routing;
  const unsupportedReason = useClientProfilesStore((state) => state.unsupportedReason);

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

  // Shared band (strategy / session affinity) inside More: forced open while it needs attention.
  const [bandState, setBandState] = useState<SharedRoutingBandState | null>(null);
  const previousBandState = useRef<SharedRoutingBandState | null>(null);
  const handleBandState = useCallback(
    (next: SharedRoutingBandState) => {
      // A finished save may have written the config file; client profile ETags hash that file.
      if (sharedBandSaveFinished(previousBandState.current, next)) void load({ fresh: true });
      previousBandState.current = next;
      setBandState(next);
    },
    [load]
  );

  useUnsavedChangesGuard({
    enabled: isCurrentLayer,
    shouldBlock: sheetDirty || Boolean(bandState?.dirty),
    dialog: unsavedDialog,
  });
  useHeaderRefresh(refresh, isCurrentLayer);

  const profilesReady = status === 'ready' && snapshot !== null && capabilities !== null;
  const enforced = capabilities ? capabilities.enforcement : null;
  // Each section's clients line, from each profile's rule for that provider.
  const routesFor = useCallback(
    (provider: string, accounts: Parameters<typeof describeClientRoutes>[2]) =>
      profilesReady && snapshot
        ? describeClientRoutes(snapshot, provider, accounts, enforced)
        : null,
    [enforced, profilesReady, snapshot]
  );
  // More's per-client rules: resolved even when the Accounts list failed, so clients and keys
  // stay usable.
  const claudeSection = sections?.find((section) => section.provider === 'claude');
  const routes = useMemo(
    () =>
      routesFor(
        'claude',
        claudeSection ? [...claudeSection.model.order, ...claudeSection.model.off] : []
      ),
    [claudeSection, routesFor]
  );
  const hasLockedRule = Boolean(
    snapshot?.profiles.some((profile) =>
      CLIENT_PROFILE_PROVIDERS.some((provider) => profile.policies[provider].mode !== 'automatic')
    )
  );

  const openRule = (profileRef: string, provider: ClientProfileProvider) =>
    setSheet({ kind: 'policy', profileRef, provider, open: true, id: (sheetSequence += 1) });
  const openProfile = (profileRef: string | null) =>
    setSheet({ kind: 'profile', profileRef, open: true, id: (sheetSequence += 1) });
  /**
   * "Manage profile" from the rule editor (its unsaved-changes check already passed). Focus
   * moves to the originating Change button first, so closing the profile sheet returns there.
   */
  const switchToProfile = (profileRef: string, provider: ClientProfileProvider) => {
    document
      .querySelector<HTMLElement>(`[data-cell="${matrixCellId(profileRef, provider)}"]`)
      ?.focus({ preventScroll: true });
    setSheetDirty(false);
    openProfile(profileRef);
  };

  const sheetProfile =
    sheet && sheet.profileRef && snapshot
      ? (snapshot.profiles.find((profile) => profile.profileRef === sheet.profileRef) ?? null)
      : null;

  const moreSummary = bandState?.saved
    ? sharedBandSummaryParts(t, bandState).slice(1).join(' · ')
    : undefined;

  const supportNotice = profilesSupportNoticeKey(status, unsupportedReason);
  // Main-view notices, kept quiet: problems and the not-enforced warning when it matters.
  const notices = (
    <>
      {filesFailed && (
        <QuietNotice tone="danger">
          <span>{t('routing.accounts_failed')}</span>
          <button type="button" className={styles.textButton} onClick={() => void reloadFiles()}>
            {t(`${CR}.retry`)}
          </button>
        </QuietNotice>
      )}
      {supportNotice && <QuietNotice>{t(supportNotice)}</QuietNotice>}
      {status === 'error' && loadFailure && (
        <div className={styles.errorBlock}>
          <FailureNotice failure={loadFailure} title={t(`${CR}.load_error_title`)} />
          <Button variant="secondary" size="sm" onClick={() => void load({ force: true })}>
            {t(`${CR}.retry`)}
          </Button>
        </div>
      )}
      {profilesReady && loadFailure && (
        <FailureNotice
          failure={loadFailure}
          title={t(`${CR}.refresh_error_title`)}
          onReload={() => void load()}
          reloading={refreshing}
        />
      )}
      {profilesReady && enforced === false && (
        <QuietNotice tone={hasLockedRule ? 'warn' : 'info'}>
          {t(`${CR}.enforcement.short`)}
        </QuietNotice>
      )}
    </>
  );

  return (
    <div className={styles.page}>
      {sections === null ? (
        !filesFailed && (
          <div className={styles.loading} role="status">
            <LoadingSpinner size={18} />
            <span>{t('routing.loading')}</span>
          </div>
        )
      ) : sections.length === 0 ? (
        <PageHeader
          title={t(describeServing(EMPTY_MODEL, routing.joinNames, routing.formatWhen).title.key)}
          subtitle={t('routing.follow_empty')}
        />
      ) : (
        sections.map((section, index) => (
          <RoutingSection
            key={section.provider}
            provider={section.provider}
            name={section.name}
            primary={index === 0}
            model={section.model}
            routes={routesFor(section.provider, [...section.model.order, ...section.model.off])}
            hubLabel={t('routing.hub')}
            saving={section.saving}
            simulateOut={section.simulateOut}
            formatWhen={routing.formatWhen}
            joinNames={routing.joinNames}
            onReorder={(ids) => void routing.setOrder(section.provider, ids)}
            onPreview={(accountId) => routing.setPreview(section.provider, accountId)}
          />
        ))
      )}
      <div className={styles.notices}>{notices}</div>

      <div className={styles.moreWrap}>
        <MoreDisclosure
          label={t('routing.more')}
          summary={moreSummary}
          forcedOpen={isSharedBandForcedOpen(bandState)}
          forcedNote={t(`${CR}.shared_band.locked`)}
        >
          <RoutingMore
            band={
              <SharedRoutingBand
                automaticClientCount={snapshot ? countAutomaticProfiles(snapshot) : undefined}
                onStateChange={handleBandState}
              />
            }
            routes={profilesReady ? (routes ?? []) : null}
            snapshot={snapshot}
            files={files}
            onEditRule={openRule}
            onOpenProfile={openProfile}
          />
        </MoreDisclosure>
      </div>

      {profilesReady && snapshot && capabilities && sheet?.kind === 'policy' && (
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
      {profilesReady && snapshot && capabilities && sheet?.kind === 'profile' && (
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
