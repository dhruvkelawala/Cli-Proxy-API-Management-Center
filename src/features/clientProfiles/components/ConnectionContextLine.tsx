import { useTranslation } from 'react-i18next';
import type { ConnectionContext } from '../connectionContext';
import { CR } from '../copy';
import styles from './ConnectionContextLine.module.scss';

/**
 * Configured path from a client to the gateway. Topology only: it never claims the machine or
 * tunnel is online, and an unset context stays "not set".
 */
export function ConnectionContextLine({
  context,
  compact = false,
}: {
  context: ConnectionContext | null;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  if (!context) {
    return <span className={styles.unset}>{t(`${CR}.connection.unset`)}</span>;
  }
  return (
    <span className={styles.line}>
      <span className={styles.path}>{t(`${CR}.connection.path_${context}`)}</span>
      {!compact && <span className={styles.note}>{t(`${CR}.connection.note`)}</span>}
    </span>
  );
}
