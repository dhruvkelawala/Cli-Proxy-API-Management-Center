import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { DeviceGlyph, QuotaRail, StatusDot } from '@/components/flow';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import type { AuthFileItem } from '@/types';
import { getTypeLabel, isRuntimeOnlyAuthFile } from '@/features/authFiles/constants';
import { deriveAccountTitle } from '@/features/authFiles/identity';
import {
  accountProviderKey,
  isAccountDisabled,
  type AccountPresentation,
} from '@/features/authFiles/accountPresentation';
import type { QuotaIndicator } from '@/features/quota/quotaSummary';
import type { AccountClientLinks } from '@/features/clientProfiles/accountLinks';
import { accountStatus } from '../accountsView';
import styles from './AccountList.module.scss';

export interface AccountRowProps {
  file: AuthFileItem;
  presentation?: AccountPresentation;
  /** The window that runs out first (any provider); null when nothing is known. */
  indicator: QuotaIndicator | null;
  clientLinks?: AccountClientLinks | null;
  /** Batch selection mode: a checkbox leads the row. */
  selecting: boolean;
  selected: boolean;
  /** The enable switch is busy or controls are off. */
  toggleDisabled: boolean;
  /** Position for the one-time entrance stagger; null skips it. */
  entranceIndex: number | null;
  onOpen: (file: AuthFileItem) => void;
  onToggleStatus: (file: AuthFileItem, enabled: boolean) => void;
  onToggleSelect: (name: string) => void;
}

/**
 * One account in the list: name, status in plain words, a tiny quota rail, the clients pinned
 * to it, and the enable switch. The name is the row's button and opens the details sheet; the
 * whole row is its click target.
 */
export function AccountRow({
  file,
  presentation,
  indicator,
  clientLinks,
  selecting,
  selected,
  toggleDisabled,
  entranceIndex,
  onOpen,
  onToggleStatus,
  onToggleSelect,
}: AccountRowProps) {
  const { t } = useTranslation();
  const title = deriveAccountTitle(file);
  const typeLabel = getTypeLabel(t, accountProviderKey(file));
  // Same accessible name as the card: the provider tells same-named accounts apart.
  const accountName = title.title ? `${typeLabel} ${title.title}` : file.name;
  const enabled = !isAccountDisabled(file);
  const runtimeOnly = isRuntimeOnlyAuthFile(file);
  const status = accountStatus(presentation);
  const tight = enabled && indicator?.status === 'ready' ? indicator : null;
  const pinned = clientLinks?.pinned ?? [];
  const pinnedNames = pinned.map((pin) => pin.label).join(', ');
  const subtitle = title.account ?? (title.titleMono ? null : title.fileLine);

  return (
    <li
      className={styles.row}
      data-enabled={enabled}
      data-selected={selecting && selected}
      data-enter={entranceIndex !== null}
      style={entranceIndex !== null ? ({ '--i': entranceIndex } as CSSProperties) : undefined}
    >
      {selecting && !runtimeOnly && (
        <SelectionCheckbox
          checked={selected}
          onChange={() => onToggleSelect(file.name)}
          className={styles.check}
          ariaLabel={t('auth_files.card_select', { name: accountName })}
          title={t('auth_files.card_select', { name: accountName })}
        />
      )}
      <button
        type="button"
        className={styles.open}
        onClick={() => onOpen(file)}
        aria-label={t('auth_files.flow.open_aria', { account: accountName })}
      >
        <span className={styles.name} data-mono={title.titleMono}>
          {title.title}
        </span>
        {subtitle ? <span className={styles.subtitle}>{subtitle}</span> : null}
      </button>
      <span className={styles.status}>
        <StatusDot tone={status.tone} label={t(status.key)} />
      </span>
      <span className={styles.quota}>
        {tight ? (
          <QuotaRail
            percentLeft={tight.left}
            label={t(
              tight.window === 'session'
                ? 'overview.quota.session_label'
                : tight.window === 'week'
                  ? 'overview.quota.week_label'
                  : 'auth_files.flow.quota_generic_label',
              { account: title.title }
            )}
            caption={t(`auth_files.flow.quota_${tight.window}`, { percent: tight.left })}
          />
        ) : indicator?.status === 'loading' && enabled ? (
          <span className={styles.quiet}>{t('overview.quota.checking')}</span>
        ) : null}
      </span>
      <span className={styles.pin}>
        {pinned.length > 0 && (
          <span
            className={styles.pinMark}
            data-fail={clientLinks?.willFail === true}
            title={t('auth_files.flow.pinned_title', { clients: pinnedNames })}
          >
            <DeviceGlyph size={14} />
            <span className={styles.pinText} aria-hidden="true">
              {pinnedNames}
            </span>
            <span className={styles.srOnly}>
              {t('auth_files.flow.pinned_title', { clients: pinnedNames })}
            </span>
          </span>
        )}
      </span>
      <span className={styles.toggle}>
        {!runtimeOnly && (
          <ToggleSwitch
            // Fixed name; the checked state carries on/off (CPA-006).
            ariaLabel={accountName}
            checked={enabled}
            disabled={toggleDisabled}
            onChange={(value) => onToggleStatus(file, value)}
          />
        )}
      </span>
    </li>
  );
}
