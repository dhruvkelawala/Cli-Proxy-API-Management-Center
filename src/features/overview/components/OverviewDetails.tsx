import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/stores';
import { formatDateValue, formatPercent } from '@/utils/format';
import { providerLabel } from '@/features/dashboard/utils';
import { ThroughputChart } from '@/features/dashboard/components/ThroughputChart';
import type { useDashboardOverview } from '@/features/dashboard/hooks/useDashboardOverview';
import styles from '../Overview.module.scss';

const DASH = '—';

const LINKS = [
  { to: '/ai-providers', key: 'nav.ai_providers' },
  { to: '/oauth', key: 'nav.oauth' },
  { to: '/config', key: 'nav.config_management' },
  { to: '/logs', key: 'nav.logs' },
  { to: '/system', key: 'nav.system_info' },
];

/** Overview's More: the throughput chart, how the gateway is set up, and links elsewhere. */
export function OverviewDetails({
  dashboard,
  windowLabel,
}: {
  dashboard: ReturnType<typeof useDashboardOverview>;
  windowLabel: string;
}) {
  const { t, i18n } = useTranslation();
  const serverVersion = useAuthStore((state) => state.serverVersion);
  const serverBuildDate = useAuthStore((state) => state.serverBuildDate);
  const { config, counts, credentials, traffic, providers } = dashboard;
  const unknownLabel = t('dashboard.provider_unknown');

  const strategy = config?.routingStrategy?.trim();
  const rows: Array<{ label: string; value: string; mono?: boolean }> = [
    {
      label: t('dashboard.runtime_routing'),
      value: strategy ? t(`overview.strategy.${strategy}`, { defaultValue: strategy }) : DASH,
    },
    { label: t('dashboard.runtime_retry'), value: String(config?.requestRetry ?? 0) },
    {
      label: t('dashboard.stat_credentials'),
      value: credentials ? credentials.total.toLocaleString() : DASH,
    },
    {
      label: t('dashboard.stat_provider_keys'),
      value: counts.providerKeys === null ? DASH : counts.providerKeys.toLocaleString(),
    },
    {
      label: t('dashboard.stat_models'),
      value: counts.models === null ? DASH : counts.models.toLocaleString(),
    },
    {
      label: t('dashboard.runtime_management_keys'),
      value: counts.managementKeys === null ? DASH : String(counts.managementKeys),
    },
    { label: t('dashboard.runtime_version'), value: serverVersion?.trim() || DASH },
    {
      label: t('dashboard.runtime_build'),
      value: formatDateValue(serverBuildDate, i18n.language) || DASH,
    },
    { label: t('dashboard.runtime_proxy'), value: config?.proxyUrl?.trim() || DASH, mono: true },
  ];
  const toggles = config
    ? [
        { label: t('dashboard.runtime_debug'), on: Boolean(config.debug) },
        { label: t('dashboard.runtime_file_logging'), on: Boolean(config.loggingToFile) },
        { label: t('dashboard.runtime_request_log'), on: Boolean(config.requestLog) },
        { label: t('dashboard.runtime_ws_auth'), on: Boolean(config.wsAuth) },
        { label: t('dashboard.runtime_model_prefix'), on: Boolean(config.forceModelPrefix) },
      ]
    : [];

  return (
    <div className={styles.details}>
      <section className={styles.detailSection}>
        <h3 className={styles.detailTitle}>{t('overview.details.traffic')}</h3>
        {windowLabel && (
          <p className={styles.detailNote}>
            {t('dashboard.traffic_description', { window: windowLabel })}
          </p>
        )}
        <ThroughputChart traffic={traffic} />
      </section>

      <section className={styles.detailSection}>
        <h3 className={styles.detailTitle}>{t('overview.details.providers')}</h3>
        {credentials && credentials.total > 0 && (
          <p className={styles.detailNote}>
            {t('overview.details.health_line', {
              count: credentials.total,
              available: credentials.available,
              attention: credentials.needsAttention,
              unknown: credentials.unknown,
              disabled: credentials.disabled,
            })}
          </p>
        )}
        {providers.length === 0 ? (
          <p className={styles.detailNote}>{t('dashboard.fleet_empty')}</p>
        ) : (
          <table className={styles.providerTable}>
            <thead>
              <tr>
                <th scope="col">{t('overview.details.provider')}</th>
                <th scope="col">{t('overview.details.accounts')}</th>
                <th scope="col">{t('overview.details.requests', { window: windowLabel })}</th>
                <th scope="col">{t('dashboard.success_rate')}</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((provider) => (
                <tr key={provider.id}>
                  <th scope="row">{providerLabel(provider.id, unknownLabel)}</th>
                  <td>{provider.credentials.toLocaleString()}</td>
                  <td>{provider.total.toLocaleString()}</td>
                  <td>
                    {provider.successRate === null ? DASH : formatPercent(provider.successRate)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className={styles.detailSection}>
        <h3 className={styles.detailTitle}>{t('overview.details.gateway')}</h3>
        <dl className={styles.specs}>
          {rows.map((row) => (
            <div key={row.label} className={styles.spec}>
              <dt>{row.label}</dt>
              <dd data-mono={row.mono === true}>{row.value}</dd>
            </div>
          ))}
          {toggles.map((toggle) => (
            <div key={toggle.label} className={styles.spec}>
              <dt>{toggle.label}</dt>
              <dd>{toggle.on ? t('common.yes') : t('common.no')}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className={styles.detailSection}>
        <h3 className={styles.detailTitle}>{t('overview.details.elsewhere')}</h3>
        <ul className={styles.links}>
          {LINKS.map((link) => (
            <li key={link.to}>
              <Link to={link.to} className={styles.textLink}>
                {t(link.key)}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
