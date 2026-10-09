import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import { StepFlow, type StepFlowState } from '@/components/flow';
import { linkStateOf, nodeStateOf } from '@/components/flow/stepFlowModel';
import { OAuthPage } from '@/pages/OAuthPage';
import { SystemPage } from '@/pages/SystemPage';
import { ProviderKeyList } from '@/features/providers/components/ProviderKeyList';
import type { ProviderResource } from '@/features/providers/types';

// Vite injects the app version at build time; tests stand in for it.
(globalThis as { __APP_VERSION__?: string }).__APP_VERSION__ = 'v0.0.0-test';

let previous = 'en';
beforeAll(async () => {
  previous = i18n.language;
  await i18n.changeLanguage('en');
});
afterAll(async () => {
  await i18n.changeLanguage(previous);
});

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const inRouter = (element: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(createElement(MemoryRouter, null, element));

/** Markup after the page's More toggle, i.e. what sits inside the collapsed region. */
const splitAtMore = (markup: string, label: string) => {
  const at = markup.indexOf(`>${label}</span>`);
  expect(at).toBeGreaterThan(-1);
  return { before: markup.slice(0, at), after: markup.slice(at) };
};

describe('StepFlow', () => {
  const steps = [
    { id: 'browser', label: 'Browser' },
    { id: 'signin', label: 'Sign in' },
    { id: 'added', label: 'Account added' },
  ];
  const render = (current: number, state: StepFlowState) =>
    renderToStaticMarkup(createElement(StepFlow, { steps, current, state, label: 'Steps' }));

  test('node and link states follow the step under way', () => {
    expect([0, 1, 2].map((i) => nodeStateOf(i, 1, 'active'))).toEqual(['done', 'current', 'idle']);
    expect([0, 1].map((i) => linkStateOf(i, 1, 'active'))).toEqual(['done', 'live']);
    expect([0, 1, 2].map((i) => nodeStateOf(i, 2, 'done'))).toEqual(['done', 'done', 'done']);
    expect(nodeStateOf(1, 1, 'failed')).toBe('failed');
    expect(linkStateOf(1, 1, 'failed')).toBe('idle');
    expect([0, 1, 2].map((i) => nodeStateOf(i, -1, 'idle'))).toEqual(['idle', 'idle', 'idle']);
  });

  test('one travelling dot while waiting, none when idle or finished; the step is announced', () => {
    const waiting = render(1, 'active');
    expect(waiting.match(/aria-current="step"/g)?.length).toBe(1);
    expect(waiting).toContain('aria-label="Steps"');
    expect(waiting.match(/data-link="live"/g)?.length).toBe(1);
    expect(render(-1, 'idle')).not.toContain('data-link="live"');
    expect(render(2, 'done')).not.toContain('data-link="live"');
    expect(render(2, 'done')).not.toContain('aria-current');
  });

  test('reduced motion drops the dot and transitions', () => {
    const css = read('src/components/flow/StepFlow.module.scss');
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toContain('.dot');
    expect(reduced).toContain('display: none');
  });
});

describe('OAuth page structure', () => {
  test('sentence, steps, the everyday providers, then the rest behind More', () => {
    const markup = inRouter(createElement(OAuthPage));
    expect(markup).toContain('Sign in a new account.');
    expect(markup).toContain('aria-label="Sign-in steps"');
    const { before, after } = splitAtMore(markup, 'More providers');
    for (const name of ['Claude', 'Codex', 'Antigravity']) {
      expect(before).toContain(`aria-label="Sign in with ${name}"`);
    }
    for (const name of ['Devin', 'xAI', 'Muse (Meta)', 'Kimi China']) {
      expect(after).toContain(`aria-label="Sign in with ${name}"`);
      expect(before).not.toContain(`aria-label="Sign in with ${name}"`);
    }
    expect(after).toContain('Import Vertex Credential');
    // One short line per row; the long OAuth description is only a tooltip.
    expect(before).toContain('Sign in with your Claude account.');
    expect(markup).not.toMatch(/>Login to Anthropic \(Claude\) service/);
    // Collapsed by default: the region is inert until opened.
    expect(after).toMatch(/role="region"[^>]*inert=""/);
  });
});

describe('Login page structure', () => {
  // The page renders its splash first (auto-login), so this checks the form's source order.
  test('the key is up front; the connection address is behind More', () => {
    const source = read('src/pages/LoginPage.tsx');
    const more = source.indexOf('<MoreDisclosure');
    expect(source.indexOf('name="cpa-management-key"')).toBeLessThan(more);
    expect(source.indexOf("t('login.remember_password_label')")).toBeLessThan(more);
    expect(source.indexOf("ariaLabel={t('login.custom_connection_label')}")).toBeGreaterThan(more);
    expect(source).toContain("t('login.flow.title')");
  });
});

describe('Management Center page structure', () => {
  test('facts up front; models, links and clearing login data behind More', () => {
    const markup = inRouter(createElement(SystemPage));
    const { before, after } = splitAtMore(markup, 'More');
    expect(before).toContain('Check for updates');
    expect(after).toContain('Main Repository');
    expect(after).toContain('Clear login data');
    expect(before).not.toContain('Clear login data');
  });

  test('clearing login data goes through the confirming helper', () => {
    // Behaviour is covered in flowPagesReviewFixes; this pins the page to that helper.
    expect(read('src/pages/SystemPage.tsx')).toContain('requestClearLoginData({');
  });
});

describe('Provider key list', () => {
  const resource = (overrides: Partial<ProviderResource>): ProviderResource => ({
    id: 'r1',
    brand: 'claude',
    originalIndex: 0,
    name: null,
    identifier: 'sk-***',
    apiKeyPreview: 'sk-***et',
    apiKey: 'sk-synthetic',
    authIndex: null,
    baseUrl: 'https://api.anthropic.com',
    proxyUrl: null,
    prefix: null,
    modelCount: 2,
    models: [],
    priority: 0,
    headerCount: 0,
    excludedModelCount: 0,
    apiKeyEntryCount: 1,
    disabled: false,
    flags: {},
    selector: {} as ProviderResource['selector'],
    raw: {},
    ...overrides,
  });

  test('one hairline row per key with state, switch and actions, all named', () => {
    const noop = () => undefined;
    const markup = renderToStaticMarkup(
      createElement(ProviderKeyList, {
        groups: [
          {
            id: 'claude',
            resources: [
              resource({}),
              resource({ id: 'r2', apiKeyPreview: 'sk-***2', disabled: true }),
            ],
          },
        ],
        selectedId: null,
        onView: noop,
        onEdit: noop,
        onDelete: noop,
        onToggleDisabled: noop,
        onAdd: noop,
      })
    );
    expect(markup).toContain('aria-label="Add another Claude key"');
    expect(markup).toContain('api.anthropic.com · 2 models');
    expect(markup).toContain('aria-label="Turn sk-***et on or off"');
    expect(markup).toContain('aria-label="Actions for sk-***2"');
    expect(markup).toContain('Disabled');
    expect(markup).toContain('Active');
  });
});

describe('What each page keeps behind More', () => {
  const afterMore = (source: string, marker: string) => {
    // The page's main More is its last one (Quick Start renders its own earlier branch).
    const more = source.lastIndexOf('<MoreDisclosure');
    const at = source.lastIndexOf(marker);
    expect(more).toBeGreaterThan(-1);
    expect(at).toBeGreaterThan(-1);
    return at > more;
  };

  test('AI Providers: key list up front, the full table with search and sort under More', () => {
    const source = read('src/features/providers/ProvidersWorkbenchPage.tsx');
    expect(afterMore(source, '<ProviderKeyList')).toBe(false);
    expect(afterMore(source, '<ProviderResourcePanel')).toBe(true);
    expect(afterMore(source, '<ProviderCategoryList')).toBe(true);
  });

  test('Config: Common and the section tabs up front, the YAML source switch under More', () => {
    const source = read('src/features/config/ConfigPage.tsx');
    expect(afterMore(source, '<ConfigTabs')).toBe(false);
    expect(afterMore(source, '<ConfigSearch')).toBe(false);
    expect(afterMore(source, '<ModeSwitch')).toBe(true);
  });

  test('Logs: the viewer up front, error request logs, download and clear under More', () => {
    const source = read('src/features/logs/LogsPage.tsx');
    expect(afterMore(source, 'onScroll={handleLogScroll}')).toBe(false);
    expect(afterMore(source, 'className={styles.errorCard}')).toBe(true);
    expect(afterMore(source, 'onClick={downloadLogs}')).toBe(true);
    expect(afterMore(source, 'onClick={clearLogs}')).toBe(true);
    // Error logs are read while More is open, not on a separate tab.
    expect(source).toContain('if (!moreOpen) return;');
  });

  test('Plugins and Plugin Store: search comes before the list; runtime facts under More', () => {
    for (const [path, list] of [
      ['src/features/plugins/PluginsPage.tsx', 'styles.pluginList'],
      ['src/features/plugins/PluginStorePage.tsx', 'styles.cardGrid}'],
    ] as const) {
      const source = read(path);
      const render = source.slice(source.lastIndexOf('return (\n    <div'));
      const search = render.indexOf(
        path.endsWith('PluginsPage.tsx') ? '{toolbar}' : 'type="search"'
      );
      expect(search).toBeGreaterThan(-1);
      expect(search).toBeLessThan(render.indexOf(list));
      expect(afterMore(source, 'styles.statusPathValue')).toBe(true);
      expect(source).not.toContain('forcedOpen={searching}');
    }
  });
});
