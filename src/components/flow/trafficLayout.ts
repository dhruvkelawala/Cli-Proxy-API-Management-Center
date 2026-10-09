/**
 * Pure geometry for TrafficFlow: gateway → providers → accounts. React-free so it can be tested
 * without a DOM.
 *
 * Wide: the gateway on the left, provider nodes in the middle column, account nodes on the
 * right, each provider centred on its accounts.
 * Narrow (< TRAFFIC_NARROW_BREAKPOINT): one column. The gateway on top, a trunk down the left
 * gutter, each provider on the trunk and its accounts indented under it.
 */

import type { Box, Point } from './flowLayout';

export const TRAFFIC_NARROW_BREAKPOINT = 600;

const ACCOUNT_HEIGHT = 58;
const ACCOUNT_GAP = 10;
const GROUP_GAP = 26;
const PROVIDER_HEIGHT = 44;
const GATEWAY_COLUMN = 128;

const NARROW_TOP = 62;
const NARROW_PROVIDER_HEIGHT = 40;
const NARROW_ACCOUNT_HEIGHT = 54;
const NARROW_GAP = 8;
const NARROW_GROUP_GAP = 18;
const TRUNK_X = 6;
const BRANCH_X = 26;
const NARROW_ACCOUNT_X = 46;

export interface TrafficLayoutInput {
  width: number;
  /** Number of accounts under each provider, in order. */
  groups: number[];
}

export interface TrafficGroupLayout {
  provider: Box;
  accounts: Box[];
}

export interface TrafficLayout {
  width: number;
  height: number;
  narrow: boolean;
  /** Where every path starts. */
  hub: Point;
  /** Top-left of the gateway label. */
  hubLabel: Point;
  groups: TrafficGroupLayout[];
}

export const computeTrafficLayout = ({ width, groups }: TrafficLayoutInput): TrafficLayout => {
  const narrow = width < TRAFFIC_NARROW_BREAKPOINT;
  if (narrow) {
    let y = NARROW_TOP;
    const laid = groups.map((count) => {
      const provider = { x: BRANCH_X, y, w: width - BRANCH_X, h: NARROW_PROVIDER_HEIGHT };
      y += NARROW_PROVIDER_HEIGHT + NARROW_GAP;
      const accounts = Array.from({ length: count }, () => {
        const box = {
          x: NARROW_ACCOUNT_X,
          y,
          w: width - NARROW_ACCOUNT_X,
          h: NARROW_ACCOUNT_HEIGHT,
        };
        y += NARROW_ACCOUNT_HEIGHT + NARROW_GAP;
        return box;
      });
      y += NARROW_GROUP_GAP - NARROW_GAP;
      return { provider, accounts };
    });
    const height = Math.max(NARROW_TOP, y - NARROW_GROUP_GAP);
    return {
      width,
      height,
      narrow,
      hub: { x: TRUNK_X, y: 10 },
      hubLabel: { x: 0, y: 0 },
      groups: laid,
    };
  }

  const accountWidth = Math.min(300, width * 0.4);
  const accountX = width - accountWidth;
  const providerWidth = Math.min(150, width * 0.2);
  const providerX = GATEWAY_COLUMN + (accountX - GATEWAY_COLUMN - providerWidth) * 0.5;
  let y = 0;
  const laid = groups.map((count) => {
    const n = Math.max(1, count);
    const groupHeight = n * ACCOUNT_HEIGHT + (n - 1) * ACCOUNT_GAP;
    const top = y;
    const accounts = Array.from({ length: count }, (_, index) => ({
      x: accountX,
      y: top + index * (ACCOUNT_HEIGHT + ACCOUNT_GAP),
      w: accountWidth,
      h: ACCOUNT_HEIGHT,
    }));
    const provider = {
      x: providerX,
      y: top + groupHeight / 2 - PROVIDER_HEIGHT / 2,
      w: providerWidth,
      h: PROVIDER_HEIGHT,
    };
    y += groupHeight + GROUP_GAP;
    return { provider, accounts };
  });
  const height = Math.max(ACCOUNT_HEIGHT, y - GROUP_GAP);
  const hub = { x: GATEWAY_COLUMN - 14, y: height / 2 };
  return {
    width,
    height,
    narrow,
    hub,
    hubLabel: { x: 0, y: height / 2 },
    groups: laid,
  };
};

const horizontalCurve = (a: Point, b: Point) => {
  const dx = (b.x - a.x) * 0.5;
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y} ${b.x - dx} ${b.y} ${b.x} ${b.y}`;
};

/** A vertical line that turns right into a point, with a soft corner. */
const elbow = (from: Point, to: Point) =>
  `M ${from.x} ${from.y} L ${from.x} ${to.y - 8} Q ${from.x} ${to.y} ${from.x + 8} ${to.y} L ${to.x} ${to.y}`;

/** Gateway → the leading edge of a provider node. */
export const providerPath = (layout: TrafficLayout, provider: Box): string =>
  layout.narrow
    ? elbow(layout.hub, { x: provider.x, y: provider.y + provider.h / 2 })
    : horizontalCurve(layout.hub, { x: provider.x, y: provider.y + provider.h / 2 });

/** Where paths leave a provider node toward its accounts. */
export const providerExit = (layout: TrafficLayout, provider: Box): Point =>
  layout.narrow
    ? { x: provider.x + 10, y: provider.y + provider.h }
    : { x: provider.x + provider.w, y: provider.y + provider.h / 2 };

/** Provider → the leading edge of an account node. */
export const accountPath = (layout: TrafficLayout, provider: Box, account: Box): string => {
  const exit = providerExit(layout, provider);
  const target = { x: account.x, y: account.y + account.h / 2 };
  return layout.narrow ? elbow(exit, target) : horizontalCurve(exit, target);
};

const tail = (d: string) => d.replace(/^M\s*[-\d.]+\s+[-\d.]+\s*/, '');

/** Gateway → provider → account as one path, for the travelling dots. */
export const routeThrough = (layout: TrafficLayout, provider: Box, account: Box): string => {
  const exit = providerExit(layout, provider);
  return `${providerPath(layout, provider)} L ${exit.x} ${exit.y} ${tail(
    accountPath(layout, provider, account)
  )}`;
};

/** Path stroke width for a share of traffic (0-1): a hairline when idle, thicker when busy. */
export const strokeFor = (share: number): number =>
  Math.round((1.25 + Math.max(0, Math.min(1, share)) * 2.75) * 100) / 100;

/**
 * Travelling dots for a path: none when it carries nothing, 1-6 by volume, and how many of
 * them are red failure flecks (at least one when anything failed).
 */
export const dotsFor = (volume: number, failures: number): { dots: number; flecks: number } => {
  if (volume <= 0) return { dots: 0, flecks: 0 };
  const dots = Math.max(1, Math.min(6, Math.round(1 + volume * 5)));
  const flecks = failures > 0 ? Math.max(1, Math.min(dots, Math.round(failures * dots))) : 0;
  return { dots, flecks };
};
