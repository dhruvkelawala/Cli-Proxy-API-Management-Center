import type { CSSProperties } from 'react';
import type { AccountTitle } from '@/features/authFiles/identity';
import styles from './AuthFileCard.module.scss';

export type AuthFileAccountHeadingProps = {
  title: AccountTitle;
  typeLabel: string;
  typeStyle: CSSProperties;
};

/** Card heading: provider pill + displayed title (note when set, otherwise the account). */
export function AuthFileAccountHeading({
  title,
  typeLabel,
  typeStyle,
}: AuthFileAccountHeadingProps) {
  return (
    <h3 className={styles.identity}>
      <span className={styles.providerBadge} style={typeStyle}>
        {typeLabel}
      </span>
      <span
        className={`${styles.account} ${title.titleMono ? styles.accountMono : ''}`}
        title={title.title}
      >
        {title.title}
      </span>
    </h3>
  );
}

/** Secondary lines under the heading: the account under a note title, then the file name. */
export function AuthFileAccountSubtitle({ title }: { title: AccountTitle }) {
  return (
    <>
      {title.account && (
        <p className={styles.accountLine} title={title.account}>
          {title.account}
        </p>
      )}
      {title.fileLine && (
        <p className={styles.fileName} title={title.fullName}>
          {title.fileLine}
        </p>
      )}
    </>
  );
}
