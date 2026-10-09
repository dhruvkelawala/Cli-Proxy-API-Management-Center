/** Keyboard decisions for ActionMenu (React-free so they can be tested). */

/** Where focus lands when the menu opens: ↑ on the button opens on the last item. */
export const openingIndex = (
  enabledIndexes: readonly number[],
  from: 'first' | 'last'
): number | undefined =>
  from === 'last' ? enabledIndexes[enabledIndexes.length - 1] : enabledIndexes[0];

/** The item a key moves to inside the open menu (wrapping); undefined for other keys. */
export const menuKeyTarget = (
  enabledIndexes: readonly number[],
  current: number,
  key: string
): number | undefined => {
  const position = enabledIndexes.indexOf(current);
  const last = enabledIndexes.length - 1;
  if (key === 'ArrowDown') return enabledIndexes[position >= last ? 0 : position + 1];
  if (key === 'ArrowUp') return enabledIndexes[position <= 0 ? last : position - 1];
  if (key === 'Home') return enabledIndexes[0];
  if (key === 'End') return enabledIndexes[last];
  return undefined;
};
