import { useTranslation } from 'react-i18next';
import type { PolicyCell, PoolPreview } from '../model';
import { CR, targetStateKey } from '../copy';
import styles from './PolicyPill.module.scss';

const MAX_SHARE_CAPTION = 2;

/**
 * Visual summary of one rule. Its text is part of the surrounding button's accessible name (the
 * button adds hidden context around it), so everything shown here is read; decorative dots and
 * bars are aria-hidden.
 */
export function PolicyPill({ cell }: { cell: PolicyCell }) {
  const { t } = useTranslation();

  if (cell.kind === 'unknown') {
    return (
      <span className={styles.cell}>
        <span className={`${styles.pill} ${styles.pillFail}`}>
          {t(`${CR}.pill.unknown_rule`)}
          <span className={styles.srSeparator}>, </span>
          <span className={styles.failTag}>{t(`${CR}.pill.will_fail`)}</span>
        </span>
        <span className={`${styles.caption} ${styles.captionFail}`}>
          {t(targetStateKey('unknown_mode'))}
        </span>
      </span>
    );
  }

  if (cell.kind === 'only') {
    const name = cell.accountLabel ?? t(`${CR}.pill.removed_account`);
    if (cell.willFail) {
      return (
        <span className={styles.cell}>
          <span className={`${styles.pill} ${styles.pillFail}`}>
            {t(`${CR}.pill.only`, { account: name })}
            <span className={styles.srSeparator}>, </span>
            <span className={styles.failTag}>{t(`${CR}.pill.will_fail`)}</span>
          </span>
          <span className={`${styles.caption} ${styles.captionFail}`}>
            {t(targetStateKey(cell.state))}
          </span>
        </span>
      );
    }
    const known = cell.state === 'available';
    return (
      <span className={styles.cell}>
        <span className={`${styles.pill} ${styles.pillOnly}`}>
          <span className={styles.onlyDot} aria-hidden="true" />
          {t(`${CR}.pill.only`, { account: name })}
        </span>
        <span className={styles.caption}>
          <span
            className={`${styles.dot} ${known ? styles.dotOk : styles.dotUnknown}`}
            aria-hidden="true"
          />
          {known ? t(`${CR}.pill.available`) : t(`${CR}.pill.availability_unknown`)}
        </span>
      </span>
    );
  }

  return (
    <span className={styles.cell}>
      <span className={`${styles.pill} ${cell.willFail ? styles.pillFail : styles.pillAuto}`}>
        {t(`${CR}.pill.automatic`)}
        {cell.willFail && (
          <>
            <span className={styles.srSeparator}>, </span>
            <span className={styles.failTag}>{t(`${CR}.pill.will_fail`)}</span>
          </>
        )}
      </span>
      <PoolCaption pool={cell.pool} />
    </span>
  );
}

function PoolCaption({ pool }: { pool: PoolPreview }) {
  const { t } = useTranslation();
  if (!pool.known) {
    return <span className={styles.caption}>{t(`${CR}.pill.pool_unknown`)}</span>;
  }
  if (!pool.hasParticipants) {
    return (
      <span className={`${styles.caption} ${styles.captionFail}`}>
        {t(`${CR}.pill.pool_empty`)}
      </span>
    );
  }
  const shown = pool.candidates.filter((member) => (member.sharePercent ?? 0) > 0);
  const caption = shown
    .slice(0, MAX_SHARE_CAPTION)
    .map((member) =>
      t(`${CR}.pill.share`, {
        account: member.label,
        percent: Math.round(member.sharePercent ?? 0),
      })
    )
    .join(' · ');
  const more = shown.length - MAX_SHARE_CAPTION;
  return (
    <>
      <ShareBar pool={pool} />
      <span className={styles.caption}>
        {caption}
        {more > 0 ? ` · ${t(`${CR}.pill.more`, { count: more })}` : ''}
      </span>
    </>
  );
}

/** Illustrative configured shares. Striped segments = availability unknown. */
export function ShareBar({ pool }: { pool: PoolPreview }) {
  if (!pool.known || !pool.hasParticipants) return null;
  return (
    <span className={styles.bar} aria-hidden="true">
      {pool.candidates
        .filter((member) => (member.sharePercent ?? 0) > 0)
        .map((member, index) => (
          <span
            key={member.id}
            className={[
              styles.segment,
              index % 2 === 1 ? styles.segmentAlt : '',
              member.availability === 'unknown' ? styles.segmentUnknown : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={{ flexGrow: member.sharePercent ?? 0 }}
          />
        ))}
    </span>
  );
}
