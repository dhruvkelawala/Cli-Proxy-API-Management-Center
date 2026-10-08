import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { RoutingStrategy } from '@/types/visualConfig';
import { CR, strategyLabelKey } from '../copy';
import styles from './SharedPoolSlot.module.scss';

export type SharedPoolSlotProps = {
  /** Profiles with at least one Automatic rule (what a shared strategy change affects). */
  automaticClientCount?: number;
  strategy: RoutingStrategy | null;
  affinity: boolean | null;
};

/**
 * Slot for the shared load-balancing band (CPA-008).
 *
 * CPA-008 builds `<SharedRoutingBand automaticClientCount={n} />` in
 * `src/features/config/routing/SharedRoutingBand.tsx`. When it lands, render it here instead of
 * this read-only summary; this page must not edit strategy, priority or weight itself.
 */
export function SharedPoolSlot({ automaticClientCount, strategy, affinity }: SharedPoolSlotProps) {
  const { t } = useTranslation();
  return (
    <section className={styles.band} aria-labelledby="client-routes-shared-pool">
      <div className={styles.copy}>
        <h2 id="client-routes-shared-pool" className={styles.title}>
          {t(`${CR}.shared_pool.label`)}
          <span className={styles.hint}>{t(`${CR}.shared_pool.hint`)}</span>
        </h2>
        <p className={styles.summary}>
          {strategy
            ? t(`${CR}.shared_pool.strategy`, { strategy: t(strategyLabelKey(strategy)) })
            : t(`${CR}.shared_pool.strategy_unknown`)}
          {affinity !== null && (
            <>
              <span className={styles.dot} aria-hidden="true">
                ·
              </span>
              {affinity ? t(`${CR}.shared_pool.affinity_on`) : t(`${CR}.shared_pool.affinity_off`)}
            </>
          )}
        </p>
        {automaticClientCount !== undefined && (
          <p className={styles.scope}>
            {t(`${CR}.shared_pool.affects`, { count: automaticClientCount })}
          </p>
        )}
      </div>
      <Link className={styles.link} to="/config?field=routingStrategy">
        {t(`${CR}.shared_pool.edit`)}
      </Link>
    </section>
  );
}
