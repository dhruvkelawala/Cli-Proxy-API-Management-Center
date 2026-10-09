/**
 * Pure geometry for FlowDiagram: where sources, the hub and destination cards sit, and the
 * SVG paths between them. React-free so the layout can be tested without a DOM.
 *
 * Wide: sources stacked on the left, the hub in between, destination cards on the right.
 * Narrow (< NARROW_BREAKPOINT): sources in a row on top, a "metro" line down the left gutter
 * into each card.
 */

export type Point = { x: number; y: number };
export type Box = { x: number; y: number; w: number; h: number };

export const NARROW_BREAKPOINT = 560;
const SOURCE_COLUMN = 120;
const SOURCE_SPACING = 52;
const NARROW_TOP = 84;

export const moveItem = <T>(list: readonly T[], from: number, to: number): T[] => {
  const next = [...list];
  if (from < 0 || from >= next.length) return next;
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, item);
  return next;
};

export interface FlowLayoutInput {
  width: number;
  sourceCount: number;
  destinationCount: number;
  /** Card height (card text never wraps: long lines truncate). */
  nodeHeight: number;
}

export interface FlowLayout {
  width: number;
  height: number;
  narrow: boolean;
  /** Top of the first card. */
  top: number;
  nodeX: number;
  nodeWidth: number;
  nodeHeight: number;
  /** Card height plus gap. */
  slot: number;
  hub: Point;
  /** Label position (left/top of the label box) and the point a source path starts from. */
  sources: { label: Point; anchor: Point }[];
}

export const computeFlowLayout = ({
  width,
  sourceCount,
  destinationCount,
  nodeHeight,
}: FlowLayoutInput): FlowLayout => {
  const narrow = width < NARROW_BREAKPOINT;
  const top = narrow ? NARROW_TOP : 0;
  const nodeWidth = narrow ? width - 30 : Math.min(340, width * 0.5);
  const gap = narrow ? 16 : 24;
  const count = Math.max(1, destinationCount);
  const height = top + count * nodeHeight + (count - 1) * gap;
  const nodeX = width - nodeWidth;
  const n = Math.max(1, sourceCount);
  const sources = Array.from({ length: sourceCount }, (_, index) => {
    if (narrow) {
      const x = (width * (index + 1)) / (n + 1);
      return { label: { x, y: 0 }, anchor: { x, y: 26 } };
    }
    const y = height / 2 + (index - (n - 1) / 2) * SOURCE_SPACING;
    return { label: { x: 0, y }, anchor: { x: SOURCE_COLUMN, y } };
  });
  const hub: Point = narrow
    ? { x: 12, y: top - 18 }
    : { x: SOURCE_COLUMN + (nodeX - SOURCE_COLUMN) * 0.42, y: height / 2 };
  return {
    width,
    height,
    narrow,
    top,
    nodeX,
    nodeWidth,
    nodeHeight,
    slot: nodeHeight + gap,
    hub,
    sources,
  };
};

/** Card box for a position in the order. */
export const slotBox = (layout: FlowLayout, index: number): Box => ({
  x: layout.nodeX,
  y: layout.top + index * layout.slot,
  w: layout.nodeWidth,
  h: layout.nodeHeight,
});

/** Position a dragged card would drop into, from where it started and how far it moved. */
export const dropIndexFor = (layout: FlowLayout, from: number, dy: number, count: number): number =>
  Math.max(0, Math.min(count - 1, Math.round((from * layout.slot + dy) / layout.slot)));

/** Clamp a drag so the card stays inside the stage. */
export const clampDrag = (layout: FlowLayout, from: number, dy: number, count: number): number => {
  const base = from * layout.slot;
  const max = (count - 1) * layout.slot;
  return Math.max(-base, Math.min(max - base, dy));
};

const horizontalCurve = (a: Point, b: Point) => {
  const dx = (b.x - a.x) * 0.5;
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y} ${b.x - dx} ${b.y} ${b.x} ${b.y}`;
};

const verticalCurve = (a: Point, b: Point) => {
  const mid = (a.y + b.y) / 2;
  return `M ${a.x} ${a.y} C ${a.x} ${mid} ${b.x} ${mid} ${b.x} ${b.y}`;
};

/** Source → hub. */
export const inboundPath = (layout: FlowLayout, anchor: Point): string =>
  layout.narrow ? verticalCurve(anchor, layout.hub) : horizontalCurve(anchor, layout.hub);

/** Hub → the middle of a card's leading edge. */
export const outboundPath = (layout: FlowLayout, box: Box): string => {
  const { hub } = layout;
  const midY = box.y + box.h / 2;
  if (!layout.narrow) return horizontalCurve(hub, { x: box.x, y: midY });
  return `M ${hub.x} ${hub.y} L ${hub.x} ${midY - 10} Q ${hub.x} ${midY} ${hub.x + 10} ${midY} L ${box.x} ${midY}`;
};

/** Drops the leading move command so two paths can be joined into one continuous route. */
export const pathTail = (d: string): string => d.replace(/^M\s*[-\d.]+\s+[-\d.]+\s*/, '');

/** Source → hub → card, as one path (for travelling dots and locked routes). */
export const routePath = (layout: FlowLayout, anchor: Point, box: Box): string =>
  `${inboundPath(layout, anchor)} ${pathTail(outboundPath(layout, box))}`;
