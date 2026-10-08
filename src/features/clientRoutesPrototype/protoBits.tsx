/**
 * PROTOTYPE (throwaway). Small presentational bits shared by the variants (status dot, share bar,
 * scoped save, topology path, consequence copy). No layout lives here. Hard-coded English.
 */
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import styles from './protoBits.module.scss';
import type { Tone } from './protoCopy';
import { useProtoStore } from './useProtoStore';
import {
  MACHINES,
  formatShare,
  isDirty,
  parseWeight,
  strategyMeta,
  targetStateText,
  type Machine,
  type PolicyOutcome,
  type PoolPreview,
  type ProtoAccount,
  type SaveGroup,
} from './prototypeModel';

export function StatusDot({ tone, label }: { tone: Tone; label?: string }) {
  return (
    <span
      className={`${styles.dot} ${styles[`dot_${tone}`]}`}
      aria-hidden={label ? undefined : true}
    >
      {label && <span className={styles.srOnly}>{label}</span>}
    </span>
  );
}

const SEGMENT_CLASS = [styles.seg0, styles.seg1, styles.seg2];

export function ShareBar({
  pool,
  compact = false,
  caption = true,
}: {
  pool: PoolPreview;
  compact?: boolean;
  caption?: boolean;
}) {
  const sharing = pool.rows.filter((r) => r.status === 'share' && r.share > 0);
  const summary = sharing.length
    ? sharing.map((r) => `${r.account.label} ${formatShare(r.share)}`).join(', ')
    : 'No eligible account';
  return (
    <div className={styles.shareWrap}>
      <div
        className={`${styles.bar} ${compact ? styles.barCompact : ''}`}
        role="img"
        aria-label={`Illustrative share of new assignments: ${summary}`}
      >
        {sharing.length === 0 && <span className={styles.barEmpty}>No eligible account</span>}
        {sharing.map((r) => {
          const idx = pool.rows.findIndex((x) => x.account.id === r.account.id);
          return (
            <span
              key={r.account.id}
              className={`${styles.segment} ${SEGMENT_CLASS[idx % 3]} ${
                r.account.availability === 'unknown' ? styles.segUnknown : ''
              }`}
              style={{ flexGrow: r.share }}
            >
              {!compact && r.share >= 0.12 && (
                <span className={styles.segLabel}>
                  {r.account.label} {formatShare(r.share)}
                </span>
              )}
            </span>
          );
        })}
      </div>
      {caption && (
        <p className={styles.caption}>
          Illustrative share of new assignments under {strategyMeta(pool.strategy).label}
          {' · '}not actual traffic, tokens or cost
          {pool.hasUnknown ? ' · striped = availability unknown' : ''}
        </p>
      )}
    </div>
  );
}

export function PoolLegend({ pool }: { pool: PoolPreview }) {
  return (
    <ul className={styles.legend}>
      {pool.rows.map((r, idx) => (
        <li key={r.account.id} className={r.status === 'excluded' ? styles.legendMuted : ''}>
          <span
            className={`${styles.swatch} ${r.status === 'share' ? SEGMENT_CLASS[idx % 3] : styles.swatchNone}`}
          />
          <span className={styles.legendName}>{r.account.label}</span>
          <span className={styles.legendValue}>
            {r.status === 'share'
              ? formatShare(r.share)
              : r.status === 'fallback'
                ? 'Fallback'
                : r.status === 'standby'
                  ? 'Standby'
                  : 'Excluded'}
          </span>
          <span className={styles.legendReason}>{r.reason}</span>
        </li>
      ))}
    </ul>
  );
}

export function TargetBadge({ outcome }: { outcome: Extract<PolicyOutcome, { kind: 'only' }> }) {
  const tone: Tone = outcome.fails ? 'bad' : outcome.state === 'unknown' ? 'unknown' : 'ok';
  return (
    <span className={`${styles.badge} ${styles[`badge_${tone}`]}`}>
      <StatusDot tone={tone} />
      {targetStateText[outcome.state]}
    </span>
  );
}

export function ScopedSave({
  groups,
  scope,
  saveLabel = 'Save to gateway',
  layout = 'row',
}: {
  groups: SaveGroup[];
  scope: ReactNode;
  saveLabel?: string;
  layout?: 'row' | 'stack';
}) {
  const state = useProtoStore();
  const dirty = groups.filter((g) => isDirty(state, g));
  const savingHere = state.saving !== null && groups.includes(state.saving);
  const errorHere = state.error && groups.includes(state.error.group) ? state.error.message : null;
  const status = savingHere
    ? 'Saving to the Mini gateway…'
    : errorHere
      ? errorHere
      : dirty.length
        ? 'Unsaved changes'
        : 'Matches the saved gateway configuration';

  return (
    <div className={`${styles.save} ${layout === 'stack' ? styles.saveStack : ''}`}>
      <div className={styles.saveCopy}>
        <span className={styles.scope}>{scope}</span>
        <span
          className={`${styles.saveStatus} ${errorHere ? styles.saveError : ''} ${dirty.length && !errorHere ? styles.saveDirty : ''}`}
          role="status"
          aria-live="polite"
        >
          {status}
        </span>
      </div>
      <div className={styles.saveActions}>
        <Button
          variant="ghost"
          size="sm"
          disabled={!dirty.length || savingHere}
          onClick={() => dirty.forEach((g) => state.discard(g))}
        >
          Discard
        </Button>
        <Button
          size="sm"
          disabled={!dirty.length}
          loading={savingHere}
          onClick={() => state.saveMany(dirty)}
        >
          {saveLabel}
        </Button>
      </div>
    </div>
  );
}

export function TopologyPath({
  machine,
  compact = false,
}: {
  machine: Machine;
  compact?: boolean;
}) {
  const path = MACHINES[machine].path;
  return (
    <span className={`${styles.path} ${compact ? styles.pathCompact : ''}`}>
      {path.map((step, i) => (
        <span key={step} className={styles.pathStep}>
          {i > 0 && (
            <span className={styles.pathArrow} aria-hidden="true">
              →
            </span>
          )}
          {step}
        </span>
      ))}
      <span className={styles.srOnly}>. Configured topology, not a live check.</span>
    </span>
  );
}

/** Priority/weight input that keeps a local string so blank/invalid drafts don't snap back. */
export function TuningInput({
  account,
  field,
  inactive = false,
  compact = false,
  showLabel = true,
}: {
  account: ProtoAccount;
  field: 'priority' | 'weight';
  inactive?: boolean;
  compact?: boolean;
  showLabel?: boolean;
}) {
  const setAccountTuning = useProtoStore((s) => s.setAccountTuning);
  const value = account[field];
  const parseField = (raw: string) =>
    field === 'weight'
      ? parseWeight(raw)
      : /^-?\d+$/.test(raw.trim())
        ? { value: Number(raw), error: null }
        : { value: null, error: 'Whole number' };
  const [text, setText] = useLocalText(String(value), (raw) => parseField(raw).value);
  const parsed = parseField(text);
  const id = `${account.id}-${field}`;
  const label = field === 'priority' ? 'Priority' : 'Weight';
  const hint =
    field === 'priority'
      ? 'Higher wins new assignments'
      : inactive
        ? 'Used only by Weighted split'
        : value <= 0
          ? '≤ 0 skips weighted scheduling only'
          : 'Default 1 · max 1,000,000';
  return (
    <div
      className={`${styles.tuning} ${inactive ? styles.tuningInactive : ''} ${compact ? styles.tuningCompact : ''}`}
    >
      <label htmlFor={id} className={showLabel ? styles.tuningLabel : styles.srOnly}>
        {label}
        {!showLabel && ` for ${account.label}`}
      </label>
      <input
        id={id}
        className={`input ${styles.tuningInput}`}
        inputMode="numeric"
        value={text}
        aria-invalid={Boolean(parsed.error)}
        aria-describedby={`${id}-hint`}
        onChange={(e) => {
          setText(e.target.value);
          const next = parseField(e.target.value);
          if (next.value !== null) setAccountTuning(account.id, { [field]: next.value });
        }}
      />
      <span id={`${id}-hint`} className={parsed.error ? styles.tuningError : styles.tuningHint}>
        {parsed.error ?? hint}
      </span>
    </div>
  );
}

/** Local text that resyncs when the upstream value changes (e.g. discard/reset). */
function useLocalText(
  upstream: string,
  parse: (text: string) => number | null
): [string, (v: string) => void] {
  const [state, setState] = useState({ upstream, text: upstream });
  if (state.upstream !== upstream) {
    const keep = String(parse(state.text)) === upstream;
    setState({ upstream, text: keep ? state.text : upstream });
  }
  return [state.text, (text: string) => setState((s) => ({ ...s, text }))];
}
