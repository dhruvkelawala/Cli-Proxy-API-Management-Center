/**
 * PROTOTYPE C · The week. A seven-day line: who goes first now, when each account's weekly
 * limit resets, and who should go first after each reset (the one that resets sooner).
 */
import { useEffect, useState } from 'react';
import { formatWhen, resetHint, type ProtoAccount, type ProtoModel } from './useProtoRoutesModel';
import { Advanced, Footnotes, Health, Serving } from './shared';
import shared from './Prototype.module.scss';
import styles from './VariantWeek.module.scss';

const DAY = 86_400_000;
const SPAN = 7 * DAY;

type Window = { start: number; end: number; account: ProtoAccount; now: boolean };

const resetsWithin = (account: ProtoAccount, from: number, to: number): number[] => {
  const at = account.quota.weekResetAt;
  if (!at) return [];
  const out: number[] = [];
  let t = at;
  while (t <= from) t += SPAN;
  for (; t < to; t += SPAN) out.push(t);
  return out;
};

const nextReset = (account: ProtoAccount, after: number): number => {
  const at = account.quota.weekResetAt;
  if (!at) return Number.POSITIVE_INFINITY;
  let t = at;
  while (t <= after) t += SPAN;
  return t;
};

const buildWindows = (model: ProtoModel, now: number): Window[] => {
  const end = now + SPAN;
  const eligible = model.order.filter((account) => account.health !== 'disabled');
  const current = model.serving[0] ?? model.order[0];
  if (!current) return [];
  const bounds = Array.from(
    new Set(eligible.flatMap((account) => resetsWithin(account, now, end)))
  ).sort((a, b) => a - b);
  const edges = [now, ...bounds, end];
  const windows: Window[] = [];
  for (let i = 0; i < edges.length - 1; i += 1) {
    const start = edges[i];
    const stop = edges[i + 1];
    // Best first = the usable account whose weekly room expires soonest.
    let account = current;
    if (!model.sameLevel) {
      const pool = eligible.filter((a) => i > 0 || (a.usable && !a.simulatedOut));
      account = [...pool].sort((a, b) => nextReset(a, start) - nextReset(b, start))[0] ?? current;
    }
    const last = windows[windows.length - 1];
    if (last && last.account.id === account.id) last.end = stop;
    else windows.push({ start, end: stop, account, now: i === 0 });
  }
  return windows;
};

const pct = (t: number, now: number) => `${(((t - now) / SPAN) * 100).toFixed(3)}%`;

export function VariantWeek({ model }: { model: ProtoModel }) {
  // One "now" for every position; ticks over each minute.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const windows = buildWindows(model, now);
  const [first, second] = model.order;
  const hint = resetHint(model);
  const known = model.order.some((account) => account.quota.weekResetAt);

  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const ticks = Array.from({ length: 7 }, (_, i) => midnight.getTime() + i * DAY).filter(
    (t) => t < now + SPAN - DAY * 0.35 && t > now + DAY * 0.8
  );

  const flip = windows.find((window) => !window.now);
  const title =
    first && second && !model.sameLevel
      ? `${first.label} first, ${second.label} as backup.`
      : first && second
        ? `${first.label} and ${second.label} share the load.`
        : 'Your Claude week';

  return (
    <>
      <p className={shared.eyebrow}>Claude · next 7 days</p>
      <h1 className={shared.title}>{title}</h1>
      <Serving model={model} />

      <div className={styles.week}>
        <div className={styles.bandLabel}>Best to go first</div>
        <div className={styles.band} role="list" aria-label="Who goes first over the next 7 days">
          {windows.map((window) => (
            <div
              key={`${window.start}:${window.account.id}`}
              role="listitem"
              className={styles.segment}
              data-now={window.now}
              data-current={window.now && window.account.id === (model.serving[0] ?? first)?.id}
              style={{
                left: pct(window.start, now),
                width: pct(now + (window.end - window.start), now),
              }}
              aria-label={`${window.now ? 'Now' : `From ${formatWhen(window.start)}`}: ${window.account.label} is best to go first`}
            >
              <span key={window.account.id} className={styles.segmentText}>
                {window.account.label}
              </span>
            </div>
          ))}
        </div>

        <div className={styles.ticks} aria-hidden="true">
          <span className={styles.nowTick} style={{ left: 0 }}>
            Now
          </span>
          {ticks.map((t) => (
            <span key={t} className={styles.tick} style={{ left: pct(t, now) }}>
              {new Date(t).toLocaleDateString([], { weekday: 'short' })}
            </span>
          ))}
        </div>

        <div className={styles.lanes}>
          {model.order.map((account) => {
            const resets = resetsWithin(account, now, now + SPAN);
            const left = account.quota.weekLeft;
            return (
              <div key={account.id} className={styles.lane}>
                <div className={styles.laneHead}>
                  <span className={styles.laneName}>{account.label}</span>
                  <Health account={account} />
                  {left !== null && <span className={styles.laneLeft}>{left}% left</span>}
                </div>
                <div className={styles.track}>
                  {resets.length > 0 ? (
                    <>
                      <span
                        className={styles.room}
                        data-low={(left ?? 100) < 20}
                        style={{
                          width: pct(resets[0], now),
                          opacity: 0.35 + ((left ?? 50) / 100) * 0.65,
                        }}
                      />
                      {resets.map((t) => (
                        <span
                          key={t}
                          className={styles.reset}
                          style={{ left: pct(t, now) }}
                          data-edge={
                            (t - now) / SPAN < 0.18
                              ? 'start'
                              : (t - now) / SPAN > 0.82
                                ? 'end'
                                : undefined
                          }
                        >
                          <span className={styles.resetDot} />
                          <span className={styles.resetText}>resets {formatWhen(t)}</span>
                        </span>
                      ))}
                    </>
                  ) : (
                    <span className={styles.unknown}>
                      {account.quota.status === 'loading' ? 'Checking…' : 'Reset time not known'}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className={styles.below}>
        <p className={shared.hint}>
          <span>
            {hint && !hint.good
              ? hint.text
              : flip && known
                ? `${windows[0].account.label} is best right now. After it resets (${formatWhen(flip.start)}), switch to ${flip.account.label}.`
                : hint
                  ? hint.text
                  : 'Reset times appear once the Quota page can read them.'}
          </span>
        </p>
        {first && second && (
          <button
            type="button"
            className={styles.swap}
            onClick={() =>
              model.setOrder([second.id, first.id, ...model.order.slice(2).map((a) => a.id)])
            }
          >
            Make {second.label} first
          </button>
        )}
      </div>

      <Footnotes model={model} />
      <Advanced model={model} />
    </>
  );
}
