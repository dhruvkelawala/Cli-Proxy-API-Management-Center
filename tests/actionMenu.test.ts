import { describe, expect, test } from 'bun:test';
import { menuKeyTarget, openingIndex } from '@/components/flow/ActionMenu';

describe('ActionMenu keyboard model', () => {
  // Items 0..3 with item 2 disabled.
  const enabled = [0, 1, 3];

  test('↓ (or a click) opens on the first enabled item; ↑ opens on the last', () => {
    expect(openingIndex(enabled, 'first')).toBe(0);
    expect(openingIndex(enabled, 'last')).toBe(3);
    expect(openingIndex([], 'last')).toBeUndefined();
  });

  test('arrows wrap and skip disabled items; Home and End jump', () => {
    expect(menuKeyTarget(enabled, 1, 'ArrowDown')).toBe(3);
    expect(menuKeyTarget(enabled, 3, 'ArrowDown')).toBe(0);
    expect(menuKeyTarget(enabled, 0, 'ArrowUp')).toBe(3);
    expect(menuKeyTarget(enabled, 1, 'Home')).toBe(0);
    expect(menuKeyTarget(enabled, 0, 'End')).toBe(3);
    expect(menuKeyTarget(enabled, 0, 'Escape')).toBeUndefined();
  });
});
