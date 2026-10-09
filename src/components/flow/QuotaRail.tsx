import styles from './QuotaRail.module.scss';

export interface QuotaRailProps {
  /** Percent left, 0-100. Null hides the rail (unknown is never drawn as empty). */
  percentLeft: number | null;
  /** Accessible name of the meter, e.g. "Work: weekly quota left". */
  label: string;
  /** Quiet caption under the rail, e.g. "54% left this week · resets Tue 9:06 PM". */
  caption?: string;
  /** At or below this, the fill turns to the danger tone. */
  lowAt?: number;
}

/** Hairline quota meter that fills from the left, with an optional caption (reset time). */
export function QuotaRail({ percentLeft, label, caption, lowAt = 15 }: QuotaRailProps) {
  const left = percentLeft === null ? null : Math.max(0, Math.min(100, Math.round(percentLeft)));
  return (
    <div className={styles.rail}>
      {left !== null && (
        <span
          className={styles.track}
          role="meter"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={left}
          aria-valuetext={caption}
        >
          <span
            className={styles.fill}
            data-low={left <= lowAt}
            style={{ transform: `scaleX(${Math.max(left, 1) / 100})` }}
          />
        </span>
      )}
      {caption ? <span className={styles.caption}>{caption}</span> : null}
    </div>
  );
}
