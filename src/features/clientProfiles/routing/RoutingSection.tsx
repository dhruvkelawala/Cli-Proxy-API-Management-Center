import { useId } from 'react';
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
  isSingleAccount,
  canReorder,
  hasFixedAccounts,
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

export interface RoutingSectionProps {
  /** Provider key ("claude", "codex", …), for data attributes and ids. */
  provider: string;
  /** Display name ("Claude", "Codex", …). */
  name: string;
  /** The page's first section: carries the page headline (h1); later ones use an h2. */
  primary: boolean;
  model: OrderModel;
  /** Client profiles resolved for this provider; null when profiles are unsupported. */
  routes: ClientRoute[] | null;
  hubLabel?: string;
  saving: boolean;
  simulateOut: string | null;
  formatWhen: FormatWhen;
  joinNames: JoinNames;
  onReorder: (ids: string[]) => void;
  onPreview: (accountId: string | null) => void;
}

type Card = FlowDestination & { account: OrderAccount };

const pathState = (account: OrderAccount): FlowPathState =>
  account.role === 'active'
    ? 'live'
    : account.role === 'next' || account.role === 'backup'
      ? 'waiting'
      : 'out';

/**
 * One provider on the Routing page: its sentence, the live flow (clients → gateway → that
 * provider's accounts in order) and the few lines that matter. With several accounts the order
 * can be changed and a fallback previewed; with one account there is a single solid path and
 * nothing to reorder. Presentational; state lives in useRoutingOrder.
 */
export function RoutingSection({
  provider,
  name,
  primary,
  model,
  routes,
  hubLabel,
  saving,
  simulateOut,
  formatWhen,
  joinNames,
  onReorder,
  onPreview,
}: RoutingSectionProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const text = (copy: Copy) => t(copy.key, copy.values);
  const single = isSingleAccount(model);
  // Runtime-only channels cannot have their priority written: show the order, don't offer to
  // change it.
  const reorderable = canReorder(model);
  const fixed = !single && hasFixedAccounts(model);
  const serving = describeServing(model, joinNames, formatWhen, name);
  const hint = resetHint(model, formatWhen);
  const clients = describeClientsLine(routes ?? [], joinNames, single, name);
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

  const rank = (account: OrderAccount, place: number) =>
    t(rankKey(account, place, model.shared, single));

  return (
    <section
      className={styles.providerSection}
      aria-labelledby={titleId}
      data-provider={provider}
      data-primary={primary}
    >
      <PageHeader
        eyebrow={name}
        title={text(serving.title)}
        subtitle={text(serving.follow)}
        level={primary ? 1 : 2}
        titleId={titleId}
        live
      />

      {cards.length > 0 && (
        <div className={styles.hero}>
          <FlowDiagram
            sources={sources}
            destinations={cards}
            label={t('routing.list_label', { provider: name })}
            hubLabel={hubLabel}
            // One account: one solid path and nothing to move.
            reorderHint={reorderable ? t('routing.reorder_hint') : undefined}
            onReorder={reorderable ? onReorder : undefined}
            reorderDisabled={saving}
            destinationLabel={(card, place) =>
              t('routing.card_label', {
                rank: rank(card.account, place),
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
                  {rank(card.account, place)}
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
        <ul className={styles.offList} aria-label={t('routing.off_list_label', { provider: name })}>
          {model.off.map((account) => (
            <li key={account.id}>
              <span className={styles.offRank}>{t('routing.rank.off')}</span>
              <span className={styles.offName}>{account.label}</span>
              <StatusDot tone="off" label={t('routing.health.disabled')} />
            </li>
          ))}
        </ul>
      )}

      {(cards.length > 1 || simulateOut !== null) && (
        <div className={styles.below}>
          <p className={styles.hint}>
            <span>
              {fixed
                ? t('routing.fixed_note', { provider: name })
                : hint
                  ? text(hint.copy)
                  : t('routing.hint.drag')}
            </span>
            {reorderable && hint?.account && (
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
            {/* "End preview" stays reachable whenever a preview is on. */}
            {first && (simulateOut !== null || (cards.length > 1 && first.role === 'active')) && (
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

      {routes !== null && (
        <div className={styles.footnotes}>
          <p data-problem={clients.problem}>
            <DeviceGlyph />
            <span>{clients.copies.map(text).join(' ')}</span>
          </p>
        </div>
      )}
    </section>
  );
}
