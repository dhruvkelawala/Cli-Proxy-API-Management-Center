import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import type { AccountClientLinks as Links } from '../accountLinks';
import { CR, providerLabelKey } from '../copy';
import styles from './AccountClientLinks.module.scss';

/** Pinned-client chips and the "Use only this subscription for…" action on an account card. */
export function AccountClientLinks({
  links,
  accountName,
  disabled,
  onUseOnlyFor,
}: {
  links: Links;
  accountName: string;
  disabled: boolean;
  onUseOnlyFor: () => void;
}) {
  const { t } = useTranslation();
  const provider = t(providerLabelKey(links.provider));
  return (
    <section
      className={styles.links}
      aria-label={t(`${CR}.accounts.section_aria`, { account: accountName })}
    >
      {links.pinned.length > 0 && (
        <div className={styles.pinned}>
          <span className={styles.label}>{t(`${CR}.accounts.pinned_label`)}</span>
          <ul className={styles.chips}>
            {links.pinned.map((pin) => (
              <li
                key={pin.profileRef}
                className={`${styles.chip} ${links.willFail ? styles.chipFail : ''}`}
                title={t(`${CR}.accounts.chip_title`, { profile: pin.label, provider })}
              >
                <span className={styles.chipLabel}>{pin.label}</span>
                {links.willFail && (
                  <span className={styles.chipTag}>{t(`${CR}.pill.will_fail`)}</span>
                )}
              </li>
            ))}
          </ul>
          {links.willFail && (
            <p className={styles.failNote}>
              {t(`${CR}.accounts.will_fail_note`, { count: links.pinned.length })}
            </p>
          )}
        </div>
      )}
      <Button
        variant="secondary"
        size="sm"
        className={styles.action}
        onClick={onUseOnlyFor}
        disabled={disabled || links.action === 'unsupported'}
        aria-label={t(`${CR}.accounts.use_only_aria`, { account: accountName })}
        title={links.action === 'unsupported' ? t(`${CR}.accounts.unsupported`) : undefined}
      >
        {t(`${CR}.accounts.use_only`)}
      </Button>
    </section>
  );
}
