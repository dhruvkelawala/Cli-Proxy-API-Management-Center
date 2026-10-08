import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { IconSlidersHorizontal } from '@/components/ui/icons';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import type { RoutingStrategy } from '@/types/visualConfig';
import { RoutingSaveRow, type RoutingSaveTone } from './RoutingSaveRow';
import { RoutingTuningSheet } from './RoutingTuningSheet';
import { buildRoutingPresentation } from './routingPresentation';
import { STRATEGY_LABEL_KEYS } from './routingFormat';
import { bandScopeText } from './routingScope';
import {
  ROUTING_STRATEGIES,
  type RoutingSettingsEdits,
  type RoutingSettingsValues,
  type SaveStatus,
} from './routingSettingsState';
import { useRoutingSettings } from './useRoutingSettings';
import styles from './SharedRoutingBand.module.scss';

const ROOT = 'config_management.routing_settings';

const SHORT_KEYS: Record<RoutingStrategy, string> = {
  'round-robin': `${ROOT}.strategy_short.round_robin`,
  'weighted-round-robin': `${ROOT}.strategy_short.weighted_round_robin`,
  'fill-first': `${ROOT}.strategy_short.fill_first`,
};

/** What a host needs to summarise the band or keep it visible (unsaved edits, errors). */
export interface SharedRoutingBandState {
  /** Saved strategy/affinity; null until the config has loaded. */
  saved: RoutingSettingsValues | null;
  /** Unsaved strategy/affinity edits. */
  dirty: boolean;
  /** A save failed, its re-read failed, or an edit is invalid. */
  attention: boolean;
  /**
   * Latest strategy/affinity save status. A new `saved`, `reload_failed` or `failed` object means
   * the gateway config file may have been written (a failed patch can be partly applied), so
   * hosts keyed on its revision must re-read.
   */
  save: SaveStatus;
}

export interface SharedRoutingBandProps {
  /**
   * Number of client profiles currently set to Automatic. When given, the scope notice names
   * it; otherwise the notice says the change affects all Automatic clients.
   */
  automaticClientCount?: number;
  /** Optional: reports saved values, unsaved edits and failures to a host (e.g. a collapsible wrapper). */
  onStateChange?: (state: SharedRoutingBandState) => void;
}

export interface RoutingBandViewProps {
  values: RoutingSettingsValues;
  saved: RoutingSettingsValues;
  dirty: boolean;
  ttlInvalid: boolean;
  save: SaveStatus;
  /** True while the connection is not established: editing and saving are unavailable. */
  disabled?: boolean;
  automaticClientCount?: number;
  onChange: (edits: RoutingSettingsEdits) => void;
  onSave: () => void;
  onDiscard: () => void;
  onOpenTuning: () => void;
}

const bandStatus = (
  t: ReturnType<typeof useTranslation>['t'],
  save: SaveStatus,
  dirty: boolean,
  ttlInvalid: boolean
): { text: string; tone: RoutingSaveTone } => {
  if (save.phase === 'saving') return { text: t(`${ROOT}.status.saving`), tone: 'saving' };
  if (save.phase === 'reload_failed') {
    return { text: t(`${ROOT}.reload_failed`), tone: 'warning' };
  }
  if (save.phase === 'failed') {
    return {
      text: save.message
        ? t(`${ROOT}.status.failed`, { message: save.message })
        : t(`${ROOT}.status.failed_no_detail`),
      tone: 'failed',
    };
  }
  if (ttlInvalid) return { text: t(`${ROOT}.ttl_invalid`), tone: 'failed' };
  if (dirty) return { text: t(`${ROOT}.status.dirty`), tone: 'dirty' };
  if (save.phase === 'saved') return { text: t(`${ROOT}.status.saved`), tone: 'saved' };
  return { text: t(`${ROOT}.status.clean`), tone: 'clean' };
};

/** Presentational band. All state lives in useRoutingSettings; this only renders and reports. */
export function RoutingBandView({
  values,
  saved,
  dirty,
  ttlInvalid,
  save,
  disabled = false,
  automaticClientCount,
  onChange,
  onSave,
  onDiscard,
  onOpenTuning,
}: RoutingBandViewProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const ttlId = useId();
  const ttlErrorId = `${ttlId}-error`;
  const radioName = useId();
  const presentation = buildRoutingPresentation({
    strategy: values.strategy,
    sessionAffinity: {
      enabled: values.sessionAffinity,
      ttl: values.sessionAffinityTtl || undefined,
    },
    accounts: [],
  });
  const status = bandStatus(t, save, dirty, ttlInvalid);
  const saving = save.phase === 'saving';
  const locked = saving || disabled;
  const ttlLabel = values.sessionAffinityTtl.trim() || t(`${ROOT}.ttl_default`);

  return (
    <section className={styles.band} aria-labelledby={titleId} data-testid="shared-routing-band">
      <div className={styles.head}>
        <h2 id={titleId} className={styles.title}>
          {t(`${ROOT}.title`)}
          <span className={styles.subtitle}>{t(`${ROOT}.subtitle`)}</span>
        </h2>
      </div>

      <div className={styles.controls}>
        <div className={styles.strategyGroup}>
          <fieldset className={styles.strategy} disabled={locked}>
            <legend className={styles.srOnly}>{t(`${ROOT}.strategy_legend`)}</legend>
            {ROUTING_STRATEGIES.map((strategy: RoutingStrategy) => (
              <label
                key={strategy}
                className={`${styles.option} ${values.strategy === strategy ? styles.optionOn : ''}`}
              >
                <input
                  type="radio"
                  name={radioName}
                  value={strategy}
                  checked={values.strategy === strategy}
                  onChange={() => onChange({ strategy })}
                />
                <span className={styles.optionLabel}>{t(STRATEGY_LABEL_KEYS[strategy])}</span>
                <span className={styles.optionName}>{strategy}</span>
              </label>
            ))}
          </fieldset>
          {values.strategy !== saved.strategy && (
            <span className={styles.savedPill}>
              {t(`${ROOT}.strategy_saved`, { label: t(STRATEGY_LABEL_KEYS[saved.strategy]) })}
            </span>
          )}
        </div>

        <div className={styles.affinity}>
          <ToggleSwitch
            checked={values.sessionAffinity}
            disabled={locked}
            onChange={(sessionAffinity) => onChange({ sessionAffinity })}
            label={t(`${ROOT}.affinity_label`)}
          />
          <div className={styles.ttl}>
            <label htmlFor={ttlId}>{t(`${ROOT}.affinity_ttl_prefix`)}</label>
            <input
              id={ttlId}
              className="input"
              value={values.sessionAffinityTtl}
              placeholder="1h"
              disabled={!values.sessionAffinity || locked}
              autoComplete="off"
              spellCheck={false}
              aria-label={t(`${ROOT}.affinity_ttl_aria`)}
              aria-invalid={ttlInvalid ? true : undefined}
              aria-describedby={ttlInvalid ? ttlErrorId : undefined}
              onChange={(event) => onChange({ sessionAffinityTtl: event.target.value })}
            />
            {ttlInvalid && (
              <span id={ttlErrorId} className={styles.srOnly}>
                {t(`${ROOT}.ttl_invalid`)}
              </span>
            )}
          </div>
        </div>

        <Button variant="secondary" size="sm" disabled={disabled} onClick={onOpenTuning}>
          <IconSlidersHorizontal size={15} aria-hidden="true" /> {t(`${ROOT}.priorities_button`)}
        </Button>
      </div>

      <div className={styles.explain}>
        <p>{t(SHORT_KEYS[values.strategy])}</p>
        <p className={styles.muted}>
          {t(values.sessionAffinity ? `${ROOT}.muted_on` : `${ROOT}.muted_off`, { ttl: ttlLabel })}
        </p>
        <details className={styles.how}>
          <summary>{t(`${ROOT}.how_title`)}</summary>
          <p>{t(presentation.strategyExplanationKey)}</p>
          <p>{t(presentation.affinity.explanationKey, { ttl: ttlLabel })}</p>
          <p>{t(`${ROOT}.recommend`)}</p>
        </details>
      </div>

      <RoutingSaveRow
        scope={bandScopeText(t, automaticClientCount)}
        status={status.text}
        tone={status.tone}
        saveLabel={t(`${ROOT}.actions.save`)}
        saveDisabled={!dirty || ttlInvalid || locked}
        discardDisabled={disabled || (!dirty && save.phase !== 'failed')}
        saving={saving}
        onSave={onSave}
        onDiscard={onDiscard}
      />
    </section>
  );
}

/**
 * Shared load-balancing editor for Automatic clients: strategy, session affinity and a
 * Priorities & weights sheet. Settings are global to the gateway, so it states that scope
 * beside each save. Strategy/affinity and account priority/weight are separate saves.
 */
export function SharedRoutingBand({ automaticClientCount, onStateChange }: SharedRoutingBandProps) {
  const { t } = useTranslation();
  const routing = useRoutingSettings();
  const [tuningOpen, setTuningOpen] = useState(false);
  const saved = routing.saved ?? null;
  const attention =
    routing.globalSave.phase === 'failed' ||
    routing.globalSave.phase === 'reload_failed' ||
    routing.ttlError !== null;
  useEffect(() => {
    onStateChange?.({ saved, dirty: routing.dirty, attention, save: routing.globalSave });
  }, [attention, onStateChange, routing.dirty, routing.globalSave, saved]);

  if (!routing.values || !routing.saved) {
    return (
      <section className={styles.band} aria-busy="true">
        <div className={styles.loading} role="status">
          <LoadingSpinner size={14} />
          <span>{t(`${ROOT}.loading`)}</span>
        </div>
      </section>
    );
  }

  return (
    <>
      <RoutingBandView
        values={routing.values}
        saved={routing.saved}
        dirty={routing.dirty}
        ttlInvalid={routing.ttlError !== null}
        save={routing.globalSave}
        disabled={!routing.connected}
        automaticClientCount={automaticClientCount}
        onChange={routing.setEdit}
        onSave={() => void routing.saveGlobal()}
        onDiscard={routing.discardGlobal}
        onOpenTuning={() => {
          setTuningOpen(true);
          void routing.accounts.load();
        }}
      />
      <RoutingTuningSheet
        open={tuningOpen}
        onClose={() => setTuningOpen(false)}
        strategy={routing.values.strategy}
        sessionAffinity={{
          enabled: routing.values.sessionAffinity,
          ttl: routing.values.sessionAffinityTtl || undefined,
        }}
        accounts={routing.accounts}
        disabled={!routing.connected}
      />
    </>
  );
}
