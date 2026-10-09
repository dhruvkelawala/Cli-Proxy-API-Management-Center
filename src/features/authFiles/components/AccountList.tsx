import { useTranslation } from 'react-i18next';
import type { AuthFileItem } from '@/types';
import { getTypeLabel } from '@/features/authFiles/constants';
import type { AccountPresentation } from '@/features/authFiles/accountPresentation';
import type { QuotaIndicator } from '@/features/quota/quotaSummary';
import type { AccountClientLinks } from '@/features/clientProfiles/accountLinks';
import { groupByProvider } from '../accountsView';
import { AccountRow } from './AccountRow';
import styles from './AccountList.module.scss';

export interface AccountListProps {
  files: AuthFileItem[];
  presentations: Map<AuthFileItem, AccountPresentation>;
  indicatorFor: (file: AuthFileItem) => QuotaIndicator | null;
  linksFor: (file: AuthFileItem) => AccountClientLinks | null;
  /** Show provider headings (when more than one provider is listed). */
  grouped: boolean;
  selecting: boolean;
  selectedFiles: Set<string>;
  isToggleDisabled: (file: AuthFileItem) => boolean;
  /** Stagger the rows in once (the first render with data). */
  animateEntrance: boolean;
  onOpen: (file: AuthFileItem) => void;
  onToggleStatus: (file: AuthFileItem, enabled: boolean) => void;
  onToggleSelect: (name: string) => void;
}

/** The Accounts list: one row per account, grouped by provider. */
export function AccountList({
  files,
  presentations,
  indicatorFor,
  linksFor,
  grouped,
  selecting,
  selectedFiles,
  isToggleDisabled,
  animateEntrance,
  onOpen,
  onToggleStatus,
  onToggleSelect,
}: AccountListProps) {
  const { t } = useTranslation();
  const sections = grouped ? groupByProvider(files) : [{ provider: '', files }];
  let index = 0;

  return (
    <div className={styles.list}>
      {sections.map((section) => {
        const label = section.provider ? getTypeLabel(t, section.provider) : '';
        const headingId = `accounts-${section.provider || 'all'}`;
        return (
          <section
            key={section.provider || 'all'}
            className={styles.section}
            aria-labelledby={label ? headingId : undefined}
            aria-label={label ? undefined : t('auth_files.title_section')}
          >
            {label && (
              <h2 id={headingId} className={styles.sectionTitle}>
                <span>{label}</span>
                <span className={styles.sectionCount}>{section.files.length}</span>
              </h2>
            )}
            <ul className={styles.rows}>
              {section.files.map((file) => (
                <AccountRow
                  key={file.name}
                  file={file}
                  presentation={presentations.get(file)}
                  indicator={indicatorFor(file)}
                  clientLinks={linksFor(file)}
                  selecting={selecting}
                  selected={selectedFiles.has(file.name)}
                  toggleDisabled={isToggleDisabled(file)}
                  entranceIndex={animateEntrance ? index++ : null}
                  onOpen={onOpen}
                  onToggleStatus={onToggleStatus}
                  onToggleSelect={onToggleSelect}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
