/**
 * PROTOTYPE (throwaway). Collapsible readout of the full in-memory state, plus simulation controls
 * (availability, failing saves) that the real UI would only read. Hard-coded English on purpose.
 */
import { useEffect, useRef } from 'react';
import styles from './StateReadout.module.scss';
import { useProtoStore } from './useProtoStore';
import {
  PROVIDERS,
  dirtyGroups,
  groupLabel,
  policyLabel,
  type Availability,
} from './prototypeModel';

const AVAILABILITY: Availability[] = ['available', 'unknown', 'unavailable'];

export function StateReadout({ onClose }: { onClose: () => void }) {
  const state = useProtoStore();
  const { draft, saved } = state;
  const dirty = dirtyGroups(state);
  const panelRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <section ref={panelRef} className={styles.panel} aria-label="Prototype state readout">
      <header className={styles.head}>
        <strong>Prototype state</strong>
        <span className={styles.sub}>synthetic · in memory · no network</span>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close state">
          ×
        </button>
      </header>

      <div className={styles.block}>
        <div className={styles.blockTitle}>Simulate (not real UI controls)</div>
        {draft.accounts.map((a) => (
          <div key={a.id} className={styles.simRow}>
            <span className={styles.simName}>{a.label}</span>
            <span className={styles.segment} role="group" aria-label={`${a.label} availability`}>
              {AVAILABILITY.map((av) => (
                <button
                  key={av}
                  type="button"
                  aria-pressed={a.availability === av}
                  onClick={() => state.setAvailability(a.id, av)}
                >
                  {av}
                </button>
              ))}
            </span>
          </div>
        ))}
        <div className={styles.simRow}>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={state.failNextSave}
              onChange={(e) => state.setFailNextSave(e.target.checked)}
            />
            Next save fails
          </label>
          <button type="button" className={styles.reset} onClick={state.reset}>
            Reset all
          </button>
        </div>
      </div>

      <div className={styles.block}>
        <div className={styles.blockTitle}>Save status</div>
        <div className={styles.kv}>
          saving: <b>{state.saving ? groupLabel(draft, state.saving) : '—'}</b>
        </div>
        <div className={styles.kv}>
          unsaved:{' '}
          <b>{dirty.length ? dirty.map((g) => groupLabel(draft, g)).join(', ') : 'none'}</b>
        </div>
        {state.error && <div className={styles.err}>error: {state.error.message}</div>}
      </div>

      <div className={styles.block}>
        <div className={styles.blockTitle}>Policies (draft · saved)</div>
        <table className={styles.table}>
          <tbody>
            {draft.profiles.map((p) => {
              const sp = saved.profiles.find((x) => x.id === p.id);
              return (
                <tr key={p.id}>
                  <th scope="row">{p.label}</th>
                  {PROVIDERS.map((prov) => {
                    const d = policyLabel(draft, p.policies[prov.id]);
                    const s = sp ? policyLabel(saved, sp.policies[prov.id]) : '—';
                    return (
                      <td key={prov.id}>
                        {prov.label}: {d}
                        {d !== s && <em> (saved: {s})</em>}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className={styles.block}>
        <div className={styles.blockTitle}>Shared routing + accounts (draft)</div>
        <div className={styles.kv}>
          strategy: <b>{draft.routing.strategy}</b> · affinity:{' '}
          <b>{draft.routing.affinity ? `on (${draft.routing.affinityTtl})` : 'off'}</b>
          {draft.routing.strategy !== saved.routing.strategy && (
            <em> (saved: {saved.routing.strategy})</em>
          )}
        </div>
        {draft.accounts.map((a) => (
          <div key={a.id} className={styles.kv}>
            {a.id}: {a.enabled ? 'enabled' : 'disabled'} · {a.availability} · priority{' '}
            <b>{a.priority}</b> · weight <b>{a.weight}</b>
          </div>
        ))}
      </div>

      <div className={styles.block}>
        <div className={styles.blockTitle}>Event log</div>
        <ol className={styles.log}>
          {state.log.slice(0, 6).map((line, i) => (
            <li key={`${i}-${line}`}>{line}</li>
          ))}
        </ol>
      </div>
    </section>
  );
}
