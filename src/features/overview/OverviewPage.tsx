import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MoreDisclosure, PageHeader, TrafficFlow } from '@/components/flow';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useInterval } from '@/hooks/useInterval';
import { useAuthStore } from '@/stores';
import { gatewayDisplayHost } from '@/utils/connection';
import { formatCompactNumber, formatPercent } from '@/utils/format';
import { useDashboardOverview } from '@/features/dashboard/hooks/useDashboardOverview';
import { providerLabel, splitWindowMinutes } from '@/features/dashboard/utils';
import { readRoutingStrategy } from '@/features/clientProfiles/model';
import type { Copy } from '@/features/clientProfiles/routing/routingOrder';
import {
  buildNameJoiner,
  buildWhenFormatter,
} from '@/features/clientProfiles/routing/useRoutingOrder';
import { useAccountQuota } from '@/features/quota/hooks/useAccountQuota';
import {
  buildProviderGroups,
  describeOverview,
  joinSentences,
  recentTotal,
  trafficTotal,
} from './overviewModel';
import { buildFlowProviders } from './flowNodes';
import { OverviewQuota } from './components/OverviewQuota';
import { OverviewDetails } from './components/OverviewDetails';
import styles from './Overview.module.scss';

/** The account list is re-read this often while Overview is open. */
const LIVE_REFRESH_MS = 30_000;

/**
 * Overview (#/): one sentence that says how things are, the live flow (gateway → providers →
 * accounts), quota per account and a quiet line of totals. The old dashboard's detail lives
 * under More.
 */
export function OverviewPage() {
  const { t, i18n } = useTranslation();
  const apiBase = useAuthStore((state) => state.apiBase);
  const serverVersion = useAuthStore((state) => state.serverVersion);
  const dashboard = useDashboardOverview();
  const {
    connectionStatus,
    connected,
    config,
    traffic,
    authFiles,
    authFilesFailed,
    reloadAuthFiles,
    refresh,
  } = dashboard;

  useHeaderRefresh(refresh, connected);
  useInterval(() => void reloadAuthFiles(), connected ? LIVE_REFRESH_MS : null);

  const { quotaFor, now } = useAccountQuota(authFiles);
  const locale = i18n.language || 'en';
  const formatWhen = useMemo(() => buildWhenFormatter(t, locale), [t, locale]);
  const join = useMemo(() => buildNameJoiner(locale), [locale]);
  const unknownLabel = t('dashboard.provider_unknown');
  const labelFor = (provider: string) => providerLabel(provider, unknownLabel);

  const groups = useMemo(
    () =>
      authFiles
        ? buildProviderGroups({
            files: authFiles,
            strategy: readRoutingStrategy(config?.routingStrategy) ?? 'round-robin',
            sessionAffinity: config?.routingSessionAffinity === true,
            quotaFor,
          })
        : null,
    [authFiles, config?.routingSessionAffinity, config?.routingStrategy, quotaFor]
  );

  const text = (copy: Copy) => t(copy.key, copy.values);
  const sentence = describeOverview({
    connection: connectionStatus,
    groups,
    providerLabel: labelFor,
    formatWhen,
    join,
    filesFailed: authFilesFailed,
  });
  const title = joinSentences(sentence.title.map(text), locale);
  const subtitle = joinSentences(sentence.subtitle.map(text), locale);

  const flowProviders = useMemo(
    () => (groups ? buildFlowProviders(groups, { t, formatWhen, providerLabel: labelFor }) : []),
    // labelFor only depends on t.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groups, t, formatWhen]
  );

  const windowLabel = useMemo(() => {
    if (traffic.windowMinutes <= 0) return '';
    const { hours, minutes } = splitWindowMinutes(traffic.windowMinutes);
    if (hours === 0) return t('dashboard.window_m', { minutes });
    if (minutes === 0) return t('dashboard.window_h', { hours });
    return t('dashboard.window_hm', { hours, minutes });
  }, [traffic.windowMinutes, t]);

  const groupTraffic = groups?.reduce((sum, group) => sum + trafficTotal(group.traffic), 0) ?? 0;
  const liveNow = groups?.reduce((sum, group) => sum + recentTotal(group.traffic), 0) ?? 0;
  const host = gatewayDisplayHost(apiBase);

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow={
          <span className={styles.eyebrow} data-tone={sentence.tone}>
            <span
              className={styles.pulse}
              data-live={connected && liveNow > 0}
              aria-hidden="true"
            />
            {t('overview.eyebrow')}
          </span>
        }
        title={title}
        subtitle={subtitle || undefined}
        live
      />

      {authFilesFailed && connected && (
        <p className={styles.staleNote} role="status">
          <span>{authFiles ? t('overview.stale.kept') : t('overview.stale.none')}</span>
          <button
            type="button"
            className={styles.textButton}
            onClick={() => void reloadAuthFiles()}
          >
            {t('overview.stale.retry')}
          </button>
        </p>
      )}

      {flowProviders.length > 0 && (
        <section className={styles.flow} aria-label={t('overview.flow.section')}>
          <TrafficFlow
            providers={flowProviders}
            label={t('overview.flow.label')}
            hubLabel={t('routing.hub')}
            hubDetail={host || undefined}
          />
          <p className={styles.flowNote}>
            <span>{t('overview.flow.legend')}</span>
            <Link to="/client-routes" className={styles.textLink}>
              {t('overview.flow.change_order')}
            </Link>
          </p>
        </section>
      )}

      {groups && (
        <OverviewQuota groups={groups} quotaFor={quotaFor} now={now} labelFor={labelFor} />
      )}

      {connected && (
        <p className={styles.totals}>
          {traffic.total > 0 || groupTraffic > 0
            ? t('overview.totals', {
                count:
                  traffic.total < 100_000
                    ? traffic.total.toLocaleString(locale)
                    : formatCompactNumber(traffic.total),
                window: windowLabel,
                rate: traffic.successRate === null ? '—' : formatPercent(traffic.successRate),
              })
            : t('overview.totals_none')}
        </p>
      )}

      <div className={styles.moreWrap}>
        <MoreDisclosure
          label={t('overview.more')}
          summary={[
            dashboard.config?.routingStrategy
              ? t(`overview.strategy.${dashboard.config.routingStrategy}`, {
                  defaultValue: dashboard.config.routingStrategy,
                })
              : null,
            serverVersion ? `v${serverVersion.trim().replace(/^[vV]+/, '')}` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        >
          <OverviewDetails dashboard={dashboard} windowLabel={windowLabel} />
        </MoreDisclosure>
      </div>
    </div>
  );
}
