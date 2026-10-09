/**
 * PROTOTYPE B · Two cards (file kept short: VariantCards). The order is the headline; two stacked cards ("1st" / "Backup")
 * with one swap button between them. Swapping glides the cards past each other (FLIP).
 */
import { useLayoutEffect, useRef } from 'react';
import { describeServing, resetHint, type ProtoModel } from './useProtoRoutesModel';
import { Advanced, Footnotes, Health, WeeklyMeter } from './shared';
import { usePrefersReducedMotion } from './protoUtils';
import shared from './Prototype.module.scss';
import styles from './VariantCards.module.scss';

export function VariantCards({ model }: { model: ProtoModel }) {
  const reduced = usePrefersReducedMotion();
  const cardRefs = useRef<Record<string, HTMLElement | null>>({});
  const lastRects = useRef<Record<string, DOMRect>>({});
  const orderKey = model.order.map((account) => account.id).join('|');

  // FLIP: cards slide from their previous slot to the new one.
  useLayoutEffect(() => {
    const previous = lastRects.current;
    const next: Record<string, DOMRect> = {};
    Object.entries(cardRefs.current).forEach(([id, element]) => {
      if (!element) return;
      const rect = element.getBoundingClientRect();
      next[id] = rect;
      const before = previous[id];
      if (!before || reduced) return;
      const dy = before.top - rect.top;
      if (Math.abs(dy) < 1) return;
      element.animate([{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }], {
        duration: 380,
        easing: 'cubic-bezier(0.23, 1, 0.32, 1)',
      });
    });
    lastRects.current = next;
  }, [orderKey, reduced]);

  const [first, second] = model.order;
  const serving = describeServing(model);
  const hint = resetHint(model);
  const swap = () => {
    if (!first || !second) return;
    model.setOrder([second.id, first.id, ...model.order.slice(2).map((account) => account.id)]);
  };

  const title =
    first && second && !model.sameLevel
      ? `${first.label} first, ${second.label} as backup.`
      : first && second
        ? `${first.label} and ${second.label} share the load.`
        : 'Your Claude account';

  return (
    <>
      <p className={shared.eyebrow}>Claude</p>
      <h1 className={shared.title}>{title}</h1>
      <p className={styles.summary} aria-live="polite">
        {serving.lead} {serving.follow}
      </p>

      <ol className={styles.stack} aria-label="Claude accounts in order">
        {model.order.map((account, index) => (
          <li
            key={account.id}
            ref={(element) => {
              cardRefs.current[account.id] = element;
            }}
            className={styles.card}
            data-serving={account.role === 'active'}
          >
            <div className={styles.cardHead}>
              <span className={styles.rank}>
                {model.sameLevel ? 'Shared' : index === 0 ? '1st' : 'Backup'}
              </span>
              {account.role === 'active' && <span className={styles.now}>Now</span>}
            </div>
            <div className={styles.name}>{account.label}</div>
            <Health account={account} />
            <WeeklyMeter account={account} />
          </li>
        ))}
      </ol>

      {first && second && (
        <div className={styles.swapRow}>
          <button
            type="button"
            className={styles.swap}
            onClick={swap}
            aria-label={`Swap order: make ${second.label} first`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Make {second.label} first
          </button>
          {hint && (
            <p className={styles.hint} data-good={hint.good}>
              {hint.text}
            </p>
          )}
        </div>
      )}

      <Footnotes model={model} />
      <Advanced model={model} />
    </>
  );
}
