import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TrafficFlow } from '@/components/flow';
import {
  TRAFFIC_NARROW_BREAKPOINT,
  accountPath,
  computeTrafficLayout,
  dotsFor,
  providerPath,
  routeThrough,
  strokeFor,
} from '@/components/flow/trafficLayout';

describe('traffic layout', () => {
  test('wide: providers sit between the gateway and their accounts, centred on them', () => {
    const layout = computeTrafficLayout({ width: 760, groups: [2, 1] });
    expect(layout.narrow).toBe(false);
    const [claude, codex] = layout.groups;
    expect(claude.accounts).toHaveLength(2);
    expect(claude.provider.x).toBeGreaterThan(layout.hub.x);
    expect(claude.provider.x + claude.provider.w).toBeLessThan(claude.accounts[0].x);
    const centre = (claude.accounts[0].y + claude.accounts[1].y + claude.accounts[1].h) / 2;
    expect(claude.provider.y + claude.provider.h / 2).toBeCloseTo(centre, 5);
    // Groups never overlap; the gateway is vertically centred.
    expect(codex.accounts[0].y).toBeGreaterThan(claude.accounts[1].y + claude.accounts[1].h);
    expect(layout.hub.y).toBeCloseTo(layout.height / 2, 5);
  });

  test('narrow: one column, accounts indented under their provider', () => {
    const layout = computeTrafficLayout({
      width: TRAFFIC_NARROW_BREAKPOINT - 210,
      groups: [2, 1],
    });
    expect(layout.narrow).toBe(true);
    const [claude, codex] = layout.groups;
    expect(claude.accounts[0].x).toBeGreaterThan(claude.provider.x);
    expect(claude.accounts[0].y).toBeGreaterThan(claude.provider.y);
    expect(codex.provider.y).toBeGreaterThan(claude.accounts[1].y);
    // Nothing starts above the gateway label row.
    expect(claude.provider.y).toBeGreaterThan(layout.hub.y + 30);
  });

  test('routes start at the gateway and end at the account’s leading edge', () => {
    const layout = computeTrafficLayout({ width: 760, groups: [1] });
    const { provider, accounts } = layout.groups[0];
    expect(providerPath(layout, provider).startsWith(`M ${layout.hub.x} ${layout.hub.y}`)).toBe(
      true
    );
    const end = `${accounts[0].x} ${accounts[0].y + accounts[0].h / 2}`;
    expect(accountPath(layout, provider, accounts[0]).endsWith(end)).toBe(true);
    const route = routeThrough(layout, provider, accounts[0]);
    expect(route.startsWith(`M ${layout.hub.x}`)).toBe(true);
    expect(route.endsWith(end)).toBe(true);
    expect(route.match(/M /g)).toHaveLength(1);
  });

  test('busier paths are thicker; idle ones stay a hairline', () => {
    expect(strokeFor(0)).toBe(1.25);
    expect(strokeFor(1)).toBe(4);
    expect(strokeFor(0.5)).toBeGreaterThan(strokeFor(0.1));
    expect(strokeFor(5)).toBe(4);
  });

  test('dots scale with volume and failures become red flecks', () => {
    expect(dotsFor(0, 0.5)).toEqual({ dots: 0, flecks: 0 });
    expect(dotsFor(0.01, 0)).toEqual({ dots: 1, flecks: 0 });
    expect(dotsFor(1, 0)).toEqual({ dots: 6, flecks: 0 });
    expect(dotsFor(1, 0.02).flecks).toBe(1);
    expect(dotsFor(1, 1)).toEqual({ dots: 6, flecks: 6 });
  });
});

describe('TrafficFlow markup', () => {
  const markup = renderToStaticMarkup(
    createElement(TrafficFlow, {
      label: 'Providers and their accounts',
      hubLabel: 'Gateway',
      hubDetail: '127.0.0.1:8317',
      providers: [
        {
          id: 'claude',
          label: 'Claude',
          meta: '245 requests',
          share: 0.8,
          state: 'live',
          accounts: [
            { id: 'w', state: 'live', volume: 1, share: 0.7, failures: 0.1, content: 'Work' },
            { id: 'p', state: 'warn', volume: 0, share: 0.1, failures: 0, content: 'Personal' },
          ],
        },
      ],
    })
  );

  test('the diagram is decorative; providers and accounts are a labelled nested list', () => {
    expect(markup).toContain('<svg');
    expect(markup).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(markup).toContain('aria-label="Providers and their accounts"');
    expect(markup).toContain('aria-label="Claude"');
    expect(markup.match(/<li/g)).toHaveLength(3);
    expect(markup).toContain('data-state="warn"');
  });

  test('travelling dots respect reduced motion (CSS and component)', () => {
    const source = readFileSync('src/components/flow/TrafficFlow.tsx', 'utf8');
    expect(source).toContain('usePrefersReducedMotion()');
    expect(source).toContain('{!reduced &&');
    const css = readFileSync('src/components/flow/TrafficFlow.module.scss', 'utf8');
    expect(css).toMatch(/prefers-reduced-motion: reduce[\s\S]*animation: none/);
  });
});
