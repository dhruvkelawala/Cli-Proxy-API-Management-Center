/**
 * Pure decisions for PageTransition. React-free so they can be tested without a DOM.
 *
 * React Router's hash history gives the key "default" to every entry it did not create itself
 * (a hand-typed hash, a bookmark opened in the same tab, back/forward between such entries), so
 * history keys cannot tell layers apart. Layers get their own ids (pathname plus a counter) and
 * navigation is decided by comparing locations, not keys.
 */

export interface LocationLike {
  pathname: string;
  search: string;
  hash: string;
  key: string;
  state?: unknown;
}

/** The key React Router uses for entries it did not create. */
export const UNTRACKED_HISTORY_KEY = 'default';

/** A layer id that stays unique even when the same pathname is visited again. */
export const layerIdFor = (pathname: string, counter: number): string => `${pathname}::${counter}`;

/** The history key when it identifies an entry, else null ("default" identifies nothing). */
export const historyKeyOf = (location: Pick<LocationLike, 'key'>): string | null =>
  location.key && location.key !== UNTRACKED_HISTORY_KEY ? location.key : null;

/**
 * transition: a different page, animate to a new layer. update: the same page with a new
 * query, hash, state or history entry; hand the new location to the current layer in place.
 * none: nothing changed.
 */
export type NavigationPlan = 'transition' | 'update' | 'none';

export const planNavigation = (
  current: LocationLike | null | undefined,
  next: LocationLike
): NavigationPlan => {
  if (!current) return 'transition';
  if (current.pathname !== next.pathname) return 'transition';
  if (
    current.search !== next.search ||
    current.hash !== next.hash ||
    current.key !== next.key ||
    current.state !== next.state
  ) {
    return 'update';
  }
  return 'none';
};
