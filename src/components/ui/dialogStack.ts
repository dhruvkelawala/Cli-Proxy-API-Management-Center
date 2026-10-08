/**
 * Stacked dialogs (a confirmation opened from a sheet) each listen for Escape and Tab on
 * `document`. Only the topmost one may react; otherwise Escape on the confirmation also re-runs
 * the sheet's close guard and re-opens the confirmation, and Tab trapping fights across layers.
 * Portals append in mount order, so the last modal dialog in the document is the topmost.
 */
export const isTopmostDialog = (element: HTMLElement | null): boolean => {
  if (!element || typeof document === 'undefined') return true;
  // A dialog animating out (marked data-closing) no longer counts: the one below it takes over.
  const dialogs = Array.from(
    document.querySelectorAll('[role="dialog"][aria-modal="true"]')
  ).filter((dialog) => !dialog.hasAttribute('data-closing'));
  return dialogs.length === 0 || dialogs[dialogs.length - 1] === element;
};
