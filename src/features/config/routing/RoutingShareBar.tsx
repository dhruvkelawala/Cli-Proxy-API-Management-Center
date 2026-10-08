import { useTranslation } from 'react-i18next';
import type { RoutingAccountPresentation } from './routingPresentation';
import { formatSharePercent } from './routingFormat';
import styles from './RoutingShareBar.module.scss';

const SEGMENT_CLASSES = [styles.seg0, styles.seg1, styles.seg2];

export interface RoutingShareBarProps {
  /** Accounts of one provider pool, in display order. */
  accounts: RoutingAccountPresentation[];
  strategyLabel: string;
}

/**
 * Illustrative configured shares for one provider pool. Always labelled as illustrative:
 * it is the scheduler's configured intent under an all-eligible assumption, never served-by
 * attribution, tokens or cost. Unknown availability is striped.
 */
export function RoutingShareBar({ accounts, strategyLabel }: RoutingShareBarProps) {
  const { t } = useTranslation();
  const sharing = accounts
    .map((account, index) => ({ account, index }))
    .filter(({ account }) => (account.sharePercent ?? 0) > 0);
  const hasUnknown = sharing.some(({ account }) => account.status === 'unknown');
  const summary = sharing.length
    ? sharing
        .map(({ account }) =>
          t('config_management.routing_settings.sheet.share_item', {
            label: account.label,
            percent: formatSharePercent(account.sharePercent ?? 0),
          })
        )
        .join(', ')
    : t('config_management.routing_settings.sheet.share_empty');

  return (
    <div className={styles.wrap}>
      <div
        className={styles.bar}
        role="img"
        aria-label={t('config_management.routing_settings.sheet.share_aria', { summary })}
      >
        {sharing.length === 0 ? (
          <span className={styles.empty}>
            {t('config_management.routing_settings.sheet.share_empty')}
          </span>
        ) : (
          sharing.map(({ account, index }) => (
            <span
              key={account.id}
              className={[
                styles.segment,
                SEGMENT_CLASSES[index % SEGMENT_CLASSES.length],
                account.status === 'unknown' ? styles.unknown : '',
              ]
                .filter(Boolean)
                .join(' ')}
              data-availability={account.availability}
              data-striped={account.status === 'unknown' ? 'true' : undefined}
              style={{ flexGrow: account.sharePercent ?? 0 }}
            >
              {(account.sharePercent ?? 0) >= 12 && (
                <span className={styles.segmentLabel}>
                  {(account.sharePercent ?? 0) >= 30 && (
                    <span className={styles.segmentName}>{account.label} </span>
                  )}
                  {formatSharePercent(account.sharePercent ?? 0)}
                </span>
              )}
            </span>
          ))
        )}
      </div>
      <p className={styles.caption}>
        {t('config_management.routing_settings.sheet.share_caption', { strategy: strategyLabel })}
        {hasUnknown ? ` · ${t('config_management.routing_settings.sheet.share_unknown')}` : ''}
      </p>
    </div>
  );
}
