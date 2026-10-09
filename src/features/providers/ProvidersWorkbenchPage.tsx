import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePageTransitionLayer } from '@/components/common/PageTransitionLayer';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { Skeleton } from '@/components/ui/Skeleton';
import { useAuthStore, useNotificationStore } from '@/stores';
import { useProviderRecentRequests } from '@/components/providers/hooks/useProviderRecentRequests';
import {
  getOpenAIProviderRecentWindowStats,
  getProviderRecentWindowStats,
  getProviderUsageKey,
  type ProviderRecentUsageMap,
} from '@/components/providers/utils';
import type { OpenAIProviderConfig } from '@/types';
import { ActionMenu, MoreDisclosure, PageHeader } from '@/components/flow';
import flow from '@/components/flow/flowPage.module.scss';
import { IconPlus } from '@/components/ui/icons';
import type { Copy } from '@/features/clientProfiles/routing/routingOrder';
import { buildNameJoiner } from '@/features/clientProfiles/routing/useRoutingOrder';
import { ProviderKeyList } from './components/ProviderKeyList';
import { ProviderLogo } from './components/ProviderLogo';
import { describeProviders, describeQuickStart, splitProviderGroups } from './providersHeadline';
import { ProviderCategoryList } from './components/ProviderCategoryList';
import { ProviderResourcePanel } from './components/ProviderResourcePanel';
import type { ProviderPanelControls } from './components/ProviderResourcePanel';
import { SponsorQuickStartPanel } from './components/SponsorQuickStartPanel';
import { ProviderSheet, type ProviderSheetHandle } from './sheets/ProviderSheet';
import { isMultiProtocolSponsorBrand } from './sponsorDefinitions';
import { isSponsorPartialMutationError } from './sponsorMutationRecovery';
import { useProviderWorkbench } from './useProviderWorkbench';
import {
  getProviderFilterState,
  readProvidersWorkbenchUiState,
  writeProvidersWorkbenchUiState,
  type ProviderFilterState,
  type ProvidersWorkbenchUiState,
} from './uiState';
import type { ProviderBrand, ProviderResource, ProviderSortBy, SortDir } from './types';
import styles from './ProvidersWorkbenchPage.module.scss';

type SheetMode = 'detail' | 'create' | 'edit';

/** Offered as one-click starts while no provider has a key yet. */
const STARTER_BRANDS: ReadonlyArray<ProviderBrand> = [
  'claude',
  'gemini',
  'codex',
  'openaiCompatibility',
];

interface SheetState {
  open: boolean;
  brand: ProviderBrand;
  mode: SheetMode;
  resource: ProviderResource | null;
}

interface ProvidersWorkbenchPageProps {
  fixedBrand?: ProviderBrand;
}

const formatDateTime = (iso: string, locale?: string) => {
  try {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  } catch {
    return iso;
  }
};

const matchesFilter = (r: ProviderResource, normalized: string): boolean => {
  if (!normalized) return true;
  const haystack = [
    r.identifier,
    r.name,
    r.authIndex,
    r.apiKeyPreview,
    r.apiKey,
    r.baseUrl,
    r.proxyUrl,
    r.prefix,
  ]
    .filter(Boolean)
    .map((v) => String(v).toLowerCase());
  return haystack.some((v) => v.includes(normalized));
};

const getResourceSortName = (resource: ProviderResource): string =>
  (resource.name ?? resource.identifier ?? resource.apiKeyPreview ?? '').toLowerCase();

const getResourceRecentSuccess = (
  resource: ProviderResource,
  usageByProvider: ProviderRecentUsageMap
): number => {
  if (isMultiProtocolSponsorBrand(resource.brand)) {
    return 0;
  }
  if (resource.brand === 'openaiCompatibility') {
    return getOpenAIProviderRecentWindowStats(resource.raw as OpenAIProviderConfig, usageByProvider)
      .success;
  }
  return getProviderRecentWindowStats(
    usageByProvider,
    getProviderUsageKey(resource.brand),
    resource.apiKey ?? undefined,
    resource.baseUrl ?? undefined
  ).success;
};

export function ProvidersWorkbenchPage({ fixedBrand }: ProvidersWorkbenchPageProps = {}) {
  const { t, i18n } = useTranslation();
  const connectionStatus = useAuthStore((s) => s.connectionStatus);
  const { showNotification, showConfirmation } = useNotificationStore();

  const pageTransitionLayer = usePageTransitionLayer();
  const isCurrentLayer = pageTransitionLayer ? pageTransitionLayer.status === 'current' : true;

  const workbench = useProviderWorkbench();
  const [uiState, setUiState] = useState<ProvidersWorkbenchUiState>(readProvidersWorkbenchUiState);
  const [sheetState, setSheetState] = useState<SheetState>({
    open: false,
    brand: 'gemini',
    mode: 'detail',
    resource: null,
  });
  const sheetRef = useRef<ProviderSheetHandle>(null);

  const connected = connectionStatus === 'connected';
  const { usageByProvider, refreshRecentRequests } = useProviderRecentRequests({
    enabled: connected,
  });

  const handleRefresh = useCallback(async () => {
    await Promise.allSettled([workbench.refetch(), refreshRecentRequests().catch(() => undefined)]);
  }, [refreshRecentRequests, workbench]);

  useHeaderRefresh(handleRefresh, isCurrentLayer);

  const disableMutations =
    connectionStatus !== 'connected' ||
    workbench.mutating ||
    workbench.isFetching ||
    workbench.isError;

  const persistUiState = useCallback(
    (updater: (prev: ProvidersWorkbenchUiState) => ProvidersWorkbenchUiState) => {
      setUiState((prev) => {
        const next = updater(prev);
        writeProvidersWorkbenchUiState(next);
        return next;
      });
    },
    []
  );

  const setActiveBrand = useCallback(
    (brand: ProviderBrand) => {
      persistUiState((prev) =>
        prev.activeBrand === brand ? prev : { ...prev, activeBrand: brand }
      );
    },
    [persistUiState]
  );

  const allGroups = useMemo(() => workbench.snapshot?.groups ?? [], [workbench.snapshot]);
  const groups = useMemo(
    () =>
      fixedBrand
        ? allGroups.filter((group) => group.id === fixedBrand)
        : allGroups.filter((group) => group.id !== 'apikeyFun'),
    [allGroups, fixedBrand]
  );
  const firstVisibleBrand = groups[0]?.id ?? fixedBrand ?? 'gemini';
  const activeBrand =
    fixedBrand ??
    (groups.some((group) => group.id === uiState.activeBrand)
      ? uiState.activeBrand
      : firstVisibleBrand);
  const activeFilterState = getProviderFilterState(uiState, activeBrand);
  const filter = activeFilterState.filter;
  const providerSortBy = activeFilterState.sortBy;
  const providerSortDir = activeFilterState.sortDir;
  const activeGroup = groups.find((g) => g.id === activeBrand) ?? groups[0] ?? null;

  const updateActiveFilterState = useCallback(
    (patch: Partial<ProviderFilterState>) => {
      persistUiState((prev) => {
        const current = getProviderFilterState(prev, activeBrand);
        return {
          ...prev,
          filtersByBrand: {
            ...prev.filtersByBrand,
            [activeBrand]: {
              ...current,
              ...patch,
            },
          },
        };
      });
    },
    [activeBrand, persistUiState]
  );

  const filteredResources = useMemo(() => {
    if (!activeGroup) return [];
    const normalized = filter.trim().toLowerCase();
    return activeGroup.resources.filter((r) => matchesFilter(r, normalized));
  }, [activeGroup, filter]);

  const availableModels = useMemo(() => {
    if (!activeGroup) return [];
    const seen = new Set<string>();
    activeGroup.resources.forEach((r) => {
      r.models.forEach((name) => seen.add(name));
    });
    return Array.from(seen).sort();
  }, [activeGroup]);

  const selectedModels = useMemo(() => {
    if (availableModels.length === 0) return new Set<string>();
    const availableModelSet = new Set(availableModels);
    return new Set(activeFilterState.selectedModels.filter((name) => availableModelSet.has(name)));
  }, [activeFilterState.selectedModels, availableModels]);

  const visibleResources = useMemo(() => {
    let arr = filteredResources;
    if (selectedModels.size > 0) {
      arr = arr.filter((r) => r.models.some((name) => selectedModels.has(name)));
    }

    const sorted = [...arr].sort((a, b) => {
      const sortDiff =
        providerSortBy === 'name'
          ? getResourceSortName(a).localeCompare(getResourceSortName(b))
          : providerSortBy === 'priority'
            ? a.priority - b.priority
            : getResourceRecentSuccess(a, usageByProvider) -
              getResourceRecentSuccess(b, usageByProvider);
      const diff = sortDiff || a.originalIndex - b.originalIndex;
      return providerSortDir === 'asc' ? diff : -diff;
    });

    return sorted;
  }, [filteredResources, providerSortBy, providerSortDir, selectedModels, usageByProvider]);

  const toolbarControls = useMemo<ProviderPanelControls | undefined>(() => {
    if (!activeGroup) return undefined;
    return {
      sortBy: providerSortBy,
      sortDir: providerSortDir,
      onSortBy: (value: ProviderSortBy) => updateActiveFilterState({ sortBy: value }),
      onSortDir: (value: SortDir) => updateActiveFilterState({ sortDir: value }),
      availableModels,
      selectedModels,
      onSelectedModelsChange: (next) =>
        updateActiveFilterState({
          selectedModels: Array.from(next).sort((a, b) => a.localeCompare(b)),
        }),
    };
  }, [
    activeGroup,
    availableModels,
    providerSortBy,
    providerSortDir,
    selectedModels,
    updateActiveFilterState,
  ]);

  const quickStartResource = useMemo(
    () => (fixedBrand === 'apikeyFun' && activeGroup ? (activeGroup.resources[0] ?? null) : null),
    [activeGroup, fixedBrand]
  );

  const updatedAtLabel = workbench.snapshot
    ? formatDateTime(workbench.snapshot.fetchedAt, i18n.language)
    : t('providersPage.modelCatalog.notLoaded');
  const locale = i18n.language || 'en';
  const join = useMemo(() => buildNameJoiner(locale), [locale]);
  const text = (copy: Copy | null) => (copy ? t(copy.key, copy.values) : undefined);
  const { configured: configuredGroups, empty: emptyGroups } = useMemo(
    () => splitProviderGroups(groups),
    [groups]
  );
  const quickStartName = t('providersPage.providerNames.apikeyFun');
  const headline =
    fixedBrand === 'apikeyFun'
      ? describeQuickStart({
          name: quickStartName,
          resource: quickStartResource,
          loading: workbench.isPending,
          failed: workbench.isError,
        })
      : describeProviders({
          groups: workbench.snapshot ? groups : null,
          loading: workbench.isPending,
          failed: workbench.isError,
          nameOf: (brand) => t(`providersPage.providerNames.${brand}`),
          join,
        });
  const errorBanner = workbench.errorMessage ? (
    <p className={flow.note} data-tone="bad" role="alert">
      {workbench.errorMessage}
    </p>
  ) : null;

  const openCreate = useCallback(
    (brand: ProviderBrand = activeBrand) => {
      if (brand !== activeBrand) setActiveBrand(brand);
      setSheetState({ open: true, brand, mode: 'create', resource: null });
    },
    [activeBrand, setActiveBrand]
  );

  const openView = useCallback((resource: ProviderResource) => {
    setSheetState({
      open: true,
      brand: resource.brand,
      mode: 'detail',
      resource,
    });
  }, []);

  const openEdit = useCallback((resource: ProviderResource) => {
    setSheetState({
      open: true,
      brand: resource.brand,
      mode: 'edit',
      resource,
    });
  }, []);

  const closeSheet = useCallback(() => {
    setSheetState((s) => ({ ...s, open: false }));
  }, []);

  const handleDelete = useCallback(
    (resource: ProviderResource) => {
      const name = resource.name ?? resource.apiKeyPreview ?? resource.identifier ?? '';
      showConfirmation({
        title: t('providersPage.delete.title'),
        message: t('providersPage.delete.confirm', { name }),
        variant: 'danger',
        confirmText: t('providersPage.actions.delete'),
        onConfirm: async () => {
          try {
            await workbench.deleteProvider(resource);
            showNotification(t('providersPage.toast.deleted'), 'success');
          } catch (err) {
            if (isSponsorPartialMutationError(err)) {
              showNotification(t('providersPage.sponsor.partialMutationWarning'), 'warning');
              return;
            }
            const msg = err instanceof Error ? err.message : String(err);
            showNotification(`${t('notification.delete_failed')}: ${msg}`, 'error');
          }
        },
      });
    },
    [showConfirmation, showNotification, t, workbench]
  );

  const handleToggleDisabled = useCallback(
    async (resource: ProviderResource, disabled: boolean) => {
      try {
        await workbench.toggleDisabled(resource, disabled);
        showNotification(
          disabled ? t('providersPage.toast.disabled') : t('providersPage.toast.enabled'),
          'success'
        );
      } catch (err) {
        if (isSponsorPartialMutationError(err)) {
          showNotification(t('providersPage.sponsor.partialMutationWarning'), 'warning');
          return;
        }
        const msg = err instanceof Error ? err.message : String(err);
        showNotification(`${t('providersPage.toast.toggleFailed')}: ${msg}`, 'error');
      }
    },
    [showNotification, t, workbench]
  );

  const handleCreated = useCallback(() => {
    showNotification(t('providersPage.toast.created'), 'success');
    closeSheet();
  }, [closeSheet, showNotification, t]);

  const handleUpdated = useCallback(() => {
    showNotification(t('providersPage.toast.updated'), 'success');
    closeSheet();
  }, [closeSheet, showNotification, t]);

  const selectBrand = (brand: ProviderBrand) => {
    const isSwitching = sheetState.open && sheetState.brand !== brand;
    const proceed =
      isSwitching && sheetRef.current
        ? sheetRef.current.confirmDiscardIfDirty()
        : Promise.resolve(true);
    void proceed.then((ok) => {
      if (!ok) return;
      setActiveBrand(brand);
      if (isSwitching) {
        closeSheet();
      }
    });
  };

  const header = (
    <PageHeader
      eyebrow={fixedBrand === 'apikeyFun' ? t('nav.quick_start') : t('providersPage.flow.eyebrow')}
      title={text(headline.title)}
      subtitle={text(headline.subtitle)}
      live
      actions={
        fixedBrand ? undefined : (
          <ActionMenu
            variant="primary"
            disabled={disableMutations || groups.length === 0}
            items={groups.map((group) => ({
              id: group.id,
              label: t(`providersPage.providerNames.${group.id}`),
              icon: <ProviderLogo brand={group.id} size={16} />,
              onSelect: () => openCreate(group.id),
            }))}
          >
            <IconPlus size={15} aria-hidden="true" />
            {t('providersPage.flow.add_key')}
          </ActionMenu>
        )
      }
    />
  );

  const refreshLine = (
    <p className={flow.actions}>
      <span>{t('providersPage.flow.updated', { time: updatedAtLabel })}</span>
      <button
        type="button"
        className={flow.textButton}
        onClick={() => void handleRefresh()}
        disabled={workbench.isFetching}
      >
        {workbench.isFetching
          ? t('providersPage.actions.syncing')
          : t('providersPage.actions.refresh')}
      </button>
    </p>
  );

  // 加载状态
  if (!workbench.snapshot && workbench.isPending) {
    return (
      <div className={flow.page}>
        {header}
        <div className={flow.lead}>
          <Skeleton height={160} />
        </div>
      </div>
    );
  }

  if (!activeGroup) {
    return (
      <div className={flow.page}>
        {header}
        {errorBanner}
        <div className={flow.moreWrap}>{refreshLine}</div>
      </div>
    );
  }

  if (fixedBrand === 'apikeyFun') {
    return (
      <div className={flow.page}>
        {header}
        {errorBanner}
        <div className={flow.lead}>
          <SponsorQuickStartPanel
            resource={quickStartResource}
            workbench={workbench}
            mutationDisabled={disableMutations}
          />
        </div>
        <div className={flow.moreWrap}>
          <MoreDisclosure
            label={t('providersPage.flow.more')}
            summary={t('providersPage.flow.updated', { time: updatedAtLabel })}
          >
            <div className={flow.moreBody}>
              <section className={flow.moreSection}>
                <h3 className={flow.sectionLabel}>{t('providersPage.flow.sync_title')}</h3>
                <p className={flow.quiet}>{t('providersPage.flow.sync_hint')}</p>
                {refreshLine}
              </section>
            </div>
          </MoreDisclosure>
        </div>
      </div>
    );
  }

  const startBrands = emptyGroups.filter((group) => STARTER_BRANDS.includes(group.id)).slice(0, 4);

  return (
    <div className={flow.page}>
      {header}

      {errorBanner}

      <div className={flow.lead}>
        {configuredGroups.length > 0 ? (
          <ProviderKeyList
            groups={configuredGroups}
            selectedId={sheetState.open ? (sheetState.resource?.id ?? null) : null}
            disableMutations={disableMutations}
            onView={openView}
            onEdit={openEdit}
            onDelete={handleDelete}
            onToggleDisabled={handleToggleDisabled}
            onAdd={(brand) => openCreate(brand)}
          />
        ) : (
          <p className={flow.actions}>
            <span>{t('providersPage.flow.start_with')}</span>
            {startBrands.map((group) => (
              <button
                key={group.id}
                type="button"
                className={flow.textButton}
                disabled={disableMutations}
                onClick={() => openCreate(group.id)}
              >
                {t(`providersPage.providerNames.${group.id}`)}
              </button>
            ))}
          </p>
        )}
      </div>

      <div className={flow.moreWrap}>
        <MoreDisclosure
          label={t('providersPage.flow.more_all')}
          summary={t(
            configuredGroups.length === 0
              ? 'providersPage.flow.more_summary_none'
              : 'providersPage.flow.more_summary',
            { count: groups.length, empty: emptyGroups.length }
          )}
        >
          <div className={flow.moreBody}>
            <section className={flow.moreSection}>
              <p className={flow.quiet}>{t('providersPage.flow.browse_hint')}</p>
              <div className={styles.browse}>
                <ProviderCategoryList
                  groups={groups}
                  activeBrand={activeGroup.id}
                  onSelect={selectBrand}
                />
                <ProviderResourcePanel
                  group={activeGroup}
                  filter={filter}
                  onFilterChange={(value) => updateActiveFilterState({ filter: value })}
                  filteredResources={visibleResources}
                  selectedId={sheetState.open ? (sheetState.resource?.id ?? null) : null}
                  disableMutations={disableMutations}
                  usageByProvider={usageByProvider}
                  toolbarControls={toolbarControls}
                  onView={openView}
                  onEdit={openEdit}
                  onDelete={handleDelete}
                  onToggleDisabled={handleToggleDisabled}
                  onCreate={() => openCreate()}
                />
              </div>
            </section>
            <section className={flow.moreSection}>
              <h3 className={flow.sectionLabel}>{t('providersPage.flow.sync_title')}</h3>
              <p className={flow.quiet}>{t('providersPage.flow.sync_hint')}</p>
              {refreshLine}
            </section>
          </div>
        </MoreDisclosure>
      </div>

      <ProviderSheet
        ref={sheetRef}
        state={sheetState}
        onClose={closeSheet}
        onSwitchToEdit={() => {
          setSheetState((s) => (s.resource ? { ...s, mode: 'edit' } : s));
        }}
        workbench={workbench}
        onCreated={handleCreated}
        onUpdated={handleUpdated}
        mutationDisabled={disableMutations}
        usageByProvider={usageByProvider}
      />
    </div>
  );
}
