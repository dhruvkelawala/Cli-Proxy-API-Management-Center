import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DeviceGlyph,
  FlowDiagram,
  PageHeader,
  QuotaRail,
  StatusDot,
  type FlowDestination,
  type FlowPathState,
  type FlowSource,
} from '@/components/flow';
import {
  describeClientsLine,
  describeServing,
  healthCopy,
  healthTone,
  quotaCopy,
  rankKey,
  resetHint,
  orderWithFirst,
  type ClientRoute,
  type Copy,
  type FormatWhen,
  type JoinNames,
  type OrderAccount,
  type OrderModel,
} from './routingOrder';
import styles from './RoutingPage.module.scss';

export interface RoutingHeroProps {
  model: OrderModel;
  /** Client profiles resolved against the order; null when profiles are unsupported. */
  routes: ClientRoute[] | null;
  /** The quiet line for the other provider (Codex), if any. */
  otherLine: Copy | null;
  hubLabel?: string;
  saving: boolean;
  simulateOut: string | null;
  formatWhen: FormatWhen;
  joinNames: JoinNames;
  onReorder: (ids: string[]) => void;
  onPreview: (accountId: string | null) => void;
  /** Quiet notices shown in the main view (enforcement, load problems). */
  notices?: ReactNode;
}

type Card = FlowDestination & { account: OrderAccount };

const pathState = (account: OrderAccount): FlowPathState =>
  account.role === 'active'
    ? 'live'
    : account.role === 'next' || account.role === 'backup'
      ? 'waiting'
      : 'out';

/**
 * The Routing page's main view: the sentence, the live flow (clients → gateway → accounts in
 * order) and the few lines that matter. Presentational; state lives in useRoutingOrder.
 */
export function RoutingHero({
  model,
  routes,
  otherLine,
  hubLabel,
  saving,
  simulateOut,
  formatWhen,
  joinNames,
  onReorder,
  onPreview,
  notices,
}: RoutingHeroProps) {
  const { t } = useTranslation();
  const text = (copy: Copy) => t(copy.key, copy.values);
  const serving = describeServing(model, joinNames, formatWhen);
  const hint = resetHint(model, formatWhen);
  const clients = describeClientsLine(routes ?? [], joinNames);
  const [first] = model.order;

  const sources: FlowSource[] =
    routes && routes.length > 0
      ? routes.map((route) => ({
          id: route.profile.profileRef,
          label: route.shortName,
          icon: <DeviceGlyph />,
          // Off accounts are not in the diagram: a lock to one shows as a broken path.
          lockedTo:
            route.locked && route.target && route.target.role !== 'off' ? route.target.id : null,
          problem: route.refused || (route.locked && route.broken),
        }))
      : [{ id: 'all', label: t('routing.all_clients'), icon: <DeviceGlyph /> }];

  const cards: Card[] = model.order.map((account) => ({
    id: account.id,
    state: pathState(account),
    account,
  }));

  const statusText = (account: OrderAccount) => text(healthCopy(account, formatWhen));
  const quotaText = (account: OrderAccount) => {
    const copy = quotaCopy(account, formatWhen);
    return copy ? text(copy) : undefined;
  };

  return (
    <>
      <PageHeader
        eyebrow={t('routing.eyebrow')}
        title={text(serving.title)}
        subtitle={text(serving.follow)}
        live
      />

      {cards.length > 0 && (
        <div className={styles.hero}>
          <FlowDiagram
            sources={sources}
            destinations={cards}
            label={t('routing.list_label')}
            hubLabel={hubLabel}
            reorderHint={t('routing.reorder_hint')}
            onReorder={onReorder}
            reorderDisabled={saving}
            destinationLabel={(card, place) =>
              t('routing.card_label', {
                rank: t(rankKey(card.account, place, model.shared)),
                account: card.account.label,
                status: [statusText(card.account), quotaText(card.account)]
                  .filter(Boolean)
                  .join('. '),
              })
            }
            renderDestination={(card, place) => (
              <>
                <span
                  className={styles.rank}
                  data-first={place === 0 && !model.shared && card.account.role === 'active'}
                >
                  {t(rankKey(card.account, place, model.shared))}
                </span>
                <span className={styles.accountName}>{card.account.label}</span>
                <StatusDot tone={healthTone(card.account)} label={statusText(card.account)} />
                <QuotaRail
                  percentLeft={
                    card.account.quota.status === 'ready' && card.account.health !== 'disabled'
                      ? card.account.quota.weekLeft
                      : null
                  }
                  label={t('routing.quota.meter_label', { account: card.account.label })}
                  caption={quotaText(card.account)}
                />
              </>
            )}
          />
        </div>
      )}

      {model.off.length > 0 && (
        <ul className={styles.offList} aria-label={t('routing.off_list_label')}>
          {model.off.map((account) => (
            <li key={account.id}>
              <span className={styles.offRank}>{t('routing.rank.off')}</span>
              <span className={styles.offName}>{account.label}</span>
              <StatusDot tone="off" label={t('routing.health.disabled')} />
            </li>
          ))}
        </ul>
      )}

      {cards.length > 0 && (
        <div className={styles.below}>
          <p className={styles.hint}>
            <span>
              {hint
                ? text(hint.copy)
                : cards.length > 1
                  ? t('routing.hint.drag')
                  : t('routing.hint.single')}
            </span>
            {hint?.account && (
              <button
                type="button"
                className={styles.textButton}
                disabled={saving}
                onClick={() => onReorder(orderWithFirst(model.order, hint.account!.id))}
              >
                {t('routing.make_first', { account: hint.account.label })}
              </button>
            )}
          </p>
          <div className={styles.actionsRow}>
            {first && cards.length > 1 && (simulateOut || first.role === 'active') && (
              <button
                type="button"
                className={styles.textButton}
                aria-pressed={simulateOut !== null}
                onClick={() => onPreview(simulateOut ? null : first.id)}
              >
                {simulateOut
                  ? t('routing.preview_end')
                  : t('routing.preview_start', { account: first.label })}
              </button>
            )}
            <span className={styles.saving} role="status">
              {saving ? t('routing.saving') : ''}
            </span>
          </div>
        </div>
      )}

      <div className={styles.footnotes}>
        {routes !== null && (
          <p data-problem={clients.problem}>
            <DeviceGlyph />
            <span>{clients.copies.map(text).join(' ')}</span>
          </p>
        )}
        {otherLine && (
          <p>
            <span className={styles.otherMark} aria-hidden="true">
              ◇
            </span>
            <span>{text(otherLine)}</span>
          </p>
        )}
      </div>

      {notices ? <div className={styles.notices}>{notices}</div> : null}
    </>
  );
}
