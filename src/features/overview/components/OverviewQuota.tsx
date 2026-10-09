import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { QuotaRail } from '@/components/flow';
import type { AuthFileItem } from '@/types';
import { windowedQuotaProviderOf } from '@/features/quota/hooks/useAccountQuota';
import type { QuotaSummary } from '@/features/quota/quotaSummary';
import { durationCopy, type ProviderGroup } from '../overviewModel';
import styles from '../Overview.module.scss';

export interface OverviewQuotaProps {
  groups: ProviderGroup[];
  quotaFor: (file: AuthFileItem) => QuotaSummary;
  now: number;
  labelFor: (provider: string) => string;
}

/**
 * Five-hour and weekly room left for every enabled Claude and Codex account, each with when it
 * resets. Unknown is never drawn as empty.
 */
export function OverviewQuota({ groups, quotaFor, now, labelFor }: OverviewQuotaProps) {
  const { t } = useTranslation();
  const rows = groups.flatMap((group) =>
    group.accounts
      .filter(
        ({ account }) => account.role !== 'off' && windowedQuotaProviderOf(account.file) !== null
      )
      .map(({ account }) => ({ account, provider: group.provider, quota: quotaFor(account.file) }))
  );
  if (rows.length === 0) return null;

  const caption = (left: number | null, resetAt: number | null, status: QuotaSummary['status']) => {
    if (status === 'loading') return t('overview.quota.checking');
    if (left === null) return t('overview.quota.unknown');
    if (!resetAt) return t('overview.quota.left', { percent: left });
    const copy = durationCopy(resetAt, now);
    return t('overview.quota.left_reset', { percent: left, in: t(copy.key, copy.values) });
  };

  return (
    <section className={styles.quota} aria-labelledby="overview-quota-title">
      <div className={styles.sectionHead}>
        <h2 id="overview-quota-title" className={styles.sectionTitle}>
          {t('overview.quota.title')}
        </h2>
        <Link to="/quota" className={styles.textLink}>
          {t('overview.quota.details')}
        </Link>
      </div>
      <ul className={styles.quotaRows}>
        {rows.map(({ account, provider, quota }) => {
          const ready = quota.status === 'ready';
          return (
            <li key={account.id} className={styles.quotaRow}>
              <div className={styles.quotaWho}>
                <span className={styles.quotaName}>{account.label}</span>
                <span className={styles.quotaProvider}>{labelFor(provider)}</span>
              </div>
              <div className={styles.quotaWindow}>
                <span className={styles.windowName}>{t('overview.quota.session')}</span>
                <QuotaRail
                  percentLeft={ready ? quota.sessionLeft : null}
                  label={t('overview.quota.session_label', { account: account.label })}
                  caption={caption(quota.sessionLeft, quota.sessionResetAt, quota.status)}
                />
              </div>
              <div className={styles.quotaWindow}>
                <span className={styles.windowName}>{t('overview.quota.week')}</span>
                <QuotaRail
                  percentLeft={ready ? quota.weekLeft : null}
                  label={t('overview.quota.week_label', { account: account.label })}
                  caption={caption(quota.weekLeft, quota.weekResetAt, quota.status)}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
