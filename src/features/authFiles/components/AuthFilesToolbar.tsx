import type { ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Select } from '@/components/ui/Select';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { MAX_CARD_PAGE_SIZE, MIN_CARD_PAGE_SIZE } from '@/features/authFiles/constants';
import type { AuthFilesSortMode, AuthFilesStatusFilterMode } from '@/features/authFiles/uiState';
import styles from './AuthFilesToolbar.module.scss';

export type AccountsViewMode = 'list' | 'cards';

export type AuthFilesToolbarProps = {
  statusFilterMode: AuthFilesStatusFilterMode;
  statusFilterOptions: Array<{ value: AuthFilesStatusFilterMode; label: string }>;
  onStatusFilterChange: (mode: AuthFilesStatusFilterMode) => void;
  sortMode: AuthFilesSortMode;
  sortOptions: Array<{ value: string; label: string }>;
  onSortModeChange: (value: string) => void;
  viewMode: AccountsViewMode;
  onViewModeChange: (mode: AccountsViewMode) => void;
  pageSizeInput: string;
  onPageSizeInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onPageSizeCommit: (rawValue: string) => void;
  compactMode: boolean;
  onCompactModeChange: (value: boolean) => void;
  selecting: boolean;
  onSelectingChange: (value: boolean) => void;
  selectableCount: number;
  onSelectAllShown: () => void;
  deleteLabel: string;
  deleteDisabled: boolean;
  deleteLoading: boolean;
  onDelete: () => void;
};

/**
 * The Accounts page's rare options, shown inside its More: which accounts to show, sort, list
 * or cards, page size, batch selection and the scoped Delete. Search stays on the page.
 */
export function AuthFilesToolbar(props: AuthFilesToolbarProps) {
  const {
    statusFilterMode,
    statusFilterOptions,
    onStatusFilterChange,
    sortMode,
    sortOptions,
    onSortModeChange,
    viewMode,
    onViewModeChange,
    pageSizeInput,
    onPageSizeInputChange,
    onPageSizeCommit,
    compactMode,
    onCompactModeChange,
    selecting,
    onSelectingChange,
    selectableCount,
    onSelectAllShown,
    deleteLabel,
    deleteDisabled,
    deleteLoading,
    onDelete,
  } = props;
  const { t } = useTranslation();

  return (
    <div className={styles.options}>
      <div className={styles.row}>
        <span className={styles.label} id="accounts-show-label">
          {t('auth_files.flow.show_label')}
        </span>
        <div className={styles.segmented} role="group" aria-labelledby="accounts-show-label">
          {statusFilterOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className={styles.segment}
              aria-pressed={statusFilterMode === option.value}
              onClick={() => onStatusFilterChange(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.row}>
        <span className={styles.label}>{t('auth_files.sort_label')}</span>
        <div className={styles.sort}>
          <Select
            value={sortMode}
            options={sortOptions}
            onChange={onSortModeChange}
            // The trigger shows the current choice; the name must contain that visible text.
            ariaLabel={`${t('auth_files.sort_label')}: ${
              sortOptions.find((option) => option.value === sortMode)?.label ?? sortMode
            }`}
            size="sm"
          />
        </div>
      </div>

      <div className={styles.row}>
        <span className={styles.label} id="accounts-view-label">
          {t('auth_files.flow.view_label')}
        </span>
        <div className={styles.inline}>
          <div className={styles.segmented} role="group" aria-labelledby="accounts-view-label">
            {(['list', 'cards'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                className={styles.segment}
                aria-pressed={viewMode === mode}
                onClick={() => onViewModeChange(mode)}
              >
                {t(`auth_files.flow.view_${mode}`)}
              </button>
            ))}
          </div>
          {viewMode === 'cards' && (
            <span className={styles.toggleField}>
              <span aria-hidden="true">{t('auth_files.compact_mode_label')}</span>
              <ToggleSwitch
                checked={compactMode}
                onChange={onCompactModeChange}
                ariaLabel={t('auth_files.compact_mode_label')}
              />
            </span>
          )}
          <label className={styles.pageSize} htmlFor="auth-files-page-size">
            <span>{t('auth_files.page_size_label')}</span>
            <input
              id="auth-files-page-size"
              className={styles.pageSizeInput}
              type="number"
              min={MIN_CARD_PAGE_SIZE}
              max={MAX_CARD_PAGE_SIZE}
              step={1}
              value={pageSizeInput}
              onChange={onPageSizeInputChange}
              onBlur={(e) => onPageSizeCommit(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.currentTarget.blur();
                }
              }}
            />
          </label>
        </div>
      </div>

      <div className={styles.row}>
        <span className={styles.label}>{t('auth_files.flow.select_label')}</span>
        <div className={styles.inline}>
          <button
            type="button"
            className={styles.textButton}
            aria-pressed={selecting}
            onClick={() => onSelectingChange(!selecting)}
          >
            {selecting ? t('auth_files.flow.select_done') : t('auth_files.flow.select_start')}
          </button>
          {selecting && (
            <button
              type="button"
              className={styles.textButton}
              disabled={selectableCount === 0}
              onClick={onSelectAllShown}
            >
              {t('auth_files.flow.select_all_shown', { count: selectableCount })}
            </button>
          )}
        </div>
      </div>

      <div className={styles.row}>
        <span className={styles.label}>{t('auth_files.flow.danger_label')}</span>
        <button
          type="button"
          className={styles.deleteAction}
          onClick={onDelete}
          disabled={deleteDisabled}
        >
          {deleteLoading ? <LoadingSpinner size={13} /> : null}
          {deleteLabel}
        </button>
      </div>
    </div>
  );
}
