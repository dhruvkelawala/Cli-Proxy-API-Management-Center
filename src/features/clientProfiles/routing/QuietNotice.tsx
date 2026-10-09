import type { ReactNode } from 'react';
import { IconAlertTriangle, IconInfo } from '@/components/ui/icons';
import styles from './RoutingPage.module.scss';

/** A one-line notice in the Flow style: an icon, quiet text, colour only for the icon. */
export function QuietNotice({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'warn' | 'danger';
  children: ReactNode;
}) {
  const Icon = tone === 'info' ? IconInfo : IconAlertTriangle;
  return (
    <p
      className={styles.quietNotice}
      data-tone={tone}
      role={tone === 'danger' ? 'alert' : undefined}
    >
      <Icon size={15} aria-hidden="true" />
      <span className={styles.quietNoticeText}>{children}</span>
    </p>
  );
}
