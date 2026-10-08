import type { useTranslation } from 'react-i18next';
import type { RoutingSaveTone } from './RoutingSaveRow';
import type { useRoutingSettings } from './useRoutingSettings';

type RoutingAccounts = ReturnType<typeof useRoutingSettings>['accounts'];

/** Account save status line: honest about partial results, never one combined claim. */
export const describeAccountSaveStatus = (
  t: ReturnType<typeof useTranslation>['t'],
  accounts: Pick<RoutingAccounts, 'save' | 'dirtyNames' | 'hasErrors'>
): { text: string; tone: RoutingSaveTone } => {
  const root = 'config_management.routing_settings.sheet.status';
  const { save } = accounts;
  const names = save.failures.map((failure) => failure.label || failure.name).join(', ');
  if (save.phase === 'saving') return { text: t(`${root}.saving`), tone: 'saving' };
  if (save.phase === 'done' && save.outcome === 'partial') {
    return {
      text: t(`${root}.partial`, {
        saved: save.savedCount,
        total: save.savedCount + save.failures.length,
        names,
      }),
      tone: 'failed',
    };
  }
  if (save.phase === 'done' && save.outcome === 'failed') {
    return { text: t(`${root}.failed`, { names }), tone: 'failed' };
  }
  if (accounts.hasErrors) return { text: t(`${root}.invalid`), tone: 'failed' };
  if (accounts.dirtyNames.length > 0) return { text: t(`${root}.dirty`), tone: 'dirty' };
  if (save.phase === 'done')
    return { text: t(`${root}.saved`, { count: save.savedCount }), tone: 'saved' };
  return { text: t(`${root}.clean`), tone: 'clean' };
};
