/**
 * PROTOTYPE (throwaway). Floating variant switcher + state readout. Deliberately styled as
 * prototype chrome (black/yellow pill) so it is never mistaken for the design under review.
 * Rendered only when import.meta.env.DEV. Hard-coded English on purpose.
 */
import { useEffect, useState } from 'react';
import styles from './PrototypeSwitcher.module.scss';
import { StateReadout } from './StateReadout';

export interface VariantInfo {
  key: string;
  name: string;
}

interface PrototypeSwitcherProps {
  variants: VariantInfo[];
  current: string;
  onChange: (key: string) => void;
}

const isTypingTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.closest('input, textarea, select, [contenteditable="true"]')) return true;
  // Composite widgets own their arrow keys.
  return Boolean(
    target.closest('[role="radiogroup"], [role="tablist"], [role="listbox"], [role="menu"]')
  );
};

export function PrototypeSwitcher({ variants, current, onChange }: PrototypeSwitcherProps) {
  const [stateOpen, setStateOpen] = useState(false);
  const index = Math.max(
    0,
    variants.findIndex((v) => v.key === current)
  );
  const step = (delta: number) =>
    onChange(variants[(index + delta + variants.length) % variants.length].key);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.metaKey || event.ctrlKey) return;
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      if (isTypingTarget(event.target)) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      event.preventDefault();
      onChange(
        variants[(index + (event.key === 'ArrowLeft' ? -1 : 1) + variants.length) % variants.length]
          .key
      );
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, onChange, variants]);

  const active = variants[index];

  return (
    <div className={styles.dock}>
      {stateOpen && <StateReadout onClose={() => setStateOpen(false)} />}
      <div className={styles.pill} role="group" aria-label="Prototype variant switcher">
        <span className={styles.tag} aria-hidden="true">
          PROTO
        </span>
        <button
          type="button"
          className={styles.arrow}
          onClick={() => step(-1)}
          aria-label="Previous variant"
          title="Previous variant (←)"
        >
          ‹
        </button>
        <span className={styles.label} aria-live="polite">
          {active.key} <span className={styles.name}>({active.name})</span>
        </span>
        <button
          type="button"
          className={styles.arrow}
          onClick={() => step(1)}
          aria-label="Next variant"
          title="Next variant (→)"
        >
          ›
        </button>
        <button
          type="button"
          className={styles.stateBtn}
          aria-expanded={stateOpen}
          onClick={() => setStateOpen((v) => !v)}
        >
          State
        </button>
      </div>
    </div>
  );
}
