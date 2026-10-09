import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/flow';
import { IconRefreshCw } from '@/components/ui/icons';
import styles from './QuotaHeader.module.scss';

export type QuotaHeaderProps = {
  totalCount: number;
  loadedCount: number;
  attentionCount: number;
  refreshing: boolean;
  disableControls: boolean;
  onRefreshAll: () => void;
};

/**
 * Quota page header (Flow): a sentence for how many accounts there are, a quiet line for how
 * many have been read, and one quiet "Refresh all" action.
 */
export function QuotaHeader(props: QuotaHeaderProps) {
  const { totalCount, loadedCount, attentionCount, refreshing, disableControls, onRefreshAll } =
    props;
  const { t } = useTranslation();

  const title =
    totalCount === 0
      ? t('quota_management.flow.title_empty')
      : t('quota_management.flow.title', { count: totalCount });
  const subtitle = [
    t('quota_management.flow.checked', { count: loadedCount, total: totalCount }),
    attentionCount > 0 ? t('quota_management.flow.unreadable', { count: attentionCount }) : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <PageHeader
      eyebrow={t('quota_management.flow.eyebrow')}
      title={title}
      subtitle={totalCount > 0 ? subtitle : t('quota_management.flow.empty_follow')}
      live
      actions={
        <button
          type="button"
          className={styles.refresh}
          onClick={onRefreshAll}
          disabled={disableControls || refreshing}
        >
          <IconRefreshCw
            size={14}
            className={refreshing ? styles.spinning : undefined}
            aria-hidden="true"
          />
          {t('quota_management.refresh_all_credentials')}
        </button>
      }
    />
  );
}
