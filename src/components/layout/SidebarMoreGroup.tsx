import type { FocusEvent, MouseEvent, ReactNode } from 'react';
import { IconChevronDown, IconSidebarMore } from '@/components/ui/icons';
import type { SidebarNavItem, SidebarNavLinkItem } from './navModel';

export const NAV_MORE_LIST_ID = 'sidebar-nav-more';

export interface SidebarMoreGroupProps {
  open: boolean;
  onToggle: () => void;
  /** False in the collapsed rail: icon only, named by aria-label. */
  showLabels: boolean;
  label: string;
  items: SidebarNavItem[];
  /** The active page when it lives under More; shown under the toggle while collapsed. */
  activeLink: SidebarNavLinkItem | null;
  renderItem: (item: SidebarNavItem) => ReactNode;
  renderLink: (item: SidebarNavLinkItem) => ReactNode;
  /** Rail tooltip wiring (collapsed sidebar only). */
  describedBy?: string;
  onMouseEnter?: (event: MouseEvent<HTMLElement>) => void;
  onMouseLeave?: () => void;
  onFocus?: (event: FocusEvent<HTMLElement>) => void;
  onBlur?: (event: FocusEvent<HTMLElement>) => void;
}

/**
 * The sidebar's single "More" group: a disclosure button and an animated list of the rarely
 * used pages. Items stay mounted (inert while collapsed) so the height can animate.
 */
export function SidebarMoreGroup({
  open,
  onToggle,
  showLabels,
  label,
  items,
  activeLink,
  renderItem,
  renderLink,
  describedBy,
  onMouseEnter,
  onMouseLeave,
  onFocus,
  onBlur,
}: SidebarMoreGroupProps) {
  if (items.length === 0) return null;
  return (
    <div className={`nav-more ${open ? 'open' : ''}`}>
      <button
        type="button"
        className={`nav-item nav-more-toggle ${open ? 'open' : ''}`}
        aria-expanded={open}
        aria-controls={NAV_MORE_LIST_ID}
        aria-label={showLabels ? undefined : label}
        aria-describedby={describedBy}
        onClick={onToggle}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onFocus={onFocus}
        onBlur={onBlur}
      >
        <span className="nav-icon">
          <IconSidebarMore size={18} />
        </span>
        {showLabels && (
          <>
            <span className="nav-text">
              <span className="nav-label">{label}</span>
            </span>
            <span className="nav-drawer-caret" aria-hidden="true">
              <IconChevronDown size={14} />
            </span>
          </>
        )}
      </button>
      <div id={NAV_MORE_LIST_ID} className="nav-more-list" data-open={open}>
        <div className="nav-more-inner" inert={!open}>
          {items.map((item) => renderItem(item))}
        </div>
      </div>
      {!open && activeLink && <div className="nav-more-pinned">{renderLink(activeLink)}</div>}
    </div>
  );
}
