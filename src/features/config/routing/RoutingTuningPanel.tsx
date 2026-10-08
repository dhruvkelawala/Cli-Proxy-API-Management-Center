import { useId } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { getTypeLabel } from '@/features/authFiles/constants';
import { deriveAccountTitle } from '@/features/authFiles/identity';
import type { AuthFileItem } from '@/types';
import type { RoutingStrategy } from '@/types/visualConfig';
import { MAX_CREDENTIAL_WEIGHT } from '@/utils/credentialWeight';
import {
  buildRoutingPresentation,
  type RoutingAccountPresentation,
  type RoutingParticipationReason,
} from './routingPresentation';
import { STRATEGY_LABEL_KEYS, formatSharePercent } from './routingFormat';
import {
  isAccountTuningDirty,
  readAccountTuningText,
  toRoutingAccountInput,
  type AccountTuningEdits,
  type AccountTuningErrors,
} from './routingSettingsState';
import type { AccountSaveState } from './useRoutingSettings';
import { RoutingShareBar } from './RoutingShareBar';
import styles from './RoutingTuningPanel.module.scss';

const ROLE_KEYS: Record<RoutingParticipationReason, string> = {
  participating: 'participating',
  standby: 'standby',
  'unknown-availability': 'unknown',
  disabled: 'disabled',
  unavailable: 'unavailable',
  'lower-priority': 'lower_priority',
  'non-positive-weight': 'non_positive_weight',
};

export interface RoutingTuningPanelProps {
  strategy: RoutingStrategy;
  sessionAffinity: { enabled: boolean; ttl?: string };
  files: AuthFileItem[] | null;
  loading: boolean;
  error: string | null;
  edits: Record<string, AccountTuningEdits>;
  errors: Record<string, AccountTuningErrors>;
  save: AccountSaveState;
  /** Inputs stay editable while a save runs (newer typing is kept); only a lost connection locks them. */
  disabled?: boolean;
  onChange: (name: string, edits: AccountTuningEdits) => void;
  onRetry: () => void;
}

function StatusDot({ account, label }: { account: RoutingAccountPresentation; label: string }) {
  const tone = !account.enabled
    ? 'off'
    : account.availability === 'unavailable'
      ? 'bad'
      : account.availability === 'unknown'
        ? 'unknown'
        : 'ok';
  return (
    <span className={`${styles.dot} ${styles[`dot_${tone}`]}`} data-tone={tone}>
      <span className={styles.srOnly}>{label}</span>
    </span>
  );
}

/** Accounts per provider with enabled state, priority, weight, role and an illustrative share. */
export function RoutingTuningPanel({
  strategy,
  sessionAffinity,
  files,
  loading,
  error,
  edits,
  errors,
  save,
  disabled = false,
  onChange,
  onRetry,
}: RoutingTuningPanelProps) {
  const { t } = useTranslation();
  const idPrefix = useId();
  const hintId = `${idPrefix}-hint`;

  if (error !== null) {
    return (
      <div className={styles.state} role="alert">
        <p>{t('config_management.routing_settings.sheet.load_failed', { message: error })}</p>
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {t('config_management.routing_settings.sheet.retry')}
        </Button>
      </div>
    );
  }
  if (files === null || (loading && files.length === 0)) {
    return (
      <div className={styles.state} role="status">
        <LoadingSpinner size={14} />
        <span>{t('config_management.routing_settings.sheet.loading')}</span>
      </div>
    );
  }
  if (files.length === 0) {
    return (
      <div className={styles.state}>
        <p>{t('config_management.routing_settings.sheet.empty')}</p>
      </div>
    );
  }

  const presentation = buildRoutingPresentation({
    strategy,
    sessionAffinity,
    accounts: files.map((file) => toRoutingAccountInput(file, edits[file.name])),
  });
  const strategyLabel = t(STRATEGY_LABEL_KEYS[strategy]);
  const weightsInactive = !presentation.weightControlsRelevant;
  const failures = new Map(save.failures.map((failure) => [failure.name, failure.message]));

  const groups = presentation.pools.map((pool) => ({
    pool,
    rows: files
      .map((file, index) => ({ file, account: presentation.accounts[index] }))
      .filter(({ account }) => account.provider === pool.provider),
  }));

  return (
    <div className={styles.panel}>
      <div className={styles.intro}>
        <p id={hintId} className={styles.hint}>
          <span>
            <strong>{t('config_management.routing_settings.sheet.priority_label')}</strong>{' '}
            {t('config_management.routing_settings.sheet.priority_hint')}
          </span>
          <span>
            <strong>{t('config_management.routing_settings.sheet.weight_label')}</strong>{' '}
            {weightsInactive
              ? t('config_management.routing_settings.sheet.weight_hint_inactive')
              : t('config_management.routing_settings.sheet.weight_hint')}
          </span>
        </p>
        {weightsInactive && (
          <p className={styles.note}>
            {t('config_management.routing_settings.sheet.inactive_note')}
          </p>
        )}
        <p className={styles.keys}>
          <Trans
            i18nKey="config_management.routing_settings.sheet.config_keys_note"
            components={{ providersLink: <Link className={styles.link} to="/ai-providers" /> }}
          />
        </p>
      </div>
      {groups.map(({ pool, rows }) => {
        return (
          <section key={pool.provider} className={styles.group}>
            <h3 className={styles.groupTitle}>{getTypeLabel(t, pool.provider)}</h3>
            <ul className={styles.rows}>
              {rows.map(({ file, account }) => {
                const identity = deriveAccountTitle(file);
                const title = identity.title || file.name;
                const accessibleName = identity.account ? `${title} (${identity.account})` : title;
                const text = { ...readAccountTuningText(file), ...edits[file.name] };
                const rowErrors = errors[file.name];
                const dirty = isAccountTuningDirty(file, edits[file.name]);
                const failure = failures.get(file.name);
                const id = `${idPrefix}-${file.name}`;
                const weightNote =
                  rowErrors?.weight === 'max'
                    ? t('auth_files.weight_invalid_max', { max: MAX_CREDENTIAL_WEIGHT })
                    : rowErrors?.weight
                      ? t('auth_files.weight_invalid_integer')
                      : !weightsInactive && account.weight <= 0
                        ? t('config_management.routing_settings.sheet.weight_hint_zero')
                        : null;
                const priorityNote = rowErrors?.priority
                  ? t('config_management.routing_settings.sheet.priority_invalid')
                  : null;
                return (
                  <li
                    key={file.name}
                    className={styles.row}
                    data-dirty={dirty ? 'true' : undefined}
                    data-status={account.status}
                    data-reason={account.reason}
                  >
                    <span className={styles.name}>
                      <StatusDot
                        account={account}
                        label={t(
                          account.enabled
                            ? 'config_management.routing_settings.sheet.enabled_aria'
                            : 'config_management.routing_settings.sheet.disabled_aria',
                          { name: accessibleName }
                        )}
                      />
                      <span className={styles.nameText}>
                        <strong title={file.name}>{title}</strong>
                        {identity.account && (
                          <span className={styles.account}>{identity.account}</span>
                        )}
                      </span>
                    </span>
                    <div className={`${styles.field} ${styles.fieldPriority}`}>
                      <label htmlFor={`${id}-priority`} className={styles.fieldLabel}>
                        {t('config_management.routing_settings.sheet.priority_label')}
                      </label>
                      <input
                        id={`${id}-priority`}
                        className={`input ${styles.input}`}
                        inputMode="numeric"
                        autoComplete="off"
                        disabled={disabled}
                        value={text.priority}
                        placeholder={t(
                          'config_management.routing_settings.sheet.priority_placeholder'
                        )}
                        aria-label={t('config_management.routing_settings.sheet.priority_aria', {
                          name: accessibleName,
                        })}
                        aria-invalid={rowErrors?.priority ? true : undefined}
                        aria-describedby={priorityNote ? `${id}-priority-note ${hintId}` : hintId}
                        onChange={(event) => onChange(file.name, { priority: event.target.value })}
                      />
                      {priorityNote && (
                        <span id={`${id}-priority-note`} className={styles.fieldError}>
                          {priorityNote}
                        </span>
                      )}
                    </div>
                    <div
                      className={`${styles.field} ${styles.fieldWeight} ${weightsInactive ? styles.fieldInactive : ''}`}
                      data-inactive={weightsInactive ? 'true' : undefined}
                    >
                      <label htmlFor={`${id}-weight`} className={styles.fieldLabel}>
                        {t('config_management.routing_settings.sheet.weight_label')}
                      </label>
                      <input
                        id={`${id}-weight`}
                        className={`input ${styles.input}`}
                        inputMode="numeric"
                        autoComplete="off"
                        disabled={disabled}
                        value={text.weight}
                        placeholder={t(
                          'config_management.routing_settings.sheet.weight_placeholder'
                        )}
                        aria-label={t('config_management.routing_settings.sheet.weight_aria', {
                          name: accessibleName,
                        })}
                        aria-invalid={rowErrors?.weight ? true : undefined}
                        aria-describedby={weightNote ? `${id}-weight-note ${hintId}` : hintId}
                        onChange={(event) => onChange(file.name, { weight: event.target.value })}
                      />
                      {weightNote && (
                        <span
                          id={`${id}-weight-note`}
                          className={rowErrors?.weight ? styles.fieldError : styles.fieldHint}
                        >
                          {weightNote}
                        </span>
                      )}
                    </div>
                    <div className={styles.status}>
                      <span
                        className={`${styles.role} ${styles[`role_${account.status}`]}`}
                        title={t(account.reasonKey)}
                      >
                        {t(`config_management.routing_settings.role.${ROLE_KEYS[account.reason]}`)}
                        {account.sharePercent !== null && account.reason !== 'standby' && (
                          <span className={styles.share}>
                            {formatSharePercent(account.sharePercent)}
                          </span>
                        )}
                      </span>
                      {(account.status === 'excluded' || account.reason === 'standby') && (
                        <p className={styles.reason}>{t(account.reasonKey)}</p>
                      )}
                    </div>
                    {failure !== undefined && (
                      <p className={styles.failure} role="alert">
                        {failure || t('config_management.routing_settings.status.failed_no_detail')}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
            <RoutingShareBar
              accounts={rows.map(({ account }) => account)}
              strategyLabel={strategyLabel}
            />
          </section>
        );
      })}
    </div>
  );
}
