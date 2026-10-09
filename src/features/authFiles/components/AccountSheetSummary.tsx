import { useTranslation } from 'react-i18next';
import { QuotaRail, StatusDot } from '@/components/flow';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import type { AuthFileItem } from '@/types';
import {
  getAuthFileStatusMessage,
  getTypeLabel,
  hasAuthFileStatusWarning,
  isProblemAuthFile,
  isRuntimeOnlyAuthFile,
  supportsAuthFileManualRefresh,
} from '@/features/authFiles/constants';
import {
  accountProviderKey,
  isAccountDisabled,
  type AccountPresentation,
} from '@/features/authFiles/accountPresentation';
import { getAuthFileRefreshKey } from '@/features/authFiles/manualRefresh';
import { deriveAccountTitle } from '@/features/authFiles/identity';
import type { QuotaSummary } from '@/features/quota/quotaSummary';
import { durationCopy } from '@/features/overview/overviewModel';
import type { AccountClientLinks as Links } from '@/features/clientProfiles/accountLinks';
import { AccountClientLinks } from '@/features/clientProfiles/components/AccountClientLinks';
import { accountStatus, poolCopy } from '../accountsView';
import { AuthFileCooldownSection } from './AuthFileCooldownSection';
import { ProviderStatusBar } from '@/components/providers/ProviderStatusBar';
import { statusBarDataFromRecentRequests, type StatusBarData } from '@/utils/recentRequests';
import cardStyles from './AuthFileCard.module.scss';
import styles from './AccountSheetSummary.module.scss';

export interface AccountSheetSummaryProps {
  file: AuthFileItem;
  presentation?: AccountPresentation;
  quota: QuotaSummary;
  now: number;
  clientLinks?: Links | null;
  /** Recent request blocks (from the status bar cache); falls back to the file's own buckets. */
  statusData?: StatusBarData | null;
  clientRoutesDisabled: boolean;
  disableControls: boolean;
  deleting: string | null;
  statusUpdating: Record<string, boolean>;
  manualRefreshing: Record<string, boolean>;
  cooldownResetting: Record<string, boolean>;
  onUseOnlyFor?: (file: AuthFileItem) => void;
  onShowModels: (file: AuthFileItem) => void;
  onManualRefresh: (file: AuthFileItem) => void;
  onCooldownReset: (file: AuthFileItem) => void;
  onDownload: (name: string) => void;
  onDelete: (name: string) => void;
}

/**
 * The top of an account's details sheet: how it is doing (status, pool, cooldown, quota,
 * requests, pinned clients) and its one-off actions (models, refresh, download, delete).
 * Everything the card view offers per account is reachable from here.
 */
export function AccountSheetSummary({
  file,
  presentation,
  quota,
  now,
  clientLinks,
  statusData,
  clientRoutesDisabled,
  disableControls,
  deleting,
  statusUpdating,
  manualRefreshing,
  cooldownResetting,
  onUseOnlyFor,
  onShowModels,
  onManualRefresh,
  onCooldownReset,
  onDownload,
  onDelete,
}: AccountSheetSummaryProps) {
  const { t } = useTranslation();
  const provider = accountProviderKey(file);
  const providerName = getTypeLabel(t, provider);
  const status = accountStatus(presentation);
  const pool = presentation ? poolCopy(presentation, providerName) : null;
  const runtimeOnly = isRuntimeOnlyAuthFile(file);
  const enabled = !isAccountDisabled(file);
  const refreshKey = getAuthFileRefreshKey(file);
  const refreshing = manualRefreshing[refreshKey] === true;
  const busy = statusUpdating[refreshKey] === true || refreshing;
  const authIndex = typeof file.authIndex === 'string' ? file.authIndex : null;
  const message = getAuthFileStatusMessage(file);
  const title = deriveAccountTitle(file).title || file.name;
  const accountName = `${providerName} ${title}`;
  const showModels = !runtimeOnly || provider === 'aistudio';
  const canRefresh = !runtimeOnly && supportsAuthFileManualRefresh(provider);

  const caption = (left: number | null, resetAt: number | null) => {
    if (quota.status === 'loading') return t('overview.quota.checking');
    if (left === null) return t('overview.quota.unknown');
    if (!resetAt) return t('overview.quota.left', { percent: left });
    const copy = durationCopy(resetAt, now);
    return t('overview.quota.left_reset', { percent: left, in: t(copy.key, copy.values) });
  };
  const showQuota = enabled && quota.status !== 'none';

  return (
    <div className={styles.summary}>
      <p className={styles.statusLine}>
        <StatusDot tone={status.tone} label={t(status.key)} />
        {pool && <span className={styles.pool}>{t(pool.key, pool.values)}</span>}
      </p>

      {message && hasAuthFileStatusWarning(file) && isProblemAuthFile(file) && (
        <p className={styles.warning}>{message}</p>
      )}

      <AuthFileCooldownSection
        snapshot={file.cooldownSnapshot}
        resetting={Boolean(authIndex && cooldownResetting[authIndex])}
        resetDisabled={disableControls || busy}
        onReset={authIndex ? () => onCooldownReset(file) : undefined}
      />

      {showQuota && (
        <div className={styles.quota}>
          <div className={styles.window}>
            <span className={styles.windowName}>{t('overview.quota.session')}</span>
            <QuotaRail
              percentLeft={quota.status === 'ready' ? quota.sessionLeft : null}
              label={t('overview.quota.session_label', { account: title })}
              caption={caption(quota.sessionLeft, quota.sessionResetAt)}
            />
          </div>
          <div className={styles.window}>
            <span className={styles.windowName}>{t('overview.quota.week')}</span>
            <QuotaRail
              percentLeft={quota.status === 'ready' ? quota.weekLeft : null}
              label={t('overview.quota.week_label', { account: title })}
              caption={caption(quota.weekLeft, quota.weekResetAt)}
            />
          </div>
        </div>
      )}

      <div className={styles.requests}>
        <p>
          {t('auth_files.flow.requests_line', {
            success: (file.successCount ?? 0).toLocaleString(),
            failed: (file.failureCount ?? 0).toLocaleString(),
          })}
        </p>
        <ProviderStatusBar
          statusData={statusData ?? statusBarDataFromRecentRequests(file.recentRequests ?? [])}
          styles={cardStyles}
        />
      </div>

      {clientLinks && onUseOnlyFor && !runtimeOnly && (
        <AccountClientLinks
          links={clientLinks}
          accountName={accountName}
          disabled={disableControls || clientRoutesDisabled}
          onUseOnlyFor={() => onUseOnlyFor(file)}
        />
      )}

      <div className={styles.actions}>
        {showModels && (
          <button
            type="button"
            className={styles.textButton}
            disabled={disableControls}
            onClick={() => onShowModels(file)}
          >
            {t('auth_files.models_button')}
          </button>
        )}
        {canRefresh && (
          <button
            type="button"
            className={styles.textButton}
            disabled={disableControls || file.disabled === true || busy}
            onClick={() => onManualRefresh(file)}
          >
            {refreshing ? <LoadingSpinner size={12} /> : null}
            {t('auth_files.manual_refresh_button')}
          </button>
        )}
        {!runtimeOnly && (
          <>
            <button
              type="button"
              className={styles.textButton}
              disabled={disableControls}
              onClick={() => onDownload(file.name)}
            >
              {t('auth_files.download_button')}
            </button>
            <button
              type="button"
              className={styles.textButton}
              data-tone="danger"
              disabled={disableControls || deleting === file.name || refreshing}
              onClick={() => onDelete(file.name)}
            >
              {t('auth_files.delete_button')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
