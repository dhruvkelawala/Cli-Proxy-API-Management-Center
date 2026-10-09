import type { TFunction } from 'i18next';
import { StatusDot, type TrafficNodeState, type TrafficProviderNode } from '@/components/flow';
import type { FormatWhen } from '@/features/clientProfiles/routing/routingOrder';
import { formatCompactNumber } from '@/utils/format';
import {
  accountStatusCopy,
  flowFailures,
  flowStateOf,
  flowVolume,
  recentTotal,
  trafficTotal,
  type ProviderGroup,
} from './overviewModel';
import styles from './Overview.module.scss';

const providerState = (states: TrafficNodeState[]): TrafficNodeState => {
  if (states.includes('live')) return 'live';
  if (states.every((state) => state === 'off')) return 'off';
  if (states.includes('bad')) return 'bad';
  if (states.includes('warn')) return 'warn';
  return 'idle';
};

const count = (value: number) =>
  value < 10_000 ? value.toLocaleString() : formatCompactNumber(value);

/** TrafficFlow nodes for the provider groups: path weights, dots and each node's words. */
export function buildFlowProviders(
  groups: ProviderGroup[],
  {
    t,
    formatWhen,
    providerLabel,
  }: { t: TFunction; formatWhen: FormatWhen; providerLabel: (provider: string) => string }
): TrafficProviderNode[] {
  const all = groups.flatMap((group) => group.accounts);
  const grand = groups.reduce((sum, group) => sum + trafficTotal(group.traffic), 0);
  const busiest = Math.max(0, ...all.map((item) => recentTotal(item.traffic)));
  const share = (value: number) => (grand > 0 ? value / grand : 0);

  return groups.map((group) => {
    const accounts = group.accounts.map((item) => {
      const state = flowStateOf(item.account);
      const status = accountStatusCopy(item.account, formatWhen);
      const recent = recentTotal(item.traffic);
      return {
        id: item.account.id,
        state,
        volume: flowVolume(item, busiest),
        share: share(trafficTotal(item.traffic)),
        failures: flowFailures(item.traffic),
        content: (
          <>
            <span className={styles.nodeBody}>
              <span className={styles.nodeName}>{item.account.label}</span>
              <StatusDot tone={status.tone} label={t(status.copy.key, status.copy.values)} />
            </span>
            {recent > 0 && state !== 'off' && (
              <span
                className={styles.nodeCount}
                title={t('overview.flow.recent_title', { count: recent })}
              >
                <span className={styles.srOnly}>
                  {t('overview.flow.recent_title', { count: recent })}
                </span>
                <span aria-hidden="true">{count(recent)}</span>
                <span className={styles.nodeCountUnit} aria-hidden="true">
                  {t('overview.flow.recent_unit')}
                </span>
              </span>
            )}
          </>
        ),
      };
    });
    const total = trafficTotal(group.traffic);
    return {
      id: group.provider,
      label: providerLabel(group.provider),
      meta:
        total > 0
          ? t('overview.flow.requests', { count: total, formatted: count(total) })
          : t('overview.flow.accounts', { count: group.accounts.length }),
      share: share(total),
      state: providerState(accounts.map((account) => account.state)),
      accounts,
    };
  });
}
