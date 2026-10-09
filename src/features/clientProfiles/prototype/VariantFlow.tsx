/**
 * PROTOTYPE A · Flow. Macs flow into the account that goes first; the backup waits on a dashed
 * path that lights up when the first runs out. Drag an account (or focus it and press ↑/↓) to
 * change the order. Local only (see useProtoRoutesModel).
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import {
  describeServing,
  resetHint,
  type ProtoAccount,
  type ProtoModel,
} from './useProtoRoutesModel';
import { Advanced, Footnotes, Health, MacGlyph, WeeklyMeter } from './shared';
import { moveItem, usePrefersReducedMotion } from './protoUtils';
import shared from './Prototype.module.scss';
import styles from './VariantFlow.module.scss';

type Box = { x: number; y: number; w: number; h: number };
type Pt = { x: number; y: number };

const easeOut = (t: number) => 1 - Math.pow(1 - t, 4);

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/**
 * Account boxes glide to new slots (~360ms). A dragged box follows the pointer while the
 * others glide out of its way; on drop it glides from where it was let go.
 */
function useGlide(
  targets: Record<string, Box>,
  reduced: boolean,
  drag: { id: string; y: number } | null
): Record<string, Box> {
  const [current, setCurrent] = useState(targets);
  const currentRef = useRef(targets);
  const lastDrag = useRef<{ id: string; y: number } | null>(null);
  const key = JSON.stringify(targets);
  const dragging = drag !== null;

  useEffect(() => {
    if (drag) lastDrag.current = drag;
  });

  useEffect(() => {
    let from = currentRef.current;
    const dropped = !dragging ? lastDrag.current : null;
    if (dropped) {
      from = {
        ...from,
        [dropped.id]: { ...(from[dropped.id] ?? targets[dropped.id]), y: dropped.y },
      };
      lastDrag.current = null;
    }
    const settled = Object.keys(targets).every(
      (id) =>
        from[id] &&
        from[id].x === targets[id].x &&
        from[id].y === targets[id].y &&
        from[id].w === targets[id].w
    );
    if (reduced || settled || Object.keys(from).length !== Object.keys(targets).length) {
      currentRef.current = targets;
      setCurrent(targets);
      return;
    }
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const k = easeOut(Math.min(1, (now - start) / 360));
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reduced, dragging]);

  if (!drag) return current;
  const base = current[drag.id] ?? targets[drag.id];
  return { ...current, [drag.id]: { ...base, y: drag.y } };
}

const bezier = (a: Pt, b: Pt) => {
  const dx = (b.x - a.x) * 0.5;
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y} ${b.x - dx} ${b.y} ${b.x} ${b.y}`;
};

const rankWord = (index: number, sameLevel: boolean) =>
  sameLevel ? 'Shared' : index === 0 ? 'First' : 'Backup';

export function VariantFlow({ model }: { model: ProtoModel }) {
  const reduced = usePrefersReducedMotion();
  const [stageRef, measured] = useWidth<HTMLDivElement>();
  const [drag, setDrag] = useState<{ id: string; dy: number; startY: number; from: number } | null>(
    null
  );
  const nodeRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const W = measured || 680;
  const narrow = W < 560;
  // Wide: Macs on the left, accounts on the right. Narrow: Macs in a row on top, a "metro"
  // line down the left gutter into each account.
  const top = narrow ? 84 : 0;
  const macW = 112;
  const nodeW = narrow ? W - 30 : Math.min(340, W * 0.5);
  const nodeH = narrow ? 150 : 138;
  const gap = narrow ? 16 : 24;
  const H = top + model.order.length * nodeH + Math.max(0, model.order.length - 1) * gap;
  const nodeX = W - nodeW;
  const slot = nodeH + gap;
  const dropIndex = drag
    ? Math.max(0, Math.min(model.order.length - 1, Math.round((drag.from * slot + drag.dy) / slot)))
    : -1;
  const shown = drag ? moveItem(model.order, drag.from, dropIndex) : model.order;
  const targets: Record<string, Box> = {};
  shown.forEach((account, index) => {
    targets[account.id] = { x: nodeX, y: top + index * slot, w: nodeW, h: nodeH };
  });
  const boxes = useGlide(
    targets,
    reduced,
    drag ? { id: drag.id, y: top + drag.from * slot + drag.dy } : null
  );

  const n = model.clients.length;
  const macs = model.clients.map((client, index) =>
    narrow
      ? {
          client,
          label: { x: (W * (index + 1)) / (n + 1), y: 0 },
          anchor: { x: (W * (index + 1)) / (n + 1), y: 26 },
        }
      : (() => {
          const y = H / 2 + (index - (n - 1) / 2) * 52;
          return { client, label: { x: 0, y }, anchor: { x: macW, y } };
        })()
  );
  const merge: Pt = narrow ? { x: 12, y: top - 18 } : { x: macW + (nodeX - macW) * 0.42, y: H / 2 };

  const vbez = (a: Pt, b: Pt) => {
    const mid = (a.y + b.y) / 2;
    return `M ${a.x} ${a.y} C ${a.x} ${mid} ${b.x} ${mid} ${b.x} ${b.y}`;
  };
  const inPath = (a: Pt) => (narrow ? vbez(a, merge) : bezier(a, merge));
  const outPath = (box: Box) => {
    const midY = box.y + box.h / 2;
    if (!narrow) return bezier(merge, { x: box.x, y: midY });
    return `M ${merge.x} ${merge.y} L ${merge.x} ${midY - 10} Q ${merge.x} ${midY} ${merge.x + 10} ${midY} L ${box.x} ${midY}`;
  };
  const tail = (d: string) => d.replace(/^M\s*[-\d.]+\s+[-\d.]+\s*/, '');

  // Which account the Macs following the order use right now.
  const servingIds = new Set(model.serving.map((account) => account.id));

  const onPointerDown = (
    event: PointerEvent<HTMLDivElement>,
    account: ProtoAccount,
    index: number
  ) => {
    if (event.button !== 0 || model.order.length < 2) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ id: account.id, dy: 0, startY: event.clientY, from: index });
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const max = H - top - nodeH;
    const base = drag.from * (nodeH + gap);
    const dy = Math.max(-base, Math.min(max - base, event.clientY - drag.startY));
    setDrag({ ...drag, dy });
  };
  const onPointerUp = () => {
    if (!drag) return;
    const to = dropIndex;
    setDrag(null);
    if (to !== drag.from) {
      model.setOrder(
        moveItem(
          model.order.map((a) => a.id),
          drag.from,
          to
        )
      );
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, index: number) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const to = index + (event.key === 'ArrowUp' ? -1 : 1);
    if (to < 0 || to >= model.order.length) return;
    const id = model.order[index].id;
    model.setOrder(
      moveItem(
        model.order.map((a) => a.id),
        index,
        to
      )
    );
    requestAnimationFrame(() => nodeRefs.current[id]?.focus());
  };

  const hint = resetHint(model);
  const serving = describeServing(model);
  const [first] = model.order;

  return (
    <>
      <p className={shared.eyebrow}>Claude</p>
      <h1 className={shared.title}>{serving.lead}</h1>
      <p className={styles.follow} aria-live="polite">
        {serving.follow}
      </p>

      <div ref={stageRef} className={styles.stage} style={{ height: H }}>
        {measured > 0 && (
          <>
            <svg className={styles.svg} width={W} height={H} aria-hidden="true">
              {macs.map(({ client, anchor }) => {
                const locked = client.target;
                const end = locked ? boxes[locked.id] : null;
                const d = end ? `${inPath(anchor)} ${tail(outPath(end))}` : inPath(anchor);
                return (
                  <path
                    key={client.ref}
                    d={d}
                    className={styles.path}
                    data-state={locked ? (client.broken ? 'broken' : 'locked') : 'live'}
                  />
                );
              })}
              {model.order.map((account) => {
                const box = boxes[account.id];
                const d = outPath(box);
                const state = servingIds.has(account.id)
                  ? 'live'
                  : account.role === 'resting' || account.role === 'off'
                    ? 'out'
                    : 'waiting';
                return <path key={account.id} d={d} className={styles.path} data-state={state} />;
              })}
              <circle cx={merge.x} cy={merge.y} r={3.5} className={styles.merge} />
              {!reduced &&
                macs
                  .filter(({ client }) => !client.target)
                  .flatMap(({ client, anchor }, i) =>
                    model.serving.map((account) => {
                      const box = boxes[account.id];
                      const path = `${inPath(anchor)} ${tail(outPath(box))}`;
                      return (
                        <circle
                          key={`${client.ref}:${account.id}:${Math.round(box.y)}`}
                          r={3}
                          className={styles.dot}
                        >
                          <animateMotion
                            dur="3.6s"
                            repeatCount="indefinite"
                            path={path}
                            begin={`-${(i * 1.8).toFixed(1)}s`}
                          />
                          <animate
                            attributeName="opacity"
                            values="0;0.9;0.9;0"
                            keyTimes="0;0.15;0.85;1"
                            dur="3.6s"
                            repeatCount="indefinite"
                            begin={`-${(i * 1.8).toFixed(1)}s`}
                          />
                        </circle>
                      );
                    })
                  )}
            </svg>

            {macs.map(({ client, label }) => (
              <div
                key={client.ref}
                className={styles.mac}
                data-problem={client.broken}
                data-narrow={narrow}
                style={{ top: label.y, left: label.x }}
              >
                <MacGlyph size={16} />
                {client.shortName}
              </div>
            ))}

            <div className={styles.nodes} role="list" aria-label="Claude accounts in order">
              {model.order.map((account, index) => {
                const box = boxes[account.id];
                const dragging = drag?.id === account.id;
                const place = shown.findIndex((item) => item.id === account.id);
                return (
                  <div
                    key={account.id}
                    ref={(element) => {
                      nodeRefs.current[account.id] = element;
                    }}
                    role="listitem"
                    tabIndex={0}
                    aria-roledescription="reorderable account"
                    aria-label={`${rankWord(place, model.sameLevel)}: ${account.label}. ${account.healthText}. Press up or down arrow to move.`}
                    data-arrow-keys
                    className={styles.node}
                    data-dragging={dragging}
                    data-serving={servingIds.has(account.id)}
                    data-role={account.role}
                    style={{
                      transform: `translate(${box.x}px, ${box.y}px)`,
                      width: box.w,
                      height: box.h,
                    }}
                    onPointerDown={(event) => onPointerDown(event, account, index)}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={() => setDrag(null)}
                    onKeyDown={(event) => onKeyDown(event, index)}
                  >
                    <div className={styles.nodeTop}>
                      <span className={styles.rank}>{rankWord(place, model.sameLevel)}</span>
                      <span className={styles.grip} aria-hidden="true">
                        ⋮⋮
                      </span>
                    </div>
                    <div className={styles.name}>{account.label}</div>
                    <Health account={account} />
                    <WeeklyMeter account={account} />
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      <div className={styles.below}>
        {hint && !hint.good ? (
          <p className={shared.hint}>
            <span>{hint.text}</span>
            <button
              type="button"
              className={shared.textButton}
              onClick={() =>
                model.setOrder([
                  hint.account.id,
                  ...model.order.filter((a) => a.id !== hint.account.id).map((a) => a.id),
                ])
              }
            >
              Make {hint.account.label} first
            </button>
          </p>
        ) : (
          <p className={shared.hint}>
            <span>{hint ? hint.text : 'Drag an account to change who goes first.'}</span>
          </p>
        )}
        {first && model.order.length > 1 && (
          <button
            type="button"
            className={shared.textButton}
            aria-pressed={model.simulateOut !== null}
            onClick={() => model.setSimulateOut(model.simulateOut ? null : first.id)}
          >
            {model.simulateOut ? 'End preview' : `Preview: ${first.label} runs out`}
          </button>
        )}
      </div>

      <Footnotes model={model} />
      <Advanced model={model} />
    </>
  );
}
