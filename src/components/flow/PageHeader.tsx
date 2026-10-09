import type { ReactNode } from 'react';
import styles from './PageHeader.module.scss';

export interface PageHeaderProps {
  /** Sentence that states the outcome, e.g. "New conversations go to Work." */
  title: ReactNode;
  /** One quiet line of consequence or context. */
  subtitle?: ReactNode;
  /** Small uppercase context label above the title. */
  eyebrow?: ReactNode;
  /** Announce subtitle changes (when the title sentence reacts to user actions). */
  live?: boolean;
  /** Optional quiet actions on the right. */
  actions?: ReactNode;
  /**
   * 1 (default): the page headline (h1). 2: a later section on the same page (h2, a step
   * smaller), e.g. Routing's second provider.
   */
  level?: 1 | 2;
  /** Id for the title, so a section can be labelled by it. */
  titleId?: string;
}

/**
 * Flow page header: eyebrow, sentence title, quiet subtitle. The title fades in softly when its
 * sentence changes (keyed on its text); reduced motion shows it at once.
 */
export function PageHeader({
  title,
  subtitle,
  eyebrow,
  live = false,
  actions,
  level = 1,
  titleId,
}: PageHeaderProps) {
  const titleKey = typeof title === 'string' ? title : undefined;
  const Title = level === 2 ? 'h2' : 'h1';
  return (
    <header className={styles.header}>
      <div className={styles.copy}>
        {eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
        <Title
          key={titleKey}
          id={titleId}
          className={styles.title}
          data-level={level === 2 ? 'section' : undefined}
        >
          {title}
        </Title>
        {subtitle ? (
          <p className={styles.subtitle} aria-live={live ? 'polite' : undefined}>
            {subtitle}
          </p>
        ) : null}
      </div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </header>
  );
}
