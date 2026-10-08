import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { IconAlertTriangle, IconInfo } from '@/components/ui/icons';
import type { ClientProfilesFailure } from '@/stores/useClientProfilesStore';
import { CR, failureKey, failureOffersReload, targetStateKey } from '../copy';
import styles from './Notices.module.scss';

type Tone = 'info' | 'danger';

export function Notice({
  tone = 'info',
  title,
  children,
  action,
  live = false,
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  /** Announce politely; use for results of a user action. */
  live?: boolean;
}) {
  const Icon = tone === 'danger' ? IconAlertTriangle : IconInfo;
  return (
    <div
      className={`${styles.notice} ${tone === 'danger' ? styles.danger : styles.info}`}
      role={live ? (tone === 'danger' ? 'alert' : 'status') : undefined}
    >
      <Icon className={styles.icon} size={16} aria-hidden="true" />
      <div className={styles.body}>
        {title && <p className={styles.title}>{title}</p>}
        {children && <div className={styles.text}>{children}</div>}
        {action && <div className={styles.action}>{action}</div>}
      </div>
    </div>
  );
}

/** Calm notice: saved rules are stored, but strict requests are rejected until CPA-003. */
export function EnforcementNotice() {
  const { t } = useTranslation();
  return (
    <Notice title={t(`${CR}.enforcement.title`)}>
      <p>{t(`${CR}.enforcement.body`)}</p>
    </Notice>
  );
}

/** Explains a failed write. Never claims success; offers Reload when re-reading helps. */
export function FailureNotice({
  failure,
  onReload,
  reloading = false,
  title,
}: {
  failure: ClientProfilesFailure;
  onReload?: () => void;
  reloading?: boolean;
  /** Defaults to "Not saved" (write failures). */
  title?: string;
}) {
  const { t } = useTranslation();
  const reason =
    failure.kind === 'target_invalid' && failure.error.code
      ? t(targetStateKey(failure.error.code as Parameters<typeof targetStateKey>[0]))
      : '';
  return (
    <Notice
      tone="danger"
      live
      title={title ?? t(`${CR}.errors.title`)}
      action={
        onReload && failureOffersReload(failure) ? (
          <Button variant="secondary" size="sm" onClick={onReload} loading={reloading}>
            {t(`${CR}.errors.reload`)}
          </Button>
        ) : undefined
      }
    >
      <p>{t(failureKey(failure), { reason })}</p>
    </Notice>
  );
}
