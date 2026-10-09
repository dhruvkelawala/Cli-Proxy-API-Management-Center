import { describe, expect, test } from 'bun:test';
import {
  NARROW_BREAKPOINT,
  clampDrag,
  computeFlowLayout,
  dropIndexFor,
  moveItem,
  outboundPath,
  routePath,
  slotBox,
} from '@/components/flow/flowLayout';

describe('flow layout', () => {
  test('moveItem moves one entry and leaves the input untouched', () => {
    const list = ['a', 'b', 'c'];
    expect(moveItem(list, 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveItem(list, 2, 0)).toEqual(['c', 'a', 'b']);
    expect(moveItem(list, 1, 9)).toEqual(['a', 'c', 'b']);
    expect(list).toEqual(['a', 'b', 'c']);
  });

  test('wide: sources on the left, cards on the right, hub between them', () => {
    const layout = computeFlowLayout({
      width: 680,
      sourceCount: 2,
      destinationCount: 2,
      nodeHeight: 136,
    });
    expect(layout.narrow).toBe(false);
    expect(layout.height).toBe(136 * 2 + 24);
    expect(layout.nodeX + layout.nodeWidth).toBe(680);
    expect(layout.hub.x).toBeGreaterThan(layout.sources[0].anchor.x);
    expect(layout.hub.x).toBeLessThan(layout.nodeX);
    expect(layout.sources[0].anchor.y).toBeLessThan(layout.sources[1].anchor.y);
  });

  test('narrow: sources in a row on top and a gutter line into each card', () => {
    const layout = computeFlowLayout({
      width: NARROW_BREAKPOINT - 1,
      sourceCount: 2,
      destinationCount: 2,
      nodeHeight: 136,
    });
    expect(layout.narrow).toBe(true);
    expect(layout.top).toBeGreaterThan(0);
    expect(layout.sources[0].label.y).toBe(layout.sources[1].label.y);
    expect(outboundPath(layout, slotBox(layout, 1))).toContain(' L ');
  });

  test('dragging picks the nearest slot and stays inside the stage', () => {
    const layout = computeFlowLayout({
      width: 680,
      sourceCount: 1,
      destinationCount: 3,
      nodeHeight: 100,
    });
    expect(dropIndexFor(layout, 0, layout.slot * 0.6, 3)).toBe(1);
    expect(dropIndexFor(layout, 0, layout.slot * 0.4, 3)).toBe(0);
    expect(dropIndexFor(layout, 2, -999, 3)).toBe(0);
    expect(clampDrag(layout, 0, -50, 3)).toBe(-0);
    expect(clampDrag(layout, 0, 9999, 3)).toBe(layout.slot * 2);
  });

  test('a route joins the inbound and outbound curves into one path', () => {
    const layout = computeFlowLayout({
      width: 680,
      sourceCount: 1,
      destinationCount: 1,
      nodeHeight: 100,
    });
    const d = routePath(layout, layout.sources[0].anchor, slotBox(layout, 0));
    expect(d.match(/M /g)).toHaveLength(1);
    expect(d.match(/C /g)).toHaveLength(2);
  });
});
