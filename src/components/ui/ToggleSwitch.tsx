import type { ChangeEvent, ReactNode } from 'react';
import styles from './ToggleSwitch.module.scss';

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (value: boolean) => void;
  label?: ReactNode;
  ariaLabel?: string;
  disabled?: boolean;
  /**
   * A change is saving. The switch stays focusable (disabling it would drop keyboard focus),
   * says so to assistive technology (aria-busy, aria-disabled), looks dimmed and ignores input.
   */
  busy?: boolean;
  labelPosition?: 'left' | 'right';
}

export function ToggleSwitch({
  checked,
  onChange,
  label,
  ariaLabel,
  disabled = false,
  busy = false,
  labelPosition = 'right',
}: ToggleSwitchProps) {
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (busy) return;
    onChange(event.target.checked);
  };

  const className = [
    styles.root,
    labelPosition === 'left' ? styles.labelLeft : '',
    disabled ? styles.disabled : '',
    busy ? styles.busy : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <label className={className}>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={handleChange}
        disabled={disabled}
        aria-busy={busy ? true : undefined}
        aria-disabled={busy && !disabled ? true : undefined}
        aria-label={ariaLabel}
      />
      <span className={styles.track}>
        <span className={styles.thumb} />
      </span>
      {label && <span className={styles.label}>{label}</span>}
    </label>
  );
}
