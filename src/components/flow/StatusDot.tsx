import styles from './StatusDot.module.scss';

/** ok: working. warn: degraded or cooling down. bad: failing or out. off: turned off. */
export type StatusTone = 'ok' | 'warn' | 'bad' | 'off' | 'unknown';

/** Health in one quiet line: a coloured dot (the only colour) and plain words. */
export function StatusDot({ tone, label }: { tone: StatusTone; label: string }) {
  return (
    <span className={styles.status} data-tone={tone}>
      <span className={styles.dot} aria-hidden="true" />
      <span className={styles.text}>{label}</span>
    </span>
  );
}
