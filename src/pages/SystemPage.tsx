import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreDisclosure, PageHeader, StatusDot } from '@/components/flow';
import flow from '@/components/flow/flowPage.module.scss';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { IconExternalLink } from '@/components/ui/icons';
import {
  useAuthStore,
  useConfigStore,
  useNotificationStore,
  useModelsStore,
  useThemeStore,
} from '@/stores';
import { configApi, versionApi } from '@/services/api';
import { useApiKeysForModels } from '@/hooks/useApiKeysForModels';
import { formatDateTimeValue } from '@/utils/format';
import { classifyModels } from '@/utils/models';
import iconGemini from '@/assets/icons/gemini.svg';
import iconClaude from '@/assets/icons/claude.svg';
import iconMeta from '@/assets/icons/meta.svg';
import iconDevinLight from '@/assets/icons/devin.svg';
import iconDevinDark from '@/assets/icons/devin-dark.svg';
import iconOpenaiLight from '@/assets/icons/openai-light.svg';
import iconOpenaiDark from '@/assets/icons/openai-dark.svg';
import iconQwen from '@/assets/icons/qwen.svg';
import iconKimiLight from '@/assets/icons/kimi-light.svg';
import iconKimiDark from '@/assets/icons/kimi-dark.svg';
import iconGlm from '@/assets/icons/glm.svg';
import iconGrok from '@/assets/icons/grok.svg';
import iconGrokDark from '@/assets/icons/grok-dark.svg';
import iconDeepseek from '@/assets/icons/deepseek.svg';
import iconMinimax from '@/assets/icons/minimax.svg';
import { requestClearLoginData } from './clearLoginData';
import { compareVersions, describeSystem, type LatestCheck } from './systemHeadline';
import styles from './SystemPage.module.scss';

const MODEL_CATEGORY_ICONS: Record<string, string | { light: string; dark: string }> = {
  devin: { light: iconDevinLight, dark: iconDevinDark },
  gpt: { light: iconOpenaiLight, dark: iconOpenaiDark },
  claude: iconClaude,
  meta: iconMeta,
  gemini: iconGemini,
  qwen: iconQwen,
  kimi: { light: iconKimiDark, dark: iconKimiLight },
  glm: iconGlm,
  grok: { light: iconGrok, dark: iconGrokDark },
  deepseek: iconDeepseek,
  minimax: iconMinimax,
};

export function SystemPage() {
  const { t, i18n } = useTranslation();
  const { showNotification, showConfirmation } = useNotificationStore();
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const auth = useAuthStore();
  const config = useConfigStore((state) => state.config);
  const fetchConfig = useConfigStore((state) => state.fetchConfig);
  const clearCache = useConfigStore((state) => state.clearCache);
  const updateConfigValue = useConfigStore((state) => state.updateConfigValue);

  const models = useModelsStore((state) => state.models);
  const modelsLoading = useModelsStore((state) => state.loading);
  const modelsError = useModelsStore((state) => state.error);
  const fetchModelsFromStore = useModelsStore((state) => state.fetchModels);

  const [modelStatus, setModelStatus] = useState<{
    type: 'success' | 'warning' | 'error' | 'muted';
    message: string;
  }>();
  const [requestLogModalOpen, setRequestLogModalOpen] = useState(false);
  const [requestLogDraft, setRequestLogDraft] = useState(false);
  const [requestLogTouched, setRequestLogTouched] = useState(false);
  const [requestLogSaving, setRequestLogSaving] = useState(false);
  const [checkingVersion, setCheckingVersion] = useState(false);
  const [latestCheck, setLatestCheck] = useState<LatestCheck | null>(null);

  const versionTapCount = useRef(0);
  const versionTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const otherLabel = useMemo(
    () => (i18n.language?.toLowerCase().startsWith('zh') ? '其他' : 'Other'),
    [i18n.language]
  );
  const groupedModels = useMemo(() => classifyModels(models, { otherLabel }), [models, otherLabel]);
  const requestLogEnabled = config?.requestLog ?? false;
  const requestLogDirty = requestLogDraft !== requestLogEnabled;
  const canEditRequestLog = auth.connectionStatus === 'connected' && Boolean(config);

  const appVersion = __APP_VERSION__ || t('system_info.version_unknown');
  const apiVersion = auth.serverVersion || t('system_info.version_unknown');
  const buildTime =
    formatDateTimeValue(auth.serverBuildDate, i18n.language) || t('system_info.version_unknown');

  const getIconForCategory = (categoryId: string): string | null => {
    const iconEntry = MODEL_CATEGORY_ICONS[categoryId];
    if (!iconEntry) return null;
    if (typeof iconEntry === 'string') return iconEntry;
    return resolvedTheme === 'dark' ? iconEntry.dark : iconEntry.light;
  };

  const resolveApiKeysForModels = useApiKeysForModels();

  const fetchModels = async ({ forceRefresh = false }: { forceRefresh?: boolean } = {}) => {
    if (auth.connectionStatus !== 'connected') {
      setModelStatus({
        type: 'warning',
        message: t('notification.connection_required'),
      });
      return;
    }

    if (!auth.apiBase) {
      showNotification(t('notification.connection_required'), 'warning');
      return;
    }

    setModelStatus({ type: 'muted', message: t('system_info.models_loading') });
    try {
      const apiKeys = await resolveApiKeysForModels({ force: forceRefresh });
      const primaryKey = apiKeys[0];
      const list = await fetchModelsFromStore(auth.apiBase, primaryKey, forceRefresh);
      const hasModels = list.length > 0;
      setModelStatus({
        type: hasModels ? 'success' : 'warning',
        message: hasModels
          ? t('system_info.models_count', { count: list.length })
          : t('system_info.models_empty'),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
      const suffix = message ? `: ${message}` : '';
      const text = `${t('system_info.models_error')}${suffix}`;
      setModelStatus({ type: 'error', message: text });
    }
  };

  const handleClearLoginStorage = () =>
    requestClearLoginData({
      t,
      confirm: showConfirmation,
      logout: auth.logout,
      storage: typeof localStorage === 'undefined' ? undefined : localStorage,
      notify: showNotification,
    });

  const openRequestLogModal = useCallback(() => {
    setRequestLogTouched(false);
    setRequestLogDraft(requestLogEnabled);
    setRequestLogModalOpen(true);
  }, [requestLogEnabled]);

  const handleInfoVersionTap = useCallback(() => {
    versionTapCount.current += 1;
    if (versionTapTimer.current) {
      clearTimeout(versionTapTimer.current);
    }

    if (versionTapCount.current >= 7) {
      versionTapCount.current = 0;
      versionTapTimer.current = null;
      openRequestLogModal();
      return;
    }

    versionTapTimer.current = setTimeout(() => {
      versionTapCount.current = 0;
      versionTapTimer.current = null;
    }, 1500);
  }, [openRequestLogModal]);

  const handleRequestLogClose = useCallback(() => {
    setRequestLogModalOpen(false);
    setRequestLogTouched(false);
  }, []);

  const handleRequestLogSave = async () => {
    if (!canEditRequestLog) return;
    if (!requestLogDirty) {
      setRequestLogModalOpen(false);
      return;
    }

    const previous = requestLogEnabled;
    setRequestLogSaving(true);
    updateConfigValue('request-log', requestLogDraft);

    try {
      await configApi.updateRequestLog(requestLogDraft);
      clearCache('request-log');
      showNotification(t('notification.request_log_updated'), 'success');
      setRequestLogModalOpen(false);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : typeof error === 'string' ? error : '';
      updateConfigValue('request-log', previous);
      showNotification(
        `${t('notification.update_failed')}${message ? `: ${message}` : ''}`,
        'error'
      );
    } finally {
      setRequestLogSaving(false);
    }
  };

  // An update-check result belongs to the connection it was made on.
  useEffect(() => {
    setLatestCheck(null);
  }, [auth.apiBase, auth.managementKey]);

  const handleVersionCheck = useCallback(async () => {
    const session = { apiBase: auth.apiBase, managementKey: auth.managementKey };
    setCheckingVersion(true);
    try {
      const data = await versionApi.checkLatest();
      const current = useAuthStore.getState();
      if (current.apiBase !== session.apiBase || current.managementKey !== session.managementKey) {
        return;
      }
      const latestRaw = data?.['latest-version'] ?? data?.latest_version ?? data?.latest ?? '';
      const latest = typeof latestRaw === 'string' ? latestRaw : String(latestRaw ?? '');
      const comparison = compareVersions(latest, auth.serverVersion);
      if (latest) setLatestCheck({ latest, comparison });

      if (!latest) {
        showNotification(t('system_info.version_check_error'), 'error');
        return;
      }

      if (comparison === null) {
        showNotification(t('system_info.version_current_missing'), 'warning');
        return;
      }

      if (comparison > 0) {
        showNotification(t('system_info.version_update_available', { version: latest }), 'warning');
      } else {
        showNotification(t('system_info.version_is_latest'), 'success');
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : typeof error === 'string' ? error : '';
      const suffix = message ? `: ${message}` : '';
      showNotification(`${t('system_info.version_check_error')}${suffix}`, 'error');
    } finally {
      setCheckingVersion(false);
    }
  }, [auth.apiBase, auth.managementKey, auth.serverVersion, showNotification, t]);

  useEffect(() => {
    fetchConfig().catch(() => {
      // ignore
    });
  }, [fetchConfig]);

  useEffect(() => {
    if (requestLogModalOpen && !requestLogTouched) {
      setRequestLogDraft(requestLogEnabled);
    }
  }, [requestLogModalOpen, requestLogTouched, requestLogEnabled]);

  useEffect(() => {
    return () => {
      if (versionTapTimer.current) {
        clearTimeout(versionTapTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    fetchModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.connectionStatus, auth.apiBase]);

  const headline = describeSystem({
    connection: auth.connectionStatus,
    serverVersion: auth.serverVersion,
    uiVersion: appVersion,
    latest: latestCheck,
  });
  const connectionTone =
    auth.connectionStatus === 'connected'
      ? 'ok'
      : auth.connectionStatus === 'connecting'
        ? 'unknown'
        : 'bad';
  const links = [
    {
      href: 'https://github.com/router-for-me/CLIProxyAPI',
      label: t('system_info.link_main_repo'),
      desc: t('system_info.link_main_repo_desc'),
    },
    {
      href: 'https://github.com/router-for-me/Cli-Proxy-API-Management-Center',
      label: t('system_info.link_webui_repo'),
      desc: t('system_info.link_webui_repo_desc'),
    },
    {
      href: 'https://help.router-for.me/',
      label: t('system_info.link_docs'),
      desc: t('system_info.link_docs_desc'),
    },
  ];

  return (
    <div className={flow.page}>
      <PageHeader
        eyebrow={t('system_info.flow.eyebrow')}
        title={t(headline.title.key, headline.title.values)}
        subtitle={t(headline.subtitle.key, headline.subtitle.values)}
        live
      />

      <dl className={`${flow.facts} ${flow.lead}`}>
        <div className={flow.fact}>
          <dt>{t('footer.api_version')}</dt>
          <dd>
            <span>{apiVersion}</span>
            <button
              type="button"
              className={flow.textButton}
              onClick={() => void handleVersionCheck()}
              disabled={checkingVersion || auth.connectionStatus !== 'connected'}
            >
              {checkingVersion
                ? t('system_info.flow.checking')
                : t('system_info.version_check_button')}
            </button>
          </dd>
        </div>
        <div className={flow.fact}>
          <dt>{t('connection.status')}</dt>
          <dd>
            <StatusDot tone={connectionTone} label={t(`common.${auth.connectionStatus}_status`)} />
            <span className={styles.address}>{auth.apiBase || '-'}</span>
          </dd>
        </div>
        <div className={flow.fact}>
          <dt>{t('footer.version')}</dt>
          <dd>
            {/* Seven quick taps open the hidden request-log switch. */}
            <button type="button" className={styles.versionTap} onClick={handleInfoVersionTap}>
              {appVersion}
            </button>
          </dd>
        </div>
        <div className={flow.fact}>
          <dt>{t('footer.build_date')}</dt>
          <dd>{buildTime}</dd>
        </div>
        <div className={flow.fact}>
          <dt>{t('system_info.models_title')}</dt>
          <dd>
            {modelsLoading
              ? t('common.loading')
              : models.length === 0
                ? t('system_info.models_empty')
                : t('system_info.flow.models_summary', {
                    count: models.length,
                    groups: groupedModels.map((group) => group.label).join(', '),
                  })}
          </dd>
        </div>
      </dl>

      <div className={flow.moreWrap}>
        <MoreDisclosure
          label={t('system_info.flow.more')}
          summary={t('system_info.flow.more_summary')}
        >
          <div className={flow.moreBody}>
            <section className={flow.moreSection}>
              <div className={flow.sectionHead}>
                <h3 className={flow.sectionLabel}>{t('system_info.models_title')}</h3>
                <button
                  type="button"
                  className={flow.textButton}
                  onClick={() => fetchModels({ forceRefresh: true })}
                  disabled={modelsLoading}
                >
                  {t('common.refresh')}
                </button>
              </div>
              <p className={flow.quiet}>{t('system_info.models_desc')}</p>
              {modelStatus && modelStatus.type !== 'success' && (
                <p
                  className={flow.note}
                  data-tone={modelStatus.type === 'error' ? 'bad' : undefined}
                >
                  {modelStatus.message}
                </p>
              )}
              {modelsError && (
                <p className={flow.note} data-tone="bad">
                  {modelsError}
                </p>
              )}
              {modelsLoading ? (
                <p className={flow.caption}>{t('common.loading')}</p>
              ) : models.length === 0 ? (
                <p className={flow.caption}>{t('system_info.models_empty')}</p>
              ) : (
                <ul className={flow.list}>
                  {groupedModels.map((group) => {
                    const iconSrc = getIconForCategory(group.id);
                    return (
                      <li key={group.id} className={`${flow.row} ${styles.modelGroup}`}>
                        {iconSrc ? (
                          <img src={iconSrc} alt="" className={flow.rowIcon} />
                        ) : (
                          <span className={flow.rowIcon} aria-hidden="true" />
                        )}
                        <div className={flow.rowMain}>
                          <span className={flow.rowTitle}>
                            {group.label}
                            <span className={styles.groupCount}>
                              {t('system_info.models_count', { count: group.items.length })}
                            </span>
                          </span>
                          <div className={styles.modelTags}>
                            {group.items.map((model) => (
                              <span
                                key={`${model.name}-${model.alias ?? 'default'}`}
                                className={styles.modelTag}
                                title={model.description || ''}
                              >
                                <span className={styles.modelName}>{model.name}</span>
                                {model.alias && (
                                  <span className={styles.modelAlias}>{model.alias}</span>
                                )}
                              </span>
                            ))}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className={flow.moreSection}>
              <h3 className={flow.sectionLabel}>{t('system_info.quick_links_title')}</h3>
              <ul className={flow.list}>
                {links.map((link) => (
                  <li key={link.href} className={flow.row}>
                    <div className={flow.rowMain}>
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`${flow.textLink} ${styles.linkTitle}`}
                      >
                        {link.label}
                        <IconExternalLink size={13} aria-hidden="true" />
                      </a>
                      <span className={flow.rowMeta}>{link.desc}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section className={flow.moreSection}>
              <h3 className={flow.sectionLabel}>{t('system_info.clear_login_title')}</h3>
              <p className={flow.quiet}>{t('system_info.clear_login_desc')}</p>
              <p className={flow.actions}>
                <button
                  type="button"
                  className={`${flow.textButton} ${flow.textDanger}`}
                  onClick={handleClearLoginStorage}
                >
                  {t('system_info.clear_login_button')}
                </button>
              </p>
            </section>
          </div>
        </MoreDisclosure>
      </div>

      <Modal
        open={requestLogModalOpen}
        onClose={handleRequestLogClose}
        title={t('basic_settings.request_log_title')}
        footer={
          <>
            <Button variant="secondary" onClick={handleRequestLogClose} disabled={requestLogSaving}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={handleRequestLogSave}
              loading={requestLogSaving}
              disabled={!canEditRequestLog || !requestLogDirty}
            >
              {t('common.save')}
            </Button>
          </>
        }
      >
        <div className="request-log-modal">
          <div className="status-badge warning">{t('basic_settings.request_log_warning')}</div>
          <ToggleSwitch
            label={t('basic_settings.request_log_enable')}
            labelPosition="left"
            checked={requestLogDraft}
            disabled={!canEditRequestLog || requestLogSaving}
            onChange={(value) => {
              setRequestLogDraft(value);
              setRequestLogTouched(true);
            }}
          />
        </div>
      </Modal>
    </div>
  );
}
