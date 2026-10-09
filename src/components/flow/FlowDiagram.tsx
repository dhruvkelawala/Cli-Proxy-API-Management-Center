import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion';
import {
  clampDrag,
  computeFlowLayout,
  dropIndexFor,
  inboundPath,
  moveItem,
  outboundPath,
  routePath,
  slotBox,
  type Box,
} from './flowLayout';
import styles from './FlowDiagram.module.scss';

/**
 * live: receives traffic now (accent, travelling dots). waiting: a backup on a dashed path.
 * out: not usable right now (faint dashes).
 */
export type FlowPathState = 'live' | 'waiting' | 'out';

export interface FlowSource {
  id: string;
  label: string;
  icon?: ReactNode;
  /** Routed straight to one destination, skipping the order. */
  lockedTo?: string | null;
  /** Shown in the danger tone (e.g. locked to an account that cannot serve). */
  problem?: boolean;
}

export interface FlowDestination {
  id: string;
  state: FlowPathState;
}

export interface FlowDiagramProps<D extends FlowDestination> {
  sources: FlowSource[];
  /** In order: the first is primary, the rest are backups. */
  destinations: D[];
  /** Accessible name of the reorderable list. */
  label: string;
  /** Small quiet caption under the hub (e.g. the gateway host). */
  hubLabel?: string;
  /** Card body. `place` is the position the card is shown at (it changes while dragging). */
  renderDestination: (destination: D, place: number) => ReactNode;
  /** Accessible name of a card at a position. */
  destinationLabel: (destination: D, place: number) => string;
  /** Read after each card's name, e.g. "Press up or down arrow to move." */
  reorderHint?: string;
  /** Omit for a read-only diagram. Receives the full new order of ids. */
  onReorder?: (ids: string[]) => void;
  reorderDisabled?: boolean;
  nodeHeight?: number;
}

type DragState = { id: string; from: number; startY: number; dy: number; active: boolean };

const GLIDE_MS = 360;
const DRAG_THRESHOLD = 4;
const easeOut = (t: number) => 1 - Math.pow(1 - t, 4);

function useStageWidth() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

const sameBoxes = (a: Record<string, Box>, b: Record<string, Box>) =>
  Object.keys(b).length === Object.keys(a).length &&
  Object.keys(b).every(
    (id) => a[id] && a[id].x === b[id].x && a[id].y === b[id].y && a[id].w === b[id].w
  );

/**
 * Cards glide to new slots. A dragged card follows the pointer while the others glide out of
 * its way; on drop it glides on from where it was let go. Reduced motion jumps.
 */
function useGlide(
  targets: Record<string, Box>,
  reduced: boolean,
  dragged: { id: string; y: number } | null
): Record<string, Box> {
  const [current, setCurrent] = useState(targets);
  const currentRef = useRef(targets);
  const lastDrag = useRef<{ id: string; y: number } | null>(null);
  const key = JSON.stringify(targets);
  const dragging = dragged !== null;

  useEffect(() => {
    if (dragged) lastDrag.current = dragged;
  });

  useEffect(() => {
    let from = currentRef.current;
    const dropped = dragging ? null : lastDrag.current;
    if (dropped) {
      const base = from[dropped.id] ?? targets[dropped.id];
      if (base) from = { ...from, [dropped.id]: { ...base, y: dropped.y } };
      lastDrag.current = null;
    }
    // Only a change of order glides. A resize (or the first measurement) jumps.
    const resized = Object.keys(targets).some(
      (id) => from[id] && (from[id].w !== targets[id].w || from[id].x !== targets[id].x)
    );
    if (
      reduced ||
      resized ||
      sameBoxes(from, targets) ||
      Object.keys(from).length !== Object.keys(targets).length
    ) {
      currentRef.current = targets;
      setCurrent(targets);
      return;
    }
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const k = easeOut(Math.min(1, (now - start) / GLIDE_MS));
      const next: Record<string, Box> = {};
      Object.keys(targets).forEach((id) => {
        const a = from[id] ?? targets[id];
        const b = targets[id];
        next[id] = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, w: b.w, h: b.h };
      });
      currentRef.current = next;
      setCurrent(next);
      if (k < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
    // `key` stands in for `targets` (a new object every render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reduced, dragging]);

  // Same ids and the same column: otherwise (first measure, resize) show the targets at once.
  const settled = Object.keys(targets).every(
    (id) => current[id] && current[id].w === targets[id].w && current[id].x === targets[id].x
  );
  const base = settled ? current : targets;
  if (!dragged || !base[dragged.id]) return base;
  return { ...base, [dragged.id]: { ...base[dragged.id], y: dragged.y } };
}

/**
 * The live route diagram: sources → hub → destinations in order, with the primary on a solid
 * accent path, backups on dashed paths and dots travelling along every live route. Cards can be
 * reordered by dragging or with ↑/↓ (Home/End) while focused.
 */
export function FlowDiagram<D extends FlowDestination>({
  sources,
  destinations,
  label,
  hubLabel,
  renderDestination,
  destinationLabel,
  reorderHint,
  onReorder,
  reorderDisabled = false,
  nodeHeight = 136,
}: FlowDiagramProps<D>) {
  const reduced = usePrefersReducedMotion();
  const [stageRef, measured] = useStageWidth();
  const [drag, setDrag] = useState<DragState | null>(null);
  const nodeRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const hintId = useId();
  const canReorder = Boolean(onReorder) && !reorderDisabled && destinations.length > 1;

  const layout = computeFlowLayout({
    width: measured || 680,
    sourceCount: sources.length,
    destinationCount: destinations.length,
    nodeHeight,
  });
  const ids = destinations.map((destination) => destination.id);
  const activeDrag = drag?.active ? drag : null;
  const dropIndex = activeDrag
    ? dropIndexFor(layout, activeDrag.from, activeDrag.dy, destinations.length)
    : -1;
  const shownIds = activeDrag ? moveItem(ids, activeDrag.from, dropIndex) : ids;
  const targets: Record<string, Box> = {};
  shownIds.forEach((id, index) => {
    targets[id] = slotBox(layout, index);
  });
  const boxes = useGlide(
    targets,
    reduced,
    activeDrag
      ? { id: activeDrag.id, y: layout.top + activeDrag.from * layout.slot + activeDrag.dy }
      : null
  );

  const commit = (next: string[]) => {
    if (next.join('\n') !== ids.join('\n')) onReorder?.(next);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>, id: string, index: number) => {
    if (!canReorder || event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDrag({ id, from: index, startY: event.clientY, dy: 0, active: false });
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const raw = event.clientY - drag.startY;
    const active = drag.active || Math.abs(raw) > DRAG_THRESHOLD;
    setDrag({ ...drag, active, dy: clampDrag(layout, drag.from, raw, destinations.length) });
  };
  const onPointerUp = () => {
    if (!drag) return;
    const to = drag.active ? dropIndex : drag.from;
    setDrag(null);
    if (to !== drag.from) commit(moveItem(ids, drag.from, to));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, index: number) => {
    if (!canReorder) return;
    const last = destinations.length - 1;
    const to =
      event.key === 'ArrowUp'
        ? index - 1
        : event.key === 'ArrowDown'
          ? index + 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (to === null) return;
    event.preventDefault();
    if (to < 0 || to > last || to === index) return;
    const id = ids[index];
    commit(moveItem(ids, index, to));
    requestAnimationFrame(() => nodeRefs.current[id]?.focus());
  };

  const liveIds = destinations.filter((d) => d.state === 'live').map((d) => d.id);
  const sourceGeometry = sources.map((source, index) => ({ source, ...layout.sources[index] }));

  return (
    <div
      ref={stageRef}
      className={styles.stage}
      style={{ height: layout.height }}
      data-narrow={layout.narrow}
      data-testid="flow-diagram"
    >
      <svg
        className={styles.svg}
        width={layout.width}
        height={layout.height}
        aria-hidden="true"
        focusable="false"
      >
        {sourceGeometry.map(({ source, anchor }) => {
          const locked = source.lockedTo ? boxes[source.lockedTo] : null;
          return (
            <path
              key={source.id}
              d={locked ? routePath(layout, anchor, locked) : inboundPath(layout, anchor)}
              className={styles.path}
              data-state={source.problem ? 'broken' : source.lockedTo ? 'locked' : 'live'}
            />
          );
        })}
        {destinations.map((destination) =>
          boxes[destination.id] ? (
            <path
              key={destination.id}
              d={outboundPath(layout, boxes[destination.id])}
              className={styles.path}
              data-state={destination.state}
            />
          ) : null
        )}
        <circle cx={layout.hub.x} cy={layout.hub.y} r={4} className={styles.hub} />
        {!reduced &&
          sourceGeometry
            .filter(({ source }) => !source.lockedTo && !source.problem)
            .flatMap(({ source, anchor }, sourceIndex) =>
              liveIds.map((id) => {
                const box = boxes[id];
                if (!box) return null;
                const begin = `-${(sourceIndex * 1.8).toFixed(1)}s`;
                return (
                  <circle
                    key={`${source.id}:${id}:${Math.round(box.y)}`}
                    r={3}
                    className={styles.dot}
                  >
                    <animateMotion
                      dur="3.6s"
                      repeatCount="indefinite"
                      path={routePath(layout, anchor, box)}
                      begin={begin}
                    />
                    <animate
                      attributeName="opacity"
                      values="0;0.95;0.95;0"
                      keyTimes="0;0.15;0.85;1"
                      dur="3.6s"
                      repeatCount="indefinite"
                      begin={begin}
                    />
                  </circle>
                );
              })
            )}
      </svg>

      {hubLabel && !layout.narrow && (
        <span
          className={styles.hubLabel}
          style={{ left: layout.hub.x, top: layout.hub.y - 28 }}
          aria-hidden="true"
        >
          {hubLabel}
        </span>
      )}

      {sourceGeometry.map(({ source, label: at }) => (
        <div
          key={source.id}
          className={styles.source}
          data-problem={source.problem === true}
          data-narrow={layout.narrow}
          style={{ top: at.y, left: at.x }}
        >
          {source.icon}
          <span className={styles.sourceLabel}>{source.label}</span>
        </div>
      ))}

      {reorderHint && (
        <span id={hintId} className={styles.srOnly}>
          {reorderHint}
        </span>
      )}
      <div className={styles.nodes} role="list" aria-label={label}>
        {destinations.map((destination, index) => {
          const box = boxes[destination.id] ?? slotBox(layout, index);
          const place = shownIds.indexOf(destination.id);
          return (
            <div
              key={destination.id}
              ref={(element) => {
                nodeRefs.current[destination.id] = element;
              }}
              role="listitem"
              tabIndex={0}
              aria-label={destinationLabel(destination, place)}
              aria-describedby={canReorder && reorderHint ? hintId : undefined}
              data-reorderable={canReorder}
              data-dragging={activeDrag?.id === destination.id}
              data-state={destination.state}
              data-place={place}
              className={styles.node}
              style={{
                transform: `translate(${box.x}px, ${box.y}px)`,
                width: box.w,
                height: box.h,
              }}
              onPointerDown={(event) => onPointerDown(event, destination.id, index)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={() => setDrag(null)}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              {canReorder && (
                <span className={styles.grip} aria-hidden="true">
                  <svg width="8" height="12" viewBox="0 0 8 12">
                    {[0, 5, 10].flatMap((y) => [
                      <circle key={`a${y}`} cx="1.5" cy={y + 1} r="1.1" />,
                      <circle key={`b${y}`} cx="6.5" cy={y + 1} r="1.1" />,
                    ])}
                  </svg>
                </span>
              )}
              {renderDestination(destination, place)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
