import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion';
import {
  accountPath,
  computeTrafficLayout,
  dotsFor,
  providerPath,
  routeThrough,
  strokeFor,
} from './trafficLayout';
import styles from './TrafficFlow.module.scss';

/**
 * live: serving now (accent, dots). idle: waiting (dashed). warn: cooling down or out of room
 * (amber dashes). bad: failing (red dashes). off: turned off (faint).
 */
export type TrafficNodeState = 'live' | 'idle' | 'warn' | 'bad' | 'off';

export interface TrafficAccountNode {
  id: string;
  state: TrafficNodeState;
  /** 0-1: how many dots travel to it now (recent traffic, relative to the busiest account). */
  volume: number;
  /** 0-1: path thickness (its share of all traffic in the window). */
  share: number;
  /** 0-1: failed share of its recent traffic; shown as red flecks among the dots. */
  failures: number;
  /** Node body. */
  content: ReactNode;
}

export interface TrafficProviderNode {
  id: string;
  label: string;
  /** Quiet second line, e.g. "1.2k requests". */
  meta?: string;
  /** 0-1: path thickness from the gateway. */
  share: number;
  state: TrafficNodeState;
  accounts: TrafficAccountNode[];
}

export interface TrafficFlowProps {
  providers: TrafficProviderNode[];
  /** Accessible name of the list of providers. */
  label: string;
  hubLabel: string;
  /** Quiet line under the gateway label (e.g. its host). */
  hubDetail?: string;
}

const DOT_SECONDS = 3.8;

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

/**
 * The live traffic view: gateway → providers → accounts. Busier paths are thicker and carry
 * more travelling dots; failures travel as red flecks. Reduced motion keeps the paths and their
 * thickness but shows no dots.
 */
export function TrafficFlow({ providers, label, hubLabel, hubDetail }: TrafficFlowProps) {
  const reduced = usePrefersReducedMotion();
  const [stageRef, measured] = useStageWidth();
  const layout = computeTrafficLayout({
    width: measured || 680,
    groups: providers.map((provider) => provider.accounts.length),
  });
  let order = 0;

  return (
    <div
      ref={stageRef}
      className={styles.stage}
      style={{ height: layout.height }}
      data-narrow={layout.narrow}
      data-testid="traffic-flow"
    >
      <svg
        className={styles.svg}
        width={layout.width}
        height={layout.height}
        aria-hidden="true"
        focusable="false"
      >
        {providers.map((provider, groupIndex) => {
          const box = layout.groups[groupIndex]?.provider;
          if (!box) return null;
          return (
            <g key={provider.id}>
              <path
                d={providerPath(layout, box)}
                className={styles.path}
                data-state={provider.state}
                style={{ strokeWidth: strokeFor(provider.share) }}
              />
              {provider.accounts.map((account, index) => {
                const target = layout.groups[groupIndex].accounts[index];
                if (!target) return null;
                return (
                  <path
                    key={account.id}
                    d={accountPath(layout, box, target)}
                    className={styles.path}
                    data-state={account.state}
                    style={{ strokeWidth: strokeFor(account.share) }}
                  />
                );
              })}
            </g>
          );
        })}
        <circle cx={layout.hub.x} cy={layout.hub.y} r={4.5} className={styles.hub} />
        {!reduced &&
          providers.flatMap((provider, groupIndex) =>
            provider.accounts.flatMap((account, index) => {
              const box = layout.groups[groupIndex]?.provider;
              const target = layout.groups[groupIndex]?.accounts[index];
              if (!box || !target) return [];
              const { dots, flecks } = dotsFor(account.volume, account.failures);
              if (dots === 0) return [];
              const route = routeThrough(layout, box, target);
              // Flecks replace evenly spaced dots, so volume stays honest.
              const fleckEvery = flecks > 0 ? dots / flecks : Infinity;
              return Array.from({ length: dots }, (_, i) => {
                const fleck = flecks > 0 && i % Math.max(1, Math.round(fleckEvery)) === 0;
                const begin = `-${((i * DOT_SECONDS) / dots).toFixed(2)}s`;
                return (
                  <circle
                    key={`${account.id}:${i}:${Math.round(target.y)}:${layout.width}`}
                    r={fleck ? 2.4 : 2.8}
                    className={fleck ? styles.fleck : styles.dot}
                  >
                    <animateMotion
                      dur={`${DOT_SECONDS}s`}
                      repeatCount="indefinite"
                      path={route}
                      begin={begin}
                    />
                    <animate
                      attributeName="opacity"
                      values="0;0.95;0.95;0"
                      keyTimes="0;0.12;0.88;1"
                      dur={`${DOT_SECONDS}s`}
                      repeatCount="indefinite"
                      begin={begin}
                    />
                  </circle>
                );
              });
            })
          )}
      </svg>

      <div
        className={styles.gateway}
        data-narrow={layout.narrow}
        style={{ left: layout.hubLabel.x, top: layout.hubLabel.y }}
      >
        <span className={styles.gatewayName}>{hubLabel}</span>
        {hubDetail ? <span className={styles.gatewayDetail}>{hubDetail}</span> : null}
      </div>

      <ul className={styles.list} aria-label={label}>
        {providers.map((provider, groupIndex) => {
          const group = layout.groups[groupIndex];
          if (!group) return null;
          const providerOrder = order++;
          return (
            <li key={provider.id} className={styles.group}>
              <div
                className={styles.provider}
                data-state={provider.state}
                style={
                  {
                    transform: `translate(${group.provider.x}px, ${group.provider.y}px)`,
                    width: group.provider.w,
                    height: group.provider.h,
                    '--i': providerOrder,
                  } as CSSProperties
                }
              >
                <span className={styles.providerName}>{provider.label}</span>
                {provider.meta ? (
                  <span className={styles.providerMeta}>{provider.meta}</span>
                ) : null}
              </div>
              <ul className={styles.accounts} aria-label={provider.label}>
                {provider.accounts.map((account, index) => {
                  const box = group.accounts[index];
                  if (!box) return null;
                  const accountOrder = order++;
                  return (
                    <li
                      key={account.id}
                      className={styles.account}
                      data-state={account.state}
                      style={
                        {
                          transform: `translate(${box.x}px, ${box.y}px)`,
                          width: box.w,
                          height: box.h,
                          '--i': accountOrder,
                        } as CSSProperties
                      }
                    >
                      {account.content}
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
