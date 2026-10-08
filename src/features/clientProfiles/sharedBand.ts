/**
 * Collapsed summary for the shared routing band on Client routes. React-free.
 * The band is collapsed by default so the matrix stays the page's main task, but it is
 * forced open while it has unsaved edits or a save problem, so those are never hidden.
 */

import type { TFunction } from 'i18next';
import type { SharedRoutingBandState } from '@/features/config/routing/SharedRoutingBand';
import { STRATEGY_LABEL_KEYS } from '@/features/config/routing/routingFormat';
import { CR } from './copy';

/**
 * True once per strategy/affinity save that reached the gateway config file (including a save
 * whose re-read failed). Client profile ETags hash that whole file, so the list must be re-read.
 */
export const sharedBandWroteConfig = (
  previous: SharedRoutingBandState | null,
  next: SharedRoutingBandState
): boolean =>
  next.save !== previous?.save &&
  (next.save.phase === 'saved' || next.save.phase === 'reload_failed');

export const isSharedBandForcedOpen = (state: SharedRoutingBandState | null): boolean =>
  Boolean(state && (state.dirty || state.attention));

export const isSharedBandOpen = (
  expanded: boolean,
  state: SharedRoutingBandState | null
): boolean => expanded || isSharedBandForcedOpen(state);

/** "Shared pool · Rotate evenly · Conversations not kept on one account" (saved values). */
export const sharedBandSummaryParts = (
  t: TFunction,
  state: SharedRoutingBandState | null
): string[] => {
  const label = t(`${CR}.shared_band.label`);
  const saved = state?.saved;
  if (!saved) return [label, t(`${CR}.shared_band.loading`)];
  const ttl = saved.sessionAffinityTtl.trim();
  return [
    label,
    t(STRATEGY_LABEL_KEYS[saved.strategy]),
    saved.sessionAffinity
      ? ttl
        ? t(`${CR}.shared_band.affinity_on_ttl`, { ttl })
        : t(`${CR}.shared_band.affinity_on`)
      : t(`${CR}.shared_band.affinity_off`),
  ];
};
