import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import i18n from '@/i18n';
import {
  describeProviders,
  describeQuickStart,
  splitProviderGroups,
} from '@/features/providers/providersHeadline';
import { describeConfig } from '@/features/config/configHeadline';
import { resolveStatus, type ConfigStatusInput } from '@/features/config/uiState';
import { describeLogs } from '@/features/logs/model/logsHeadline';
import { attemptNeedsUser, describeOAuth, splitOAuthProviders, stepOf } from '@/pages/oauthFlow';
import { compareVersions, describeSystem } from '@/pages/systemHeadline';
import { describePlugins, describeStore } from '@/features/plugins/pluginsHeadline';
import {
  countCompleteAliases,
  describeModelRuleEditor,
} from '@/features/authFiles/modelRulesHeadline';
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
const names: Record<string, string> = { gemini: 'Gemini', claude: 'Claude', codex: 'Codex' };
const nameOf = (brand: ProviderBrand) => names[brand] ?? brand;
const join = (list: string[]) => list.join(' and ');
const keys = (...disabled: boolean[]) => disabled.map((value) => ({ disabled: value }));

describe('AI Providers sentence', () => {
  test('says there are no keys yet, and only then', () => {
    const empty = describeProviders({
      groups: [
        { id: 'gemini', resources: [] },
        { id: 'claude', resources: [] },
      ],
      loading: false,
      failed: false,
      nameOf,
      join,
    });
    expect(en(empty.title)).toBe('No API keys yet.');
    expect(en(empty.subtitle)).toContain('Add a key from any provider');
  });

  test('counts keys and names only the providers that have them', () => {
    const sentence = describeProviders({
      groups: [
        { id: 'gemini', resources: keys(false, false) },
        { id: 'codex', resources: [] },
        { id: 'claude', resources: keys(false) },
      ],
      loading: false,
      failed: false,
      nameOf,
      join,
    });
    expect(en(sentence.title)).toBe('3 provider keys configured.');
    expect(en(sentence.subtitle)).toBe('Gemini and Claude. All of them are on.');
    expect(sentence.tone).toBe('ok');
  });

  test('says how many keys are off, and warns when every key is off', () => {
    const some = describeProviders({
      groups: [{ id: 'gemini', resources: keys(false, true) }],
      loading: false,
      failed: false,
      nameOf,
      join,
    });
    expect(en(some.title)).toBe('2 provider keys configured.');
    expect(en(some.subtitle)).toBe('Gemini. 1 key is turned off.');
    const all = describeProviders({
      groups: [{ id: 'claude', resources: keys(true) }],
      loading: false,
      failed: false,
      nameOf,
      join,
    });
    expect(en(all.title)).toBe('1 provider key configured.');
    expect(all.tone).toBe('warn');
  });

  test('loading and failure before the first read do not claim there are no keys', () => {
    expect(
      en(describeProviders({ groups: null, loading: true, failed: false, nameOf, join }).title)
    ).toBe('Reading your provider keys…');
    expect(
      en(describeProviders({ groups: null, loading: false, failed: true, nameOf, join }).title)
    ).toBe("Your provider keys couldn't be read.");
  });

  test('providers with keys are up front, the rest go behind More, order kept', () => {
    const { configured, empty } = splitProviderGroups([
      { id: 'kimi', resources: [] },
      { id: 'gemini', resources: keys(false) },
      { id: 'codex', resources: [] },
      { id: 'claude', resources: keys(true) },
    ]);
    expect(configured.map((group) => group.id)).toEqual(['gemini', 'claude']);
    expect(empty.map((group) => group.id)).toEqual(['kimi', 'codex']);
  });

  test('Quick Start says whether the sponsor is set up, on or off', () => {
    const base = { name: 'APIKEY.FUN', loading: false, failed: false };
    expect(en(describeQuickStart({ ...base, resource: null }).title)).toBe(
      "APIKEY.FUN isn't set up yet."
    );
    expect(en(describeQuickStart({ ...base, resource: { disabled: false } }).title)).toBe(
      'APIKEY.FUN is set up.'
    );
    expect(en(describeQuickStart({ ...base, resource: { disabled: true } }).title)).toBe(
      'APIKEY.FUN is turned off.'
    );
  });
});

describe('Config sentence', () => {
  const input = (overrides: Partial<ConfigStatusInput> = {}): ConfigStatusInput => ({
    disconnected: false,
    loading: false,
    loadFailed: false,
    yamlError: false,
    validationBlocked: false,
    saving: false,
    dirty: false,
    ...overrides,
  });
  const say = (status: Partial<ConfigStatusInput>, extra = {}) =>
    describeConfig({
      status: resolveStatus(input(status)),
      dirtyCount: 0,
      sourceDirty: false,
      errorCount: 0,
      fieldCount: 95,
      sectionCount: 7,
      ...extra,
    });

  test('in sync says so and how much there is', () => {
    const sentence = say({});
    expect(en(sentence.title)).toBe('Your gateway settings are in sync.');
    expect(en(sentence.subtitle)).toBe(
      '95 settings in 7 sections. Common ones are below; search finds any of them.'
    );
  });

  test('unsaved changes are counted; a YAML edit wins over the visual count', () => {
    expect(en(say({ dirty: true }, { dirtyCount: 3 }).title)).toBe('You have 3 unsaved changes.');
    expect(en(say({ dirty: true }, { dirtyCount: 1 }).title)).toBe('You have 1 unsaved change.');
    expect(en(say({ dirty: true }, { dirtyCount: 3, sourceDirty: true }).title)).toBe(
      'You have unsaved edits in the YAML source.'
    );
  });

  test('blocking states come first', () => {
    expect(en(say({ disconnected: true, dirty: true }).title)).toBe(
      'Not connected to the gateway.'
    );
    expect(en(say({ validationBlocked: true, dirty: true }, { errorCount: 2 }).title)).toBe(
      '2 settings need attention before saving.'
    );
    expect(en(say({ dirty: true }, { recoveryRequired: true }).title)).toBe(
      'Your last save was only partly applied.'
    );
  });
});

describe('Logs sentence', () => {
  const base = {
    connected: true,
    fileLoggingOff: false,
    failed: false,
    loading: false,
    live: false,
    lineCount: 9,
    lastRead: '2:41 PM',
  };

  test('file logging off is said plainly and offers the setting', () => {
    const sentence = describeLogs({ ...base, fileLoggingOff: true });
    expect(en(sentence.title)).toBe('Logging to file is off.');
    expect(sentence.linkToSetting).toBe(true);
  });

  test('live and paused reading', () => {
    const live = describeLogs({ ...base, live: true });
    expect(en(live.title)).toBe('Logs are coming in live.');
    expect(en(live.subtitle)).toBe('9 lines loaded · last read at 2:41 PM.');
    const paused = describeLogs({ ...base, lastRead: '' });
    expect(en(paused.title)).toBe('Log reading is paused.');
    expect(en(paused.subtitle)).toBe('9 lines loaded. Turn on live reading to follow new lines.');
    expect(paused.linkToSetting).toBe(false);
  });

  test('disconnected wins over everything', () => {
    expect(en(describeLogs({ ...base, connected: false, fileLoggingOff: true }).title)).toBe(
      'Not connected to the gateway.'
    );
  });
});

describe('OAuth sentence and steps', () => {
  const nameOfProvider = (id: string) => ({ anthropic: 'Claude', codex: 'Codex' })[id] ?? id;

  test('idle asks to sign in a new account', () => {
    const sentence = describeOAuth({}, nameOfProvider);
    expect(en(sentence.title)).toBe('Sign in a new account.');
    expect(sentence.step).toBe('idle');
  });

  test('a sign-in moves browser → sign in → account added', () => {
    expect(stepOf({ polling: true })).toBe('browser');
    expect(stepOf({ url: 'https://x', status: 'waiting', polling: true })).toBe('signin');
    expect(stepOf({ status: 'success' })).toBe('added');
    expect(stepOf({ status: 'error', error: 'denied' } as never)).toBe('failed');
    expect(
      en(describeOAuth({ anthropic: { url: 'u', status: 'waiting' } }, nameOfProvider).title)
    ).toBe('Finish signing in to Claude in your browser.');
  });

  test('with several sign-ins, the decisive one is described', () => {
    const sentence = describeOAuth(
      {
        codex: { url: 'u', status: 'waiting' },
        anthropic: { status: 'success' },
      },
      nameOfProvider
    );
    expect(en(sentence.title)).toBe('Claude account added.');
    expect(sentence.provider).toBe('anthropic');
  });

  test('Claude, Codex and Antigravity are up front; the rest are under More', () => {
    const cards = [
      'meta',
      'kimi',
      'kimi-ai',
      'codex',
      'anthropic',
      'antigravity',
      'xai',
      'devin',
      'plug',
    ].map((id) => ({ id }));
    const { primary, other } = splitOAuthProviders(cards);
    expect(primary.map((card) => card.id)).toEqual(['anthropic', 'codex', 'antigravity']);
    expect(other.map((card) => card.id)).toEqual([
      'meta',
      'kimi',
      'kimi-ai',
      'xai',
      'devin',
      'plug',
    ]);
  });

  test('More stays open while a sign-in under it needs the user', () => {
    expect(attemptNeedsUser(undefined)).toBe(false);
    expect(attemptNeedsUser({ status: 'idle' })).toBe(false);
    expect(attemptNeedsUser({ status: 'success' })).toBe(false);
    expect(attemptNeedsUser({ url: 'u' })).toBe(true);
    expect(attemptNeedsUser({ status: 'error' })).toBe(true);
    expect(attemptNeedsUser({ polling: true })).toBe(true);
  });
});

describe('Management Center sentence', () => {
  const base = { connection: 'connected' as const, serverVersion: '8.1.0', uiVersion: 'v1.2.3' };

  test('connected names the gateway version; the UI version is the quiet line', () => {
    const sentence = describeSystem({ ...base, latest: null });
    expect(en(sentence.title)).toBe('Connected to CLI Proxy API v8.1.0.');
    expect(en(sentence.subtitle)).toBe('This Management UI is v1.2.3.');
  });

  test('a newer release changes the sentence once checked', () => {
    const latest = { latest: 'v8.2.0', comparison: compareVersions('v8.2.0', '8.1.0') };
    expect(latest.comparison).toBe(1);
    expect(en(describeSystem({ ...base, latest }).title)).toBe(
      'CLI Proxy API v8.2.0 is available.'
    );
    const same = { latest: '8.1.0', comparison: compareVersions('8.1.0', 'v8.1.0') };
    expect(en(describeSystem({ ...base, latest: same }).title)).toBe(
      "You're on the latest CLI Proxy API, v8.1.0."
    );
  });

  test('not connected is said first', () => {
    expect(en(describeSystem({ ...base, connection: 'disconnected', latest: null }).title)).toBe(
      'Not connected to the gateway.'
    );
  });
});

describe('Plugins and Plugin Store sentences', () => {
  test('plugins: off, none, all running, some running', () => {
    const base = { loaded: true, failed: false, pluginsEnabled: true, total: 3, running: 3 };
    expect(en(describePlugins({ ...base, pluginsEnabled: false }).title)).toBe(
      'Plugins are turned off.'
    );
    expect(en(describePlugins({ ...base, total: 0, running: 0 }).title)).toBe(
      'No plugins installed.'
    );
    expect(en(describePlugins(base).title)).toBe('All 3 plugins are running.');
    expect(en(describePlugins({ ...base, running: 1 }).title)).toBe('1 of 3 plugins are running.');
  });

  test('store: updates come first, then what is available', () => {
    const base = { loaded: true, failed: false, total: 2, installed: 1, updates: 0 };
    expect(en(describeStore(base).title)).toBe('2 plugins available.');
    expect(en(describeStore(base).subtitle)).toBe('1 of them is installed.');
    expect(en(describeStore({ ...base, installed: 0 }).subtitle)).toBe(
      'None of them are installed yet.'
    );
    expect(en(describeStore({ ...base, updates: 1 }).title)).toBe('1 plugin update is ready.');
  });
});

describe('Model rule editors', () => {
  test('ask for a provider first, then count the rules', () => {
    expect(
      en(describeModelRuleEditor({ kind: 'excluded', provider: '', count: 0, dirty: false }).title)
    ).toBe('Choose a provider to hide models from.');
    expect(
      en(
        describeModelRuleEditor({ kind: 'excluded', provider: 'Claude', count: 2, dirty: false })
          .title
      )
    ).toBe('2 models hidden from Claude.');
    const dirty = describeModelRuleEditor({
      kind: 'alias',
      provider: 'Codex',
      count: 0,
      dirty: true,
    });
    expect(en(dirty.title)).toBe('No aliases for Codex yet.');
    expect(en(dirty.subtitle)).toContain('Unsaved changes');
  });

  test('only complete alias rows count', () => {
    expect(
      countCompleteAliases([
        { name: 'a', alias: 'b' },
        { name: 'a', alias: ' ' },
        { name: '', alias: 'b' },
      ])
    ).toBe(1);
  });
});

describe('Flow page copy exists in every locale', () => {
  test('each new key has the plural forms its language needs', async () => {
    const flatten = (value: unknown, prefix = ''): string[] =>
      value && typeof value === 'object'
        ? Object.entries(value).flatMap(([key, child]) =>
            flatten(child, prefix ? `${prefix}.${key}` : key)
          )
        : [prefix];
    const english = await Bun.file('src/i18n/locales/en.json').json();
    const flowKeys = flatten(english).filter((key) =>
      /^(providersPage|config_management|logs|auth_login|system_info|plugin_management|plugin_store|oauth_excluded|oauth_model_alias|login)\.flow\./.test(
        key
      )
    );
    expect(flowKeys.length).toBeGreaterThan(150);
    for (const locale of ['zh-CN', 'zh-TW', 'ru', 'vi']) {
      const keys = new Set(flatten(await Bun.file(`src/i18n/locales/${locale}.json`).json()));
      expect(flowKeys.filter((key) => !keys.has(key))).toEqual([]);
      if (locale === 'ru') {
        const plurals = flowKeys.filter((key) => key.endsWith('_other'));
        const missing = plurals.flatMap((key) =>
          ['_few', '_many'].map((form) => key.replace(/_other$/, form)).filter((k) => !keys.has(k))
        );
        expect(missing).toEqual([]);
      }
    }
  });
});
