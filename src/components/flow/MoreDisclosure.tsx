import { useId, useState, type ReactNode } from 'react';
import { IconChevronDown } from '@/components/ui/icons';
import styles from './MoreDisclosure.module.scss';

export interface MoreDisclosureProps {
  /** Visible button text, e.g. "More". It is also the region's name. */
  label: string;
  /** Quiet one-line summary beside the label while collapsed (saved settings at a glance). */
  summary?: string;
  defaultOpen?: boolean;
  /** Controlled open state. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * Keeps the region open (e.g. unsaved edits or an error inside). The button stays focusable
   * but cannot collapse it; `forcedNote` says why.
   */
  forcedOpen?: boolean;
  forcedNote?: string;
  children: ReactNode;
}

/**
 * The one "More" per page: rare options behind a quiet disclosure with an animated height.
 * Content stays mounted while collapsed (drafts survive), but is inert and hidden from
 * assistive technology until opened.
 */
export function MoreDisclosure({
  label,
  summary,
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
  forcedOpen = false,
  forcedNote,
  children,
}: MoreDisclosureProps) {
  const [uncontrolled, setUncontrolled] = useState(defaultOpen);
  const requested = controlledOpen ?? uncontrolled;
  const open = requested || forcedOpen;
  const buttonId = useId();
  const regionId = useId();

  const toggle = () => {
    if (forcedOpen) return;
    const next = !open;
    if (controlledOpen === undefined) setUncontrolled(next);
    onOpenChange?.(next);
  };

  return (
    <section className={styles.root} data-open={open}>
      <button
        id={buttonId}
        type="button"
        className={styles.toggle}
        aria-expanded={open}
        aria-controls={regionId}
        aria-disabled={forcedOpen ? true : undefined}
        onClick={toggle}
      >
        <span className={styles.label}>{label}</span>
        {summary && !open ? <span className={styles.summary}>{summary}</span> : null}
        <span className={styles.chevron} aria-hidden="true">
          <IconChevronDown size={14} />
        </span>
      </button>
      {forcedOpen && forcedNote ? <p className={styles.note}>{forcedNote}</p> : null}
      <div
        id={regionId}
        role="region"
        aria-labelledby={buttonId}
        className={styles.panel}
        data-open={open}
        inert={!open}
      >
        <div className={styles.inner}>
          <div className={styles.content}>{children}</div>
        </div>
      </div>
    </section>
  );
}
