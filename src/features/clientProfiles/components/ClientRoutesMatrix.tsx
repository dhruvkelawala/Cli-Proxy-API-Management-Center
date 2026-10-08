import { useTranslation } from 'react-i18next';
import { CLIENT_PROFILE_PROVIDERS, type ClientProfileProvider } from '@/types/clientProfiles';
import type { ConnectionContext } from '../connectionContext';
import { matrixCellId, type ProfileRow } from '../model';
import { CR, providerLabelKey } from '../copy';
import { PolicyPill } from './PolicyPill';
import { ConnectionContextLine } from './ConnectionContextLine';
import styles from './ClientRoutesMatrix.module.scss';

type ClientRoutesMatrixProps = {
  rows: ProfileRow[];
  contexts: Record<string, ConnectionContext>;
  onOpenCell: (profileRef: string, provider: ClientProfileProvider) => void;
  onOpenProfile: (profileRef: string) => void;
};

/** Overview: client profile × provider. Each cell opens the rule editor. */
export function ClientRoutesMatrix({
  rows,
  contexts,
  onOpenCell,
  onOpenProfile,
}: ClientRoutesMatrixProps) {
  const { t } = useTranslation();

  return (
    <div className={styles.frame}>
      <table className={styles.table}>
        <caption className={styles.caption}>{t(`${CR}.matrix.caption`)}</caption>
        <thead>
          <tr>
            <th scope="col" className={styles.headProfile}>
              {t(`${CR}.matrix.profile_column`)}
            </th>
            {CLIENT_PROFILE_PROVIDERS.map((provider) => (
              <th key={provider} scope="col">
                {t(providerLabelKey(provider))}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const { profile } = row;
            return (
              <tr key={profile.profileRef} className={styles.row}>
                <th scope="row" className={styles.profileCell}>
                  <button
                    type="button"
                    className={styles.profileButton}
                    onClick={() => onOpenProfile(profile.profileRef)}
                    aria-label={t(`${CR}.matrix.edit_profile`, { name: profile.label })}
                  >
                    {profile.label}
                  </button>
                  <ConnectionContextLine context={contexts[profile.profileRef] ?? null} compact />
                  <span className={styles.keyCount}>
                    {row.keyCount > 0
                      ? t(`${CR}.matrix.keys_count`, { count: row.keyCount })
                      : t(`${CR}.matrix.no_keys`)}
                  </span>
                </th>
                {CLIENT_PROFILE_PROVIDERS.map((provider) => {
                  const cell = row.cells[provider];
                  const providerName = t(providerLabelKey(provider));
                  return (
                    <td key={provider} className={styles.policyCell}>
                      <button
                        type="button"
                        className={`${styles.cellButton} ${cell.willFail ? styles.cellFail : ''}`}
                        data-cell={matrixCellId(profile.profileRef, provider)}
                        onClick={() => onOpenCell(profile.profileRef, provider)}
                      >
                        {/* The name is built from the visible text (WCAG 2.5.3), plus hidden context. */}
                        <span className={styles.visuallyHidden}>
                          {t(`${CR}.matrix.cell_context`, { profile: profile.label })}{' '}
                        </span>
                        <span className={styles.mobileProvider}>{providerName} </span>
                        <PolicyPill cell={cell} />
                        <span className={styles.visuallyHidden}>
                          {' '}
                          {t(`${CR}.matrix.cell_change`)}
                        </span>
                      </button>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className={styles.footnote}>{t(`${CR}.matrix.footnote`)}</p>
    </div>
  );
}
