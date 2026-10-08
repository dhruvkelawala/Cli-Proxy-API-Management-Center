import { useCallback, useId, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import {
  SharedRoutingBand,
  type SharedRoutingBandState,
} from '@/features/config/routing/SharedRoutingBand';
import { CR } from '../copy';
import {
  isSharedBandForcedOpen,
  isSharedBandOpen,
  sharedBandSummaryParts,
  sharedBandSaveFinished,
} from '../sharedBand';
import styles from './CollapsibleSharedRoutingBand.module.scss';

/** Presentational shell: a summary row with an Edit/Hide disclosure and the inline region. */
export function SharedBandDisclosure({
  open,
  forced,
  summary,
  onToggle,
  children,
}: {
  open: boolean;
  /** Unsaved edits or a save problem: the region cannot be collapsed. */
  forced: boolean;
  summary: string[];
  onToggle: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const regionId = useId();
  const summaryId = useId();
  return (
    <section className={styles.wrap} aria-labelledby={summaryId}>
      <div className={styles.summaryRow}>
        <p id={summaryId} className={styles.summary}>
          {summary.map((part, index) => (
            <span key={index} className={index === 0 ? styles.label : styles.part}>
              {part}
              {/* Trailing separator: a wrapped line never starts with a dot. */}
              {index < summary.length - 1 && (
                <span className={styles.dot} aria-hidden="true">
                  ·
                </span>
              )}
            </span>
          ))}
        </p>
        <Button
          variant="secondary"
          size="sm"
          onClick={onToggle}
          disabled={forced}
          aria-expanded={open}
          aria-controls={regionId}
          aria-label={open ? t(`${CR}.shared_band.hide_aria`) : t(`${CR}.shared_band.edit_aria`)}
        >
          {open ? t(`${CR}.shared_band.hide`) : t(`${CR}.shared_band.edit`)}
        </Button>
      </div>
      {forced && <p className={styles.locked}>{t(`${CR}.shared_band.locked`)}</p>}
      {/* Kept mounted while collapsed so in-progress edits and save results are never lost. */}
      <div id={regionId} className={styles.region} hidden={!open}>
        {children}
      </div>
    </section>
  );
}

/**
 * Client routes host for CPA-008's SharedRoutingBand: collapsed to one summary row by default,
 * expanded inline on demand, and forced open while it has unsaved edits or a save error.
 * Nothing is persisted.
 */
export function CollapsibleSharedRoutingBand({
  automaticClientCount,
  onConfigWritten,
}: {
  automaticClientCount?: number;
  /**
   * A band save finished (saved or failed) and may have written the gateway config file, which
   * changes the client profiles ETag.
   */
  onConfigWritten?: () => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [bandState, setBandState] = useState<SharedRoutingBandState | null>(null);
  const previousState = useRef<SharedRoutingBandState | null>(null);
  const handleStateChange = useCallback(
    (next: SharedRoutingBandState) => {
      if (sharedBandSaveFinished(previousState.current, next)) onConfigWritten?.();
      previousState.current = next;
      setBandState(next);
    },
    [onConfigWritten]
  );
  const forced = isSharedBandForcedOpen(bandState);
  const open = isSharedBandOpen(expanded, bandState);

  return (
    <SharedBandDisclosure
      open={open}
      forced={forced}
      summary={sharedBandSummaryParts(t, bandState)}
      onToggle={() => setExpanded(!open)}
    >
      <SharedRoutingBand
        automaticClientCount={automaticClientCount}
        onStateChange={handleStateChange}
      />
    </SharedBandDisclosure>
  );
}
