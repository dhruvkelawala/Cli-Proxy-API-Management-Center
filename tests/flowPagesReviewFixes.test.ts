import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import { StepFlow } from '@/components/flow';
import { LegacyBackendError } from '@/services/api/legacyBackendProbe';
import { isConnectionError, resolveLoginBase, startsWithCustomBase } from '@/pages/loginConnection';
import { inertOutside, type InertNode } from '@/features/logs/model/logFullscreen';
import { describeLogs } from '@/features/logs/model/logsHeadline';
import { describeProviders, keyEntriesOf } from '@/features/providers/providersHeadline';
import { describeSystem, displayVersion } from '@/pages/systemHeadline';
import { LOGIN_STORAGE_KEYS, requestClearLoginData } from '@/pages/clearLoginData';
import type { ProviderBrand } from '@/features/providers/types';

let previous = 'en';
beforeAll(async () => {
  previous = i18n.language;
  await i18n.changeLanguage('en');
});
afterAll(async () => {
  await i18n.changeLanguage(previous);
});

type Copy = { key: string; values?: Record<string, unknown> };
const en = (copy: Copy | null) => (copy ? i18n.t(copy.key, { ...copy.values, lng: 'en' }) : '');

describe('Login connects to the address it shows', () => {
  const detectedBase = 'http://127.0.0.1:18952';

  test('the custom address is used only while custom is ticked and filled in', () => {
    expect(resolveLoginBase({ custom: true, customBase: '127.0.0.1:18951/', detectedBase })).toBe(
      'http://127.0.0.1:18951'
    );
    // Unticked: the typed address is ignored, the page's own address is used.
    expect(resolveLoginBase({ custom: false, customBase: 'http://other:8317', detectedBase })).toBe(
      detectedBase
    );
    expect(resolveLoginBase({ custom: true, customBase: '  ', detectedBase })).toBe(detectedBase);
  });

  test("a saved address other than the page's own starts ticked", () => {
    expect(startsWithCustomBase('http://127.0.0.1:18951', detectedBase)).toBe(true);
    expect(startsWithCustomBase('http://127.0.0.1:18952/', detectedBase)).toBe(false);
    expect(startsWithCustomBase('', detectedBase)).toBe(false);
    expect(startsWithCustomBase(null, detectedBase)).toBe(false);
  });

  test('wrong-address errors open the connection details; a bad key does not', () => {
    expect(isConnectionError({ status: 404 })).toBe(true);
    expect(isConnectionError({ code: 'ERR_NETWORK', message: 'Network Error' })).toBe(true);
    expect(isConnectionError(new Error('Network Error'))).toBe(true);
    expect(isConnectionError(new LegacyBackendError())).toBe(true);
    expect(isConnectionError({ status: 401 })).toBe(false);
    expect(isConnectionError({ status: 500 })).toBe(false);
  });
});

describe('Logs fullscreen makes the rest of the page inert', () => {
  class FakeNode implements InertNode {
    parentElement: FakeNode | null = null;
    children: FakeNode[] = [];
    attributes = new Map<string, string>();
    constructor(
      readonly name: string,
      public className = ''
    ) {}
    add(...nodes: FakeNode[]) {
      nodes.forEach((node) => {
        node.parentElement = this;
        this.children.push(node);
      });
      return this;
    }
    getAttribute(name: string) {
      return this.attributes.get(name) ?? null;
    }
    hasAttribute(name: string) {
      return this.attributes.has(name);
    }
    setAttribute(name: string, value: string) {
      this.attributes.set(name, value);
    }
    removeAttribute(name: string) {
      this.attributes.delete(name);
    }
  }

  test('siblings up the tree become inert and are restored; toasts and dialogs are left alone', () => {
    const overlay = new FakeNode('overlay');
    const header = new FakeNode('header');
    const more = new FakeNode('more');
    const page = new FakeNode('page').add(header, overlay, more);
    const sidebar = new FakeNode('sidebar');
    const toasts = new FakeNode('toasts', 'notification-container');
    const alreadyInert = new FakeNode('already');
    alreadyInert.setAttribute('inert', '');
    new FakeNode('body').add(sidebar, page, toasts, alreadyInert);

    const restore = inertOutside(overlay);
    expect([header, more, sidebar].every((node) => node.hasAttribute('inert'))).toBe(true);
    expect(overlay.hasAttribute('inert')).toBe(false);
    expect(page.hasAttribute('inert')).toBe(false);
    expect(toasts.hasAttribute('inert')).toBe(false);

    restore();
    expect([header, more, sidebar].some((node) => node.hasAttribute('inert'))).toBe(false);
    // Something that was inert before stays inert.
    expect(alreadyInert.hasAttribute('inert')).toBe(true);
  });
});

describe('Logs sentence while the logging setting is unknown', () => {
  const base = {
    connected: true,
    fileLoggingOff: true,
    fileOffReason: 'config' as const,
    failed: false,
    loading: false,
    live: false,
    lineCount: 0,
    lastRead: '',
  };

  test('checking and unreadable are not reported as "off"', () => {
    expect(en(describeLogs({ ...base, setting: 'checking' }).title)).toBe(
      'Checking whether logging to file is on…'
    );
    const failed = describeLogs({ ...base, setting: 'failed' });
    expect(en(failed.title)).toBe("Couldn't read the logging setting.");
    expect(failed.linkToSetting).toBe(false);
    expect(en(describeLogs({ ...base, setting: 'known' }).title)).toBe('Logging to file is off.');
  });

  test('a server refusal is "off" whatever the setting says, and the reason is said once', () => {
    const sentence = describeLogs({ ...base, fileOffReason: 'server', setting: 'checking' });
    expect(en(sentence.title)).toBe('Logging to file is off.');
    expect(sentence.subtitle?.key).toBe('logs.file_logging_required_desc');
  });

  test('the read error is the subtitle', () => {
    const sentence = describeLogs({
      ...base,
      fileLoggingOff: false,
      failed: true,
      errorMessage: 'HTTP 500.',
    });
    expect(en(sentence.subtitle)).toBe('HTTP 500. Reading retries on its own; refresh to try now.');
  });

  test('the page does not announce the live counts', async () => {
    const page = await Bun.file('src/features/logs/LogsPage.tsx').text();
    expect(page).toContain('live={false}');
  });
});

describe('Provider keys are counted as keys', () => {
  const nameOf = (brand: ProviderBrand) => brand;
  const join = (names: string[]) => names.join(', ');

  test('an OpenAI-compatible provider counts each of its keys; sponsors are not keys', () => {
    expect(
      keyEntriesOf({ disabled: false, brand: 'openaiCompatibility', apiKeyEntryCount: 3 })
    ).toBe(3);
    expect(keyEntriesOf({ disabled: false, brand: 'fennoAI' })).toBe(0);
    expect(keyEntriesOf({ disabled: false, brand: 'claude' })).toBe(1);
    const sentence = describeProviders({
      groups: [
        {
          id: 'openaiCompatibility',
          resources: [{ disabled: true, brand: 'openaiCompatibility', apiKeyEntryCount: 3 }],
        },
        { id: 'gemini', resources: [{ disabled: false, brand: 'gemini' }] },
        { id: 'fennoAI', resources: [{ disabled: false, brand: 'fennoAI' }] },
      ],
      loading: false,
      failed: false,
      nameOf,
      join,
    });
    expect(en(sentence.title)).toBe('4 provider keys configured.');
    expect(en(sentence.subtitle)).toBe(
      'openaiCompatibility, gemini, fennoAI. 3 keys are turned off.'
    );
  });

  test('only sponsor set-ups is not "no API keys" and not "N keys"', () => {
    const sentence = describeProviders({
      groups: [{ id: 'qiniuCloud', resources: [{ disabled: false, brand: 'qiniuCloud' }] }],
      loading: false,
      failed: false,
      nameOf,
      join,
    });
    expect(en(sentence.title)).toBe('1 quick-fill provider set up.');
  });
});

describe('Management Center version names', () => {
  test('"v" is added only to versions that start with a digit', () => {
    expect(displayVersion('8.1.0')).toBe('v8.1.0');
    expect(displayVersion('v8.1.0')).toBe('v8.1.0');
    expect(displayVersion('dev')).toBe('dev');
    expect(
      en(
        describeSystem({
          connection: 'connected',
          serverVersion: 'dev',
          uiVersion: 'dev',
          latest: null,
        }).title
      )
    ).toBe('Connected to CLI Proxy API dev.');
  });

  test('an update-check result is dropped when the connection changes', async () => {
    const page = await Bun.file('src/pages/SystemPage.tsx').text();
    expect(page).toMatch(/setLatestCheck\(null\);\s*\}, \[auth\.apiBase, auth\.managementKey\]\)/);
  });
});

describe('Clear login data', () => {
  test('asks first; signs out and forgets the connection only on confirmation', () => {
    const calls: string[] = [];
    const removed: string[] = [];
    let confirmed: (() => void) | null = null;
    let variant = '';
    requestClearLoginData({
      t: ((key: string) => key) as never,
      confirm: (options) => {
        variant = options.variant;
        confirmed = options.onConfirm;
      },
      logout: () => calls.push('logout'),
      storage: { removeItem: (key: string) => removed.push(key) },
      notify: (message) => calls.push(message),
    });
    expect(variant).toBe('danger');
    expect(calls).toEqual([]);
    expect(removed).toEqual([]);
    expect(confirmed).not.toBeNull();
    confirmed!();
    expect(calls).toEqual(['logout', 'notification.login_storage_cleared']);
    expect(removed).toEqual([...LOGIN_STORAGE_KEYS]);
  });
});

describe('StepFlow says a failed step in words', () => {
  test('the failed step carries text, a finished one a spoken "done"', () => {
    const markup = renderToStaticMarkup(
      createElement(StepFlow, {
        steps: [
          { id: 'a', label: 'Browser' },
          { id: 'b', label: 'Sign in' },
          { id: 'c', label: 'Account added' },
        ],
        current: 1,
        state: 'failed',
        label: 'Steps',
        failedNote: "Didn't finish",
        doneNote: 'done',
      })
    );
    expect(markup).toContain('Didn&#x27;t finish');
    expect(markup).toContain(', done');
  });
});

describe('Plural forms keep every placeholder', () => {
  test("each _one/_few/_many form has the _other form's placeholders (count may be implied in _one)", async () => {
    const flatten = (value: unknown, prefix = ''): [string, string][] =>
      value && typeof value === 'object'
        ? Object.entries(value).flatMap(([key, child]) =>
            flatten(child, prefix ? `${prefix}.${key}` : key)
          )
        : [[prefix, String(value)]];
    const tokens = (text: string) => new Set(text.match(/\{\{[^}]+\}\}/g) ?? []);
    const problems: string[] = [];
    for (const locale of ['en', 'zh-CN', 'zh-TW', 'ru', 'vi']) {
      const map = new Map(flatten(await Bun.file(`src/i18n/locales/${locale}.json`).json()));
      for (const [key, other] of map) {
        if (!key.endsWith('_other')) continue;
        const base = key.slice(0, -'_other'.length);
        for (const form of ['_one', '_few', '_many']) {
          const text = map.get(base + form);
          if (text === undefined) continue;
          // Russian _one also covers 21, 31…, so it must show the number too.
          const implied = form === '_one' && locale !== 'ru' ? ['{{count}}'] : [];
          const have = tokens(text);
          const missing = [...tokens(other)].filter((t) => !have.has(t) && !implied.includes(t));
          if (missing.length) problems.push(`${locale} ${base}${form}: ${missing.join(' ')}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});

describe('Orphaned copy is gone', () => {
  test('keys the redesign stopped using are removed from every locale', async () => {
    const gone = [
      ['config_management', 'meta_fields'],
      ['config_management', 'meta_synced'],
      ['login', 'connection_current'],
      ['login', 'subtitle'],
      ['logs', 'title'],
      ['oauth_excluded', 'editor_description'],
      ['oauth_model_alias', 'editor_description'],
      ['plugin_management', 'description'],
      ['providersPage', 'header'],
      ['system_info', 'title'],
      ['system_info', 'about_title'],
      ['system_info', 'quick_links_desc'],
    ];
    for (const locale of ['en', 'zh-CN', 'zh-TW', 'ru', 'vi']) {
      const data = await Bun.file(`src/i18n/locales/${locale}.json`).json();
      for (const [section, key] of gone) expect(data[section][key]).toBeUndefined();
      expect(data.login.show_key).toBeTruthy();
      expect(data.login.hide_key).toBeTruthy();
      expect(data.notification.load_failed).toBeTruthy();
    }
  });
});
