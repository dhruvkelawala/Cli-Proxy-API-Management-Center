import { useTranslation } from 'react-i18next';
import type { RoutingAccountPresentation } from './routingPresentation';
import { formatSharePercent } from './routingFormat';
import styles from './RoutingShareBar.module.scss';

const TONES = [styles.tone0, styles.tone1, styles.tone2, styles.tone3];
const toneFor = (index: number) => TONES[index % TONES.length];

export interface RoutingShareBarProps {
  /** Accounts of one provider pool, in display order. */
  accounts: RoutingAccountPresentation[];
  strategyLabel: string;
}

/**
 * Illustrative configured shares for one provider pool, with a legend naming every segment.
 * Always labelled as illustrative: it is the scheduler's configured intent under an
 * all-eligible assumption, never served-by attribution, tokens or cost. Unknown availability
 * is striped with an amber ring.
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

  const segmentClass = ({ account, index }: (typeof sharing)[number]) =>
    [toneFor(index), account.status === 'unknown' ? styles.unknown : ''].filter(Boolean).join(' ');

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
          sharing.map((entry) => (
            <span
              key={entry.account.id}
              className={`${styles.segment} ${segmentClass(entry)}`}
              data-availability={entry.account.availability}
              data-striped={entry.account.status === 'unknown' ? 'true' : undefined}
              style={{ flexGrow: entry.account.sharePercent ?? 0 }}
            />
          ))
        )}
      </div>
      {sharing.length > 0 && (
        <ul className={styles.legend}>
          {sharing.map((entry) => (
            <li key={entry.account.id}>
              <span className={`${styles.swatch} ${segmentClass(entry)}`} aria-hidden="true" />
              <span className={styles.legendName}>{entry.account.label}</span>
              <span className={styles.legendValue}>
                {formatSharePercent(entry.account.sharePercent ?? 0)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className={styles.caption}>
        {t('config_management.routing_settings.sheet.share_caption', { strategy: strategyLabel })}
        {hasUnknown ? ` · ${t('config_management.routing_settings.sheet.share_unknown')}` : ''}
      </p>
    </div>
  );
}
