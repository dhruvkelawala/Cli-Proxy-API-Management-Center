import { useTranslation } from 'react-i18next';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { IconRefreshCw, IconUpload } from '@/components/ui/icons';
import { useRevealGroup } from '@/hooks/motion';
import type { AccountCounts } from '@/features/authFiles/accountPresentation';
import styles from './VaultHeader.module.scss';

export type VaultHeaderProps = {
  counts: AccountCounts;
  /** Host[:port] of the connected gateway; empty when it cannot be shown safely. */
  gatewayHost: string;
  loading: boolean;
  refreshing: boolean;
  uploading: boolean;
  disableControls: boolean;
  onUpload: () => void;
  onRefresh: () => void;
  refreshingCredentials?: boolean;
  credentialRefreshDisabled?: boolean;
  onRefreshCredentials?: () => void;
};

/**
 * 凭证库头部：eyebrow（▍游标前缀）+ 标题 + mono 遥测 meta 行 + 动作区。
 * meta 行同时承载 VaultPulse 的文字等价信息（谱条本身 aria-hidden）。
 */
export function VaultHeader(props: VaultHeaderProps) {
  const {
    counts,
    gatewayHost,
    loading,
    refreshing,
    uploading,
    disableControls,
    onUpload,
    onRefresh,
    refreshingCredentials = false,
    credentialRefreshDisabled = false,
    onRefreshCredentials,
  } = props;
  const { t } = useTranslation();
  const revealRef = useRevealGroup<HTMLElement>();

  return (
    <header className={styles.header} ref={revealRef}>
      <div className={styles.copy}>
        <h1 className={styles.title} data-reveal>
          {t('auth_files.title')}
        </h1>
        <p className={styles.meta} data-reveal>
          <span className={styles.metaTotal}>
            {t('auth_files.meta_total', { count: counts.total })}
          </span>
          <span className={styles.metaDot} aria-hidden="true">
            ·
          </span>
          <span className={counts.available > 0 ? styles.metaActive : styles.metaMuted}>
            {t('auth_files.meta_available', { count: counts.available })}
          </span>
          {counts.needsAttention > 0 && (
            <>
              <span className={styles.metaDot} aria-hidden="true">
                ·
              </span>
              <span className={styles.metaProblem}>
                {t('auth_files.meta_attention', { count: counts.needsAttention })}
              </span>
            </>
          )}
          {counts.unknown > 0 && (
            <>
              <span className={styles.metaDot} aria-hidden="true">
                ·
              </span>
              <span className={styles.metaMuted}>
                {t('auth_files.meta_unknown', { count: counts.unknown })}
              </span>
            </>
          )}
          {counts.disabled > 0 && (
            <>
              <span className={styles.metaDot} aria-hidden="true">
                ·
              </span>
              <span className={styles.metaMuted}>
                {t('auth_files.meta_disabled', { count: counts.disabled })}
              </span>
            </>
          )}
        </p>
        <p className={styles.context} data-reveal>
          {gatewayHost
            ? t('auth_files.gateway_context', { host: gatewayHost })
            : t('auth_files.gateway_context_unknown')}
        </p>
      </div>
      <div className={styles.actions} data-reveal>
        {onRefreshCredentials && (
          <button
            type="button"
            className={styles.ghostAction}
            onClick={onRefreshCredentials}
            disabled={
              disableControls || loading || refreshingCredentials || credentialRefreshDisabled
            }
          >
            {refreshingCredentials ? <LoadingSpinner size={14} /> : <IconRefreshCw size={14} />}
            {t('auth_files.refresh_all_button')}
          </button>
        )}
        <button
          type="button"
          className={styles.ghostAction}
          onClick={onRefresh}
          disabled={loading || refreshing}
        >
          <IconRefreshCw size={14} className={refreshing ? styles.spinning : undefined} />
          {t('common.refresh')}
        </button>
        <button
          type="button"
          className={styles.primaryAction}
          onClick={onUpload}
          disabled={disableControls || uploading}
        >
          {uploading ? <LoadingSpinner size={14} /> : <IconUpload size={15} />}
          {t('auth_files.upload_button')}
        </button>
      </div>
    </header>
  );
}
