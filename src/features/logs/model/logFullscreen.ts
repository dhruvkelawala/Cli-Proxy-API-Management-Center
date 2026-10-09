export function shouldExitLogFullscreen(
  event: Pick<KeyboardEvent, 'key' | 'defaultPrevented'>,
  hasOpenModal: boolean
): boolean {
  // Nested controls (for example Select) get first refusal on Escape.
  return event.key === 'Escape' && !event.defaultPrevented && !hasOpenModal;
}

/** The DOM surface inertOutside needs (kept minimal so it can be tested without a browser). */
export interface InertNode {
  parentElement: InertNode | null;
  children: ArrayLike<InertNode>;
  className?: unknown;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

/** Live notifications and dialogs stay usable while the rest of the page is inert. */
const keepsInteractive = (node: InertNode) =>
  node.getAttribute('aria-live') !== null ||
  node.getAttribute('role') === 'dialog' ||
  /notification|modal/i.test(typeof node.className === 'string' ? node.className : '');

/**
 * Makes everything outside `target` inert (its siblings, and its ancestors' siblings, up to the
 * document), as a modal overlay should. Returns a function that restores exactly what it changed.
 */
export function inertOutside(target: InertNode): () => void {
  const changed: InertNode[] = [];
  let node: InertNode | null = target;
  while (node?.parentElement) {
    const parent: InertNode = node.parentElement;
    for (const sibling of Array.from(parent.children)) {
      if (sibling === node || sibling.hasAttribute('inert') || keepsInteractive(sibling)) continue;
      sibling.setAttribute('inert', '');
      changed.push(sibling);
    }
    node = parent;
  }
  return () => changed.forEach((element) => element.removeAttribute('inert'));
}
