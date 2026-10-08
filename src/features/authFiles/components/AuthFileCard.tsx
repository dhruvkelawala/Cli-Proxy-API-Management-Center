import { useState, type CSSProperties } from 'react';
import { getAuthFileRefreshKey } from '@/features/authFiles/manualRefresh';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import {
  IconDownload,
  IconInfo,
  IconModelCluster,
  IconRefreshCw,
  IconSettings,
  IconTrash2,
} from '@/components/ui/icons';
import { ProviderStatusBar } from '@/components/providers/ProviderStatusBar';
import type { AuthFileItem } from '@/types';
import { statusBarDataFromRecentRequests } from '@/utils/recentRequests';
import { formatFileSize } from '@/utils/format';
import {
  formatModified,
  getAuthFileStatusMessage,
  hasAuthFileStatusWarning,
  getTypeColor,
  getTypeLabel,
  isProblemAuthFile,
  isRuntimeOnlyAuthFile,
  normalizeProviderKey,
  supportsAuthFileManualRefresh,
  type AuthFileQuotaFilter,
  type ResolvedTheme,
} from '@/features/authFiles/constants';
import { deriveAccountTitle } from '@/features/authFiles/identity';
import {
  isAccountDisabled,
  type AccountAvailability,
  type AccountPresentation,
} from '@/features/authFiles/accountPresentation';
import { resolveAuthFileQuotaType } from '@/features/authFiles/logic';
import type { AuthFileStatusBarData } from '@/features/authFiles/hooks/useAuthFilesStatusBarCache';
import { AuthFileQuotaSection } from '@/features/authFiles/components/AuthFileQuotaSection';
import { AuthFileCooldownSection } from './AuthFileCooldownSection';
import { AuthFileAccountHeading, AuthFileAccountSubtitle } from './AuthFileAccountTitle';
import styles from './AuthFileCard.module.scss';

const STATE_LABEL_KEYS: Record<AccountAvailability | 'off', string> = {
  available: 'auth_files.account_state_available',
  coolingDown: 'auth_files.account_state_cooling',
  attention: 'auth_files.account_state_attention',
  unknown: 'auth_files.account_state_unknown',
  off: 'auth_files.account_state_off',
};

const STATE_TONE_CLASSES: Record<AccountAvailability | 'off', string> = {
  available: styles.stateAvailable,
  coolingDown: styles.stateCooling,
  attention: styles.stateAttention,
  unknown: styles.stateUnknown,
  off: styles.stateOff,
};

export type AuthFileCardProps = {
  file: AuthFileItem;
  /** Availability and pool preference from presentAccounts(all files); omitted = no state line. */
  presentation?: AccountPresentation;
  compact: boolean;
  selected: boolean;
  resolvedTheme: ResolvedTheme;
  disableControls: boolean;
  deleting: string | null;
  statusUpdating: Record<string, boolean>;
  manualRefreshing: Record<string, boolean>;
  cooldownResetting: Record<string, boolean>;
  quotaFilterType: AuthFileQuotaFilter;
  statusBarCache: Map<string, AuthFileStatusBarData>;
  /** 首屏一次性级联入场的延迟；null/undefined 表示不做入场动画。 */
  entranceDelayMs?: number | null;
  onShowModels: (file: AuthFileItem) => void;
  onDownload: (name: string) => void;
  onManualRefresh: (file: AuthFileItem) => void;
  onCooldownReset: (file: AuthFileItem) => void;
  onOpenPrefixProxyEditor: (file: AuthFileItem) => void;
  onDelete: (name: string) => void;
  onToggleStatus: (file: AuthFileItem, enabled: boolean) => void;
  onToggleSelect: (name: string) => void;
};

export function AuthFileCard(props: AuthFileCardProps) {
  const { t } = useTranslation();
  const {
    file,
    presentation,
    compact,
    selected,
    resolvedTheme,
    disableControls,
    deleting,
    statusUpdating,
    manualRefreshing,
    cooldownResetting,
    quotaFilterType,
    statusBarCache,
    entranceDelayMs,
    onShowModels,
    onDownload,
    onManualRefresh,
    onCooldownReset,
    onOpenPrefixProxyEditor,
    onDelete,
    onToggleStatus,
    onToggleSelect,
  } = props;

  const isRuntimeOnly = isRuntimeOnlyAuthFile(file);
  const providerKey = normalizeProviderKey(String(file.type ?? file.provider ?? 'unknown'));
  const isAistudio = providerKey === 'aistudio';
  const showModelsButton = !isRuntimeOnly || isAistudio;
  const showManualRefreshButton = !isRuntimeOnly && supportsAuthFileManualRefresh(providerKey);
  const isManualRefreshing = manualRefreshing[getAuthFileRefreshKey(file)] === true;
  const typeLabel = getTypeLabel(t, providerKey);
  const typeColor = getTypeColor(providerKey, resolvedTheme);

  const quotaType = resolveAuthFileQuotaType(file, quotaFilterType);
  const showQuotaLayout = Boolean(quotaType) && !isRuntimeOnly && !compact;

  const successCount = file.successCount ?? 0;
  const failureCount = file.failureCount ?? 0;
  const authIndexKey = typeof file.authIndex === 'string' ? file.authIndex : null;
  const isCooldownResetting = Boolean(authIndexKey && cooldownResetting[authIndexKey]);
  const statusData =
    (authIndexKey && statusBarCache.get(authIndexKey)) ||
    statusBarDataFromRecentRequests(file.recentRequests ?? []);

  const rawStatusMessage = getAuthFileStatusMessage(file);
  const hasStatusWarning = hasAuthFileStatusWarning(file);

  const priorityValue = Number.isSafeInteger(file.priority) ? file.priority : undefined;
  const weightValue = Number.isSafeInteger(file.weight) ? file.weight : undefined;
  // 标题：有备注时用备注，账号（email/项目 ID）降为副行；否则账号领衔，文件名为 mono 副行
  const accountTitle = deriveAccountTitle(file);
  // 无障碍名称用卡片显示的标题，供应商前缀区分同名的不同提供商账号
  const accountName = accountTitle.title ? `${typeLabel} ${accountTitle.title}` : file.name;
  const enabled = !isAccountDisabled(file);
  const stateKey = presentation ? (presentation.availability ?? 'off') : null;
  const providerName = presentation ? getTypeLabel(t, presentation.provider) : typeLabel;
  // 仍在池内但需处理（错误状态/告警但后端未标记 unavailable）的账号可能仍被选中，不声称其池内角色
  const poolLabel = !presentation
    ? ''
    : presentation.availability === 'attention' && presentation.poolRole !== 'skipped'
      ? t('auth_files.pool_attention')
      : presentation.poolRole === 'shared'
        ? t('auth_files.pool_shared', { count: presentation.peers })
        : t(`auth_files.pool_${presentation.poolRole}`, { provider: providerName });

  // 挂载时捕获一次入场延迟：父级随后传 null 也不会中断已开始的动画
  const [mountEntranceDelayMs] = useState<number | null>(entranceDelayMs ?? null);
  const cardClasses = [
    styles.card,
    compact ? styles.cardCompact : '',
    selected ? styles.cardSelected : '',
    file.disabled === true ? styles.cardDisabled : '',
    mountEntranceDelayMs != null ? styles.cardEnter : '',
  ]
    .filter(Boolean)
    .join(' ');
  const cardStyle =
    mountEntranceDelayMs != null
      ? ({ '--card-delay': `${mountEntranceDelayMs}ms` } as CSSProperties)
      : undefined;

  return (
    <article className={cardClasses} style={cardStyle}>
      <header className={styles.head}>
        {!isRuntimeOnly && (
          <SelectionCheckbox
            checked={selected}
            onChange={() => onToggleSelect(file.name)}
            className={styles.selection}
            ariaLabel={t('auth_files.card_select', { name: accountName })}
            title={t('auth_files.card_select', { name: accountName })}
          />
        )}
        <AuthFileAccountHeading
          title={accountTitle}
          typeLabel={typeLabel}
          typeStyle={{
            backgroundColor: typeColor.bg,
            color: typeColor.text,
            ...(typeColor.border ? { border: typeColor.border } : {}),
          }}
        />
        {isRuntimeOnly && (
          <span className={styles.runtimeLabel}>{t('auth_files.type_virtual')}</span>
        )}
      </header>

      <AuthFileAccountSubtitle title={accountTitle} />

      {stateKey && (
        <p className={`${styles.state} ${STATE_TONE_CLASSES[stateKey]}`}>
          <span className={styles.stateHead}>
            <span className={styles.stateDot} aria-hidden="true" />
            <span className={styles.stateLabel}>{t(STATE_LABEL_KEYS[stateKey])}</span>
          </span>
          <span className={`${styles.metaDivider} ${styles.stateDivider}`} aria-hidden="true">
            ·
          </span>
          <span className={styles.statePool}>{poolLabel}</span>
        </p>
      )}

      {/* 只为问题账号显示告警；主动停用（含乐观重新启用前的旧消息）由状态行中性表达 */}
      {rawStatusMessage && hasStatusWarning && isProblemAuthFile(file) && (
        <div className={styles.warning} title={rawStatusMessage}>
          <IconInfo className={styles.warningIcon} size={14} />
          <span>{rawStatusMessage}</span>
        </div>
      )}

      <AuthFileCooldownSection
        snapshot={file.cooldownSnapshot}
        resetting={isCooldownResetting}
        resetDisabled={
          disableControls ||
          statusUpdating[getAuthFileRefreshKey(file)] === true ||
          isManualRefreshing
        }
        onReset={authIndexKey ? () => onCooldownReset(file) : undefined}
      />

      <div className={styles.health}>
        <div className={styles.healthHead}>
          <span className={styles.healthLabel}>{t('auth_files.card_requests')}</span>
          <span className={styles.healthCounts}>
            <span
              className={`${styles.countOk} ${successCount > 0 ? styles.countLive : ''}`}
              title={t('stats.success')}
            >
              {t('stats.success')} {successCount}
            </span>
            <span
              className={`${styles.countFail} ${failureCount > 0 ? styles.countLive : ''}`}
              title={t('stats.failure')}
            >
              {t('stats.failure')} {failureCount}
            </span>
          </span>
        </div>
        <ProviderStatusBar statusData={statusData} styles={styles} />
      </div>

      <div className={styles.metaRow}>
        <span title={t('auth_files.file_size')}>{file.size ? formatFileSize(file.size) : '-'}</span>
        <span className={styles.metaDivider} aria-hidden="true">
          ·
        </span>
        <span title={t('auth_files.file_modified')}>{formatModified(file)}</span>
        {priorityValue !== undefined && (
          <>
            <span className={styles.metaDivider} aria-hidden="true">
              ·
            </span>
            <span className={styles.metaPriority} title={t('auth_files.priority_hint')}>
              <span className={styles.metaMetricLabel}>{t('auth_files.priority_display')}</span>
              <span>{priorityValue}</span>
            </span>
          </>
        )}
        {weightValue !== undefined && (
          <>
            <span className={styles.metaDivider} aria-hidden="true">
              ·
            </span>
            <span className={styles.metaWeight} title={t('auth_files.weight_tooltip')}>
              <span className={styles.metaMetricLabel}>{t('auth_files.weight_display')}</span>
              <span>{weightValue}</span>
            </span>
          </>
        )}
      </div>

      {showQuotaLayout && quotaType && (
        <AuthFileQuotaSection file={file} quotaType={quotaType} disableControls={disableControls} />
      )}

      <footer className={styles.actions}>
        <div className={styles.actionsMain}>
          {showModelsButton && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onShowModels(file)}
              title={t('auth_files.models_button')}
              disabled={disableControls}
            >
              <IconModelCluster size={14} />
              {t('auth_files.models_button')}
            </Button>
          )}
          {!isRuntimeOnly && (
            <div className={styles.utilityActions}>
              {showManualRefreshButton && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onManualRefresh(file)}
                  className={styles.iconButton}
                  title={t('auth_files.manual_refresh_button')}
                  disabled={
                    disableControls ||
                    file.disabled ||
                    statusUpdating[getAuthFileRefreshKey(file)] === true ||
                    isManualRefreshing
                  }
                >
                  {isManualRefreshing ? <LoadingSpinner size={14} /> : <IconRefreshCw size={15} />}
                </Button>
              )}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onDownload(file.name)}
                className={styles.iconButton}
                title={t('auth_files.download_button')}
                disabled={disableControls}
              >
                <IconDownload size={15} />
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onOpenPrefixProxyEditor(file)}
                className={styles.iconButton}
                title={t('auth_files.prefix_proxy_button')}
                disabled={disableControls || isManualRefreshing}
              >
                <IconSettings size={15} />
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => onDelete(file.name)}
                className={styles.iconButton}
                title={t('auth_files.delete_button')}
                disabled={disableControls || deleting === file.name || isManualRefreshing}
              >
                {deleting === file.name ? <LoadingSpinner size={14} /> : <IconTrash2 size={15} />}
              </Button>
            </div>
          )}
        </div>
        {!isRuntimeOnly && (
          <div className={styles.toggleWrap}>
            <span className={styles.toggleLabel} aria-hidden="true">
              {enabled
                ? t('auth_files.status_toggle_enabled')
                : t('auth_files.status_toggle_disabled')}
            </span>
            <ToggleSwitch
              ariaLabel={
                enabled
                  ? t('auth_files.card_toggle_enabled', { name: accountName })
                  : t('auth_files.card_toggle_disabled', { name: accountName })
              }
              checked={enabled}
              disabled={
                disableControls ||
                statusUpdating[getAuthFileRefreshKey(file)] === true ||
                isManualRefreshing
              }
              onChange={(value) => onToggleStatus(file, value)}
            />
          </div>
        )}
      </footer>
    </article>
  );
}
