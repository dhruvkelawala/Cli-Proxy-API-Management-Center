/** The part of an element the focus tracker needs (kept narrow so tests can fake it). */
export interface FocusableLike {
  isConnected: boolean;
  focus: (options?: { preventScroll?: boolean }) => void;
}

/**
 * Remembers what had focus when an overlay opened and returns focus to it when it closes.
 * Call the returned function with the overlay's current open state after every change.
 * The opener is skipped if it has since left the document (e.g. the confirmed action removed it).
 */
export const createOpenerFocusTracker = (getActive: () => FocusableLike | null) => {
  let opener: FocusableLike | null = null;
  return (isOpen: boolean): void => {
    if (isOpen) {
      opener = getActive();
      return;
    }
    const previous = opener;
    opener = null;
    if (previous?.isConnected) previous.focus({ preventScroll: true });
  };
};

export const getActiveHtmlElement = (): FocusableLike | null =>
  typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;
