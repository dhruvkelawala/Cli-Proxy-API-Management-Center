import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import styles from './ActionMenu.module.scss';

export interface ActionMenuItem {
  id: string;
  label: string;
  /** Quiet second line under the label. */
  hint?: string;
  icon?: ReactNode;
  disabled?: boolean;
  onSelect: () => void;
}

export interface ActionMenuProps {
  /** Visible button content. */
  children: ReactNode;
  /** Accessible name when the button shows only an icon. */
  ariaLabel?: string;
  items: ActionMenuItem[];
  /** primary: the page's one filled action. quiet: a text or icon button. */
  variant?: 'primary' | 'quiet';
  disabled?: boolean;
}

/**
 * A button that opens a short menu of actions. Keyboard: Enter/Space/↓ open it on the first
 * item, ↑/↓/Home/End move, Escape closes and returns focus to the button, Tab closes.
 */
export function ActionMenu({
  children,
  ariaLabel,
  items,
  variant = 'quiet',
  disabled = false,
}: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();
  const buttonId = useId();

  const enabledIndexes = items
    .map((item, index) => (item.disabled ? -1 : index))
    .filter((index) => index >= 0);

  const focusItem = (index: number | undefined) => {
    if (index === undefined) return;
    itemRefs.current[index]?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    const frame = requestAnimationFrame(() => focusItem(enabledIndexes[0]));
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      cancelAnimationFrame(frame);
    };
    // Focus the first item once, when the menu opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  };

  const onButtonKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
    }
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = itemRefs.current.findIndex((item) => item === document.activeElement);
    const position = enabledIndexes.indexOf(current);
    const last = enabledIndexes.length - 1;
    let next: number | undefined;
    if (event.key === 'ArrowDown') next = enabledIndexes[position >= last ? 0 : position + 1];
    else if (event.key === 'ArrowUp') next = enabledIndexes[position <= 0 ? last : position - 1];
    else if (event.key === 'Home') next = enabledIndexes[0];
    else if (event.key === 'End') next = enabledIndexes[last];
    else if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
      return;
    } else if (event.key === 'Tab') {
      close(false);
      return;
    } else return;
    event.preventDefault();
    focusItem(next);
  };

  return (
    <div ref={rootRef} className={styles.root} data-open={open}>
      <button
        ref={buttonRef}
        id={buttonId}
        type="button"
        className={styles.button}
        data-variant={variant}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={onButtonKeyDown}
      >
        {children}
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-labelledby={buttonId}
          className={styles.menu}
          onKeyDown={onMenuKeyDown}
        >
          {items.map((item, index) => (
            <button
              key={item.id}
              ref={(element) => {
                itemRefs.current[index] = element;
              }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className={styles.item}
              disabled={item.disabled}
              onClick={() => {
                close(true);
                item.onSelect();
              }}
            >
              {item.icon ? (
                <span className={styles.icon} aria-hidden="true">
                  {item.icon}
                </span>
              ) : null}
              <span className={styles.text}>
                <span className={styles.label}>{item.label}</span>
                {item.hint ? <span className={styles.hint}>{item.hint}</span> : null}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
