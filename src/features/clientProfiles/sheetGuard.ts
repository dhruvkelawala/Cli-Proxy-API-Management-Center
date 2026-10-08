import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNotificationStore } from '@/stores';

/**
 * Closing rules shared by the client routes sheets.
 * - busy (a save, enrollment or key write in flight): closing is blocked, so a failure can never
 *   land in a sheet the user can no longer see.
 * - dirty: ask before discarding the unsaved edit.
 */
export type SheetCloseDecision = 'blocked' | 'confirm' | 'close';

export const sheetCloseDecision = ({
  busy,
  dirty,
}: {
  busy: boolean;
  dirty: boolean;
}): SheetCloseDecision => (busy ? 'blocked' : dirty ? 'confirm' : 'close');

/** Run `next` only once the sheet agreed to close (no edit lost, nothing in flight). */
export const continueAfterClose = async (
  confirmClose: () => boolean | Promise<boolean>,
  next: () => void
): Promise<boolean> => {
  const ok = await confirmClose();
  if (ok) next();
  return ok;
};

/** `confirmClose` for <Sheet>, following {@link sheetCloseDecision}. */
export function useSheetCloseGuard({ busy, dirty }: { busy: boolean; dirty: boolean }) {
  const { t } = useTranslation();
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  return useCallback((): boolean | Promise<boolean> => {
    const decision = sheetCloseDecision({ busy, dirty });
    if (decision !== 'confirm') return decision === 'close';
    return new Promise<boolean>((resolve) => {
      showConfirmation({
        title: t('providersPage.unsavedChanges.title'),
        message: t('providersPage.unsavedChanges.message'),
        variant: 'danger',
        confirmText: t('providersPage.unsavedChanges.discard'),
        cancelText: t('providersPage.unsavedChanges.keepEditing'),
        onConfirm: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
  }, [busy, dirty, showConfirmation, t]);
}
