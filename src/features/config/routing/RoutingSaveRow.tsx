import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import styles from './RoutingSaveRow.module.scss';

export type RoutingSaveTone = 'clean' | 'dirty' | 'saving' | 'saved' | 'warning' | 'failed';

export interface RoutingSaveRowProps {
  /** Scope notice shown beside the save action. */
  scope: string;
  status: string;
  tone: RoutingSaveTone;
  saveLabel: string;
  saveDisabled: boolean;
  discardDisabled: boolean;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
}

/** Scoped save: what the save affects, the honest state of this save, and its actions. */
export function RoutingSaveRow({
  scope,
  status,
  tone,
  saveLabel,
  saveDisabled,
  discardDisabled,
  saving,
  onSave,
  onDiscard,
}: RoutingSaveRowProps) {
  const { t } = useTranslation();
  return (
    <div className={styles.row}>
      <div className={styles.copy}>
        <span className={styles.scope}>{scope}</span>
        <span className={`${styles.status} ${styles[tone]}`} role="status" aria-live="polite">
          {status}
        </span>
      </div>
      <div className={styles.actions}>
        <Button variant="ghost" size="sm" disabled={discardDisabled || saving} onClick={onDiscard}>
          {t('config_management.routing_settings.actions.discard')}
        </Button>
        <Button size="sm" disabled={saveDisabled} loading={saving} onClick={onSave}>
          {saveLabel}
        </Button>
      </div>
    </div>
  );
}
