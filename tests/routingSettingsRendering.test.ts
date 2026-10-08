import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import {
  RoutingBandView,
  type RoutingBandViewProps,
} from '@/features/config/routing/SharedRoutingBand';
import {
  RoutingTuningPanel,
  type RoutingTuningPanelProps,
} from '@/features/config/routing/RoutingTuningPanel';
import { describeAccountSaveStatus } from '@/features/config/routing/routingStatus';
import type { RoutingSettingsValues } from '@/features/config/routing/routingSettingsState';
import type { AuthFileItem } from '@/types';

const languages = ['en', 'zh-CN', 'zh-TW', 'ru', 'vi'] as const;
const translations = i18n.cloneInstance({ lng: 'en' });
const render = (element: ReturnType<typeof createElement>, i18nInstance = translations) =>
  renderToStaticMarkup(createElement(I18nextProvider, { i18n: i18nInstance }, element));
const escapeText = (value: string) =>
  renderToStaticMarkup(createElement('span', null, value)).slice(6, -7);

const values = (overrides: Partial<RoutingSettingsValues> = {}): RoutingSettingsValues => ({
  strategy: 'round-robin',
  sessionAffinity: true,
  sessionAffinityTtl: '1h',
  ...overrides,
});

const inputTag = (markup: string, attribute: string): string =>
  markup.match(new RegExp(`<input[^>]*${attribute}[^>]*>`))?.[0] ?? '';
const checkedStrategies = (markup: string): string[] =>
  Array.from(markup.matchAll(/<input[^>]*type="radio"[^>]*>/g))
    .map(([tag]) => tag)
    .filter((tag) => tag.includes('checked=""'))
    .map((tag) => tag.match(/value="([^"]+)"/)?.[1] ?? '');

const noop = () => {};
const band = (overrides: Partial<RoutingBandViewProps> = {}, i18nInstance = translations) => {
  const current = overrides.values ?? values();
  return render(
    createElement(RoutingBandView, {
      values: current,
      saved: current,
      dirty: false,
      ttlInvalid: false,
      save: { phase: 'idle' },
      onChange: noop,
      onSave: noop,
      onDiscard: noop,
      onOpenTuning: noop,
      ...overrides,
    }),
    i18nInstance
  );
};

const file = (name: string, overrides: Partial<AuthFileItem> = {}): AuthFileItem => ({
  name,
  type: 'claude',
  email: `${name}@example.test`,
  status: 'active',
  ...overrides,
});

const panel = (overrides: Partial<RoutingTuningPanelProps> = {}, i18nInstance = translations) =>
  render(
    createElement(RoutingTuningPanel, {
      strategy: 'round-robin',
      sessionAffinity: { enabled: true, ttl: '1h' },
      files: [file('claude-a', { weight: 1 }), file('claude-b', { weight: 3 })],
      loading: false,
      error: null,
      edits: {},
      errors: {},
      save: { phase: 'idle', outcome: null, savedCount: 0, failures: [] },
      onChange: noop,
      onRetry: noop,
      ...overrides,
    }),
    i18nInstance
  );

describe('shared routing band', () => {
  test('shows friendly strategy labels with the backend names underneath', () => {
    const markup = band();
    for (const label of ['Rotate evenly', 'Weighted split', 'Concentrate on one']) {
      expect(markup).toContain(label);
    }
    for (const name of ['round-robin', 'weighted-round-robin', 'fill-first']) {
      expect(markup).toContain(`>${name}</span>`);
      expect(markup).toContain(`value="${name}"`);
    }
  });

  test.each([
    ['round-robin', 'new assignments cycle through the eligible accounts'],
    ['weighted-round-robin', 'in proportion to each account weight'],
    ['fill-first', 'first eligible account in internal ID order'],
  ] as const)('explains %s in one line from the shared presentation keys', (strategy, snippet) => {
    const markup = band({ values: values({ strategy }) });
    expect(markup).toContain(snippet);
    expect(checkedStrategies(markup)).toEqual([strategy]);
  });

  test('a saved fill-first strategy loads as fill-first, not the recommended default', () => {
    const markup = band({ values: values({ strategy: 'fill-first' }) });
    expect(checkedStrategies(markup)).toEqual(['fill-first']);
    expect(markup).toContain('Matches the saved gateway configuration');
  });

  test('names the saved strategy while a different one is selected and unsaved', () => {
    const markup = band({
      values: values({ strategy: 'weighted-round-robin' }),
      saved: values({ strategy: 'fill-first' }),
      dirty: true,
    });
    expect(markup).toContain('Saved: Concentrate on one');
    expect(markup).toContain('Unsaved changes');
  });

  test('states the global scope beside the save action', () => {
    const markup = band();
    expect(markup).toContain(
      'Global · affects all Automatic clients on the shared gateway (both Macs)'
    );
    expect(markup).toContain('Save shared settings');
  });

  test('names the Automatic client count when it is given', () => {
    expect(band({ automaticClientCount: 3 })).toContain(
      'Global · affects 3 Automatic clients on the shared gateway (both Macs)'
    );
    expect(band({ automaticClientCount: 1 })).toContain(
      'Global · affects 1 Automatic client on the shared gateway (both Macs)'
    );
    expect(band({ automaticClientCount: 3 })).not.toContain('affects all Automatic clients');
  });

  test('tells the reader that Only profiles ignore these settings and recommends without changing', () => {
    const markup = band();
    expect(markup).toContain('Clients set to Only one account ignore these settings.');
    expect(markup).toContain('Recommended for coding');
    expect(markup).toContain('never changed automatically');
  });

  test('keeps conversations toggle and TTL are labelled and the TTL is off with affinity', () => {
    const on = band();
    expect(on).toContain('Keep conversations on one account');
    expect(on).toContain('aria-label="How long a conversation stays on its account"');
    expect(on).toContain('value="1h"');
    const off = band({ values: values({ sessionAffinity: false }) });
    const ttlAttribute = 'aria-label="How long a conversation stays on its account"';
    expect(inputTag(on, ttlAttribute)).not.toContain('disabled');
    expect(inputTag(off, ttlAttribute)).toContain('disabled=""');
  });

  test('shows each save state truthfully', () => {
    expect(band({ save: { phase: 'saving' } })).toContain('Saving to the gateway…');
    expect(band({ save: { phase: 'saved' } })).toContain('Saved to the gateway configuration');
    const failed = band({
      save: { phase: 'failed', message: 'revision conflict' },
      dirty: true,
    });
    expect(failed).toContain('Not saved: revision conflict Your changes are kept.');
    expect(failed).not.toContain('Saved to the gateway configuration');
    expect(band({ ttlInvalid: true, dirty: true })).toContain('Use a duration such as');
  });

  test.each(languages)('renders in %s with real text and no raw keys', (language) => {
    const instance = i18n.cloneInstance({ lng: language });
    const markup = band({ automaticClientCount: 2 }, instance);
    expect(markup).not.toContain('config_management.routing_settings');
    expect(markup).not.toContain('routing_presentation');
    expect(markup).toContain(
      escapeText(instance.t('config_management.routing_settings.strategy.fill_first'))
    );
    expect(markup).toContain(
      escapeText(instance.t('config_management.routing_settings.scope_count', { count: 2 }))
    );
  });
});

describe('priorities and weights panel', () => {
  test('dims weights but keeps them editable when the strategy is not Weighted split', () => {
    const markup = panel({ strategy: 'round-robin' });
    expect(markup.match(/data-inactive="true"/g)).toHaveLength(2);
    expect(markup).toContain('Used only by Weighted split');
    expect(markup).toContain('Weights are not used by the saved or selected strategy');
    expect(markup).not.toContain('disabled');
  });

  test('weights are active under Weighted split', () => {
    const markup = panel({ strategy: 'weighted-round-robin' });
    expect(markup).not.toContain('data-inactive');
    expect(markup).not.toContain('Used only by Weighted split');
    expect(markup).toContain('Default 1 · max 1,000,000');
  });

  test('shows priority as a raw number with the hint, preserving arbitrary values', () => {
    const markup = panel({ files: [file('claude-a', { priority: 250 }), file('claude-b')] });
    expect(markup).toContain('value="250"');
    expect(markup).toContain('Higher wins new assignments');
    expect(markup).toContain('aria-label="Priority for claude-a@example.test"');
    expect(markup).toContain('aria-label="Weight for claude-a@example.test"');
  });

  test('labels the share bar illustrative, never actual traffic', () => {
    const markup = panel();
    expect(markup).toContain('Illustrative share of new assignments under Rotate evenly');
    expect(markup).toContain('not actual traffic, tokens or cost');
    expect(markup).toContain('role="img"');
    expect(markup).toContain('50%');
    expect(markup).toContain('Illustrative share of new assignments: claude-a@example.test 50%');
  });

  test('separates unavailable, disabled, lower-priority and non-positive weight reasons', () => {
    const markup = panel({
      strategy: 'weighted-round-robin',
      files: [
        file('top', { priority: 10, weight: 2 }),
        file('zero', { priority: 10, weight: 0 }),
        file('low', { priority: 1, weight: 1 }),
        file('off', { disabled: true, status: 'disabled' }),
        file('cooling', { status: 'error', unavailable: true, priority: 10 }),
      ],
    });
    const reasons = (reason: string) =>
      (markup.match(new RegExp(`data-reason="${reason}"`, 'g')) ?? []).length;
    expect(reasons('participating')).toBe(1);
    expect(reasons('non-positive-weight')).toBe(1);
    expect(reasons('lower-priority')).toBe(1);
    expect(reasons('disabled')).toBe(1);
    expect(reasons('unavailable')).toBe(1);
    for (const label of ['Weight 0 or below', 'Lower priority', 'Disabled', 'Unavailable']) {
      expect(markup).toContain(label);
    }
    expect(markup).toContain('The account is not disabled.');
  });

  test('unknown availability gets the amber ring and a striped bar segment', () => {
    const markup = panel({
      files: [file('known'), file('mystery', { status: undefined })],
    });
    expect(markup).toContain('data-tone="unknown"');
    expect(markup).toContain('data-striped="true"');
    expect(markup).toContain('Availability unknown');
    expect(markup).toContain('striped = availability unknown');
    expect(markup.match(/data-striped="true"/g)).toHaveLength(1);
  });

  test('groups accounts per provider with a separate bar for each pool', () => {
    const markup = panel({
      files: [file('c1'), file('x1', { type: 'codex' }), file('c2')],
    });
    expect(markup.match(/role="img"/g)).toHaveLength(2);
    expect(markup).toContain('>Claude</h3>');
    expect(markup).toContain('>Codex</h3>');
  });

  test('shows draft values and an unsaved marker, with field errors', () => {
    const markup = panel({
      files: [file('claude-a', { priority: 1 })],
      edits: { 'claude-a': { priority: '1.5', weight: '9' } },
      errors: { 'claude-a': { priority: 'integer' } },
    });
    expect(markup).toContain('value="1.5"');
    expect(markup).toContain('value="9"');
    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toContain('Whole number');
  });

  test('retained failed drafts are shown with the backend message', () => {
    const markup = panel({
      files: [file('claude-a')],
      edits: { 'claude-a': { priority: '5' } },
      save: {
        phase: 'done',
        outcome: 'failed',
        savedCount: 0,
        failures: [{ name: 'claude-a', message: 'credential is read-only' }],
      },
    });
    expect(markup).toContain('value="5"');
    expect(markup).toContain('credential is read-only');
    expect(markup).toContain('data-dirty="true"');
  });

  test('loading, error and empty states', () => {
    expect(panel({ files: null })).toContain('Loading accounts…');
    expect(panel({ files: null, error: 'timeout' })).toContain(
      'Accounts could not be loaded: timeout'
    );
    expect(panel({ files: [] })).toContain('No credential accounts yet');
  });

  test.each(languages)('renders in %s without raw keys', (language) => {
    const instance = i18n.cloneInstance({ lng: language });
    const markup = panel({ files: [file('a', { status: undefined }), file('b')] }, instance);
    expect(markup).not.toContain('config_management.routing_');
    expect(markup).toContain(
      escapeText(instance.t('config_management.routing_settings.sheet.priority_hint'))
    );
  });
});

describe('account save status line', () => {
  const t = translations.t.bind(translations);
  const state = (save: Partial<RoutingTuningPanelProps['save']>, extra = {}) => ({
    save: { phase: 'idle' as const, outcome: null, savedCount: 0, failures: [], ...save },
    dirtyNames: [] as string[],
    hasErrors: false,
    ...extra,
  });

  test('never claims success for a partial or failed save', () => {
    const partial = describeAccountSaveStatus(
      t,
      state({
        phase: 'done',
        outcome: 'partial',
        savedCount: 1,
        failures: [{ name: 'b.json', label: 'Team seat', message: '' }],
      })
    );
    expect(partial.tone).toBe('failed');
    expect(partial.text).toContain('Saved 1 of 2 accounts');
    expect(partial.text).toContain('Team seat');
    expect(partial.text).not.toContain('b.json');
    const failed = describeAccountSaveStatus(
      t,
      state({ phase: 'done', outcome: 'failed', failures: [{ name: 'a.json', message: '' }] })
    );
    expect(failed.tone).toBe('failed');
    expect(failed.text).toContain('No accounts were saved');
  });

  test('reports saved only when every attempted account was written and nothing is pending', () => {
    expect(
      describeAccountSaveStatus(t, state({ phase: 'done', outcome: 'saved', savedCount: 2 }))
    ).toEqual({ text: 'Saved 2 accounts', tone: 'saved' });
    expect(
      describeAccountSaveStatus(
        t,
        state({ phase: 'done', outcome: 'saved', savedCount: 2 }, { dirtyNames: ['c.json'] })
      ).tone
    ).toBe('dirty');
    expect(describeAccountSaveStatus(t, state({})).tone).toBe('clean');
    expect(describeAccountSaveStatus(t, state({ phase: 'saving' })).tone).toBe('saving');
  });
});
