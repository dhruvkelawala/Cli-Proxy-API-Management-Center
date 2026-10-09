import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import { OverviewDetails } from '@/features/overview/components/OverviewDetails';

let previous = 'en';
beforeAll(async () => {
  previous = i18n.language;
  await i18n.changeLanguage('en');
});
afterAll(async () => {
  await i18n.changeLanguage(previous);
});

describe('Overview More', () => {
  test("Overview's More lists each provider's requests and success rate, and account health", () => {
    const dashboard = {
      config: null,
      counts: { managementKeys: 1, providerKeys: 0, credentials: 3, models: 5 },
      credentials: {
        total: 3,
        available: 2,
        needsAttention: 1,
        unknown: 0,
        disabled: 0,
        byType: [],
      },
      traffic: {
        buckets: [],
        totalSuccess: 0,
        totalFailure: 0,
        total: 0,
        successRate: null,
        peakTotal: 0,
        peakIndex: -1,
        windowMinutes: 0,
      },
      providers: [
        {
          id: 'claude',
          credentials: 2,
          success: 240,
          failure: 5,
          total: 245,
          successRate: 97.96,
          // The window: 49 of 50 in the recent buckets (lifetime totals must not show).
          buckets: [
            { time: '10:00-10:10', success: 30, failed: 1 },
            { time: '10:10-10:20', success: 19, failed: 0 },
          ],
        },
        {
          id: 'codex',
          credentials: 1,
          success: 72,
          failure: 0,
          total: 72,
          successRate: 100,
          buckets: [],
        },
      ],
    };
    const markup = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(OverviewDetails, { dashboard: dashboard as never, windowLabel: '3h 20m' })
      )
    );
    expect(markup).toContain('<table');
    expect(markup).toContain('Claude');
    expect(markup).toContain('<td>50</td>');
    expect(markup).toContain('<td>98%</td>');
    expect(markup).not.toContain('<td>245</td>');
    expect(markup).toContain('3 accounts: 2 available, 1 need attention, 0 unknown, 0 off.');
  });
});
