import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import { ActionMenu } from '@/components/flow';
import { AccountRow } from '@/features/authFiles/components/AccountRow';
import { AccountList } from '@/features/authFiles/components/AccountList';
import {
  presentAccounts,
  summarizeAccounts,
  type AccountPresentation,
} from '@/features/authFiles/accountPresentation';
import {
  accountStatus,
  describeAccounts,
  groupByProvider,
  poolCopy,
} from '@/features/authFiles/accountsView';
import { NO_QUOTA, tightestWindow, type QuotaSummary } from '@/features/quota/quotaSummary';
import { visibleQuotaTabs } from '@/features/quota/logic';
import type { AuthFileItem } from '@/types';

const read = (path: string) => readFileSync(path, 'utf8');
const file = (name: string, extra: Partial<AuthFileItem> = {}): AuthFileItem => ({
  id: name,
  name,
  type: 'claude',
  status: 'active',
  ...extra,
});
const work = file('work.json', { note: 'Work', email: 'work@example.test', priority: 10 });
const personal = file('personal.json', { note: 'Personal', email: 'personal@example.test' });
const codex = file('codex.json', { type: 'codex', note: 'Codex' });
const coolingWork = file('work.json', {
  note: 'Work',
  status: 'error',
  unavailable: true,
  next_retry_after: '2099-01-01T00:00:00Z',
});
const off = file('old.json', { note: 'Old', disabled: true });

const english = (copies: Array<{ key: string; values?: Record<string, unknown> }>) =>
  copies.map((copy) => i18n.t(copy.key, { ...copy.values, lng: 'en' })).join(' ');

describe('Accounts headline', () => {
  const problemsOf = (files: AuthFileItem[]) => {
    const presented = presentAccounts(files);
    return files
      .map((item) => ({ item, availability: presented.get(item)?.availability ?? null }))
      .filter(({ availability }) => availability === 'coolingDown' || availability === 'attention')
      .map(({ item, availability }) => ({ name: String(item.note), availability }));
  };
  const say = (files: AuthFileItem[]) =>
    english(describeAccounts(summarizeAccounts(files), problemsOf(files)));

  test('healthy, one turned off, one cooling, several in trouble, none', () => {
    expect(say([work, personal, codex])).toBe('3 accounts. All working.');
    expect(say([work, personal, off])).toBe('3 accounts. All working; 1 turned off.');
    expect(say([coolingWork, personal, codex])).toBe('3 accounts. Work is cooling down.');
    expect(say([file('a', { status: 'error' }), file('b', { status: 'error' })])).toBe(
      '2 accounts. 2 need attention.'
    );
    expect(say([file('a', { note: 'A', status: 'error' }), work])).toBe(
      '2 accounts. A needs attention.'
    );
    expect(say([])).toBe('No accounts yet.');
    expect(say([off])).toBe('1 account. All turned off.');
  });
});

describe('Accounts rows (CPA-004 semantics)', () => {
  test('status dot tones follow availability; off by choice is never a problem', () => {
    const presented = presentAccounts([coolingWork, personal, off, file('x', { status: 'error' })]);
    const tone = (item: AuthFileItem) => accountStatus(presented.get(item)).tone;
    expect(tone(coolingWork)).toBe('warn');
    expect(tone(personal)).toBe('ok');
    expect(tone(off)).toBe('off');
    expect(accountStatus(presented.get(off)).key).toBe('auth_files.account_state_off');
  });

  test('pool words reuse the card copy', () => {
    const presented = presentAccounts([work, personal]);
    expect(poolCopy(presented.get(work) as AccountPresentation, 'Claude')).toEqual({
      key: 'auth_files.pool_preferred',
      values: { provider: 'Claude' },
    });
  });

  test('groups put Claude first, then Codex, keeping list order inside', () => {
    const groups = groupByProvider([codex, personal, work]);
    expect(groups.map((group) => group.provider)).toEqual(['claude', 'codex']);
    expect(groups[0].files.map((item) => item.name)).toEqual(['personal.json', 'work.json']);
  });

  test('the tiny rail shows whichever window runs out first', () => {
    const quota: QuotaSummary = {
      status: 'ready',
      sessionLeft: 38,
      sessionResetAt: 1,
      weekLeft: 54,
      weekResetAt: 2,
    };
    expect(tightestWindow(quota)).toEqual({ window: 'session', left: 38, resetAt: 1 });
    expect(tightestWindow({ ...quota, sessionLeft: 80 })).toEqual({
      window: 'week',
      left: 54,
      resetAt: 2,
    });
    expect(tightestWindow(NO_QUOTA)).toBeNull();
  });
});

describe('Accounts row markup (CPA-006)', () => {
  let previousLanguage = 'en';
  beforeAll(async () => {
    previousLanguage = i18n.language;
    await i18n.changeLanguage('en');
  });
  afterAll(async () => {
    await i18n.changeLanguage(previousLanguage);
  });

  const presented = presentAccounts([work, personal, codex]);
  const row = (selecting: boolean) =>
    renderToStaticMarkup(
      createElement(AccountRow, {
        file: work,
        presentation: presented.get(work),
        quota: {
          status: 'ready',
          sessionLeft: 38,
          sessionResetAt: null,
          weekLeft: 54,
          weekResetAt: null,
        },
        clientLinks: null,
        selecting,
        selected: false,
        toggleDisabled: false,
        entranceIndex: null,
        onOpen: () => {},
        onToggleStatus: () => {},
        onToggleSelect: () => {},
      })
    );

  test('the name is a real button named after the account; the switch keeps a fixed name', () => {
    const markup = row(false);
    expect(markup).toContain('aria-label="Claude Work: open details"');
    expect(markup).toContain('role="switch"');
    expect(markup).toContain('aria-label="Claude Work"');
    expect(markup).toContain('checked=""');
    expect(markup).toContain('Available');
    expect(markup).toContain('role="meter"');
    expect(markup).toContain('38% · 5-hour');
    expect(markup).not.toMatch(/<div[^>]*onclick/i);
    expect(markup).not.toContain('type="checkbox" aria-label="Select');
  });

  test('selection mode adds a named checkbox', () => {
    expect(row(true)).toContain(i18n.t('auth_files.card_select', { name: 'Claude Work' }));
  });

  test('the list groups by provider under real headings', () => {
    const markup = renderToStaticMarkup(
      createElement(AccountList, {
        files: [work, personal, codex],
        presentations: presented,
        quotaFor: () => NO_QUOTA,
        linksFor: () => null,
        grouped: true,
        selecting: false,
        selectedFiles: new Set<string>(),
        isToggleDisabled: () => false,
        animateEntrance: false,
        onOpen: () => {},
        onToggleStatus: () => {},
        onToggleSelect: () => {},
      })
    );
    expect(markup.match(/<h2/g)).toHaveLength(2);
    expect(markup.indexOf('Claude')).toBeLessThan(markup.indexOf('Codex'));
    expect(markup.match(/role="switch"/g)).toHaveLength(3);
  });

  test('row styles: visible focus ring, controls above the row target, reduced motion', () => {
    const css = read('src/features/authFiles/components/AccountList.module.scss');
    expect(css).toMatch(
      /\.open[\s\S]*&:focus-visible[\s\S]*outline: 2px solid var\(--accent-indigo\)/
    );
    expect(css).toMatch(/\.toggle\s*\{[^}]*z-index: 1/);
    expect(css).toMatch(/prefers-reduced-motion: reduce[\s\S]*animation: none/);
    expect(css.match(/^\s*color:\s*var\(--text-(tertiary|quaternary)\)/gm)).toBeNull();
  });
});

describe('Accounts page structure', () => {
  const page = read('src/features/authFiles/AuthFilesPage.tsx');

  test('rare options, model rules and Delete live under one More; the list is the main view', () => {
    const more = page.slice(page.indexOf('<MoreDisclosure'));
    expect(page.match(/<MoreDisclosure/g)).toHaveLength(1);
    expect(more).toContain('<AuthFilesToolbar');
    expect(more).toContain('<OAuthExcludedCard');
    expect(more).toContain('<OAuthModelAliasCard');
    expect(page.indexOf('<AccountList')).toBeLessThan(page.indexOf('<MoreDisclosure'));
    expect(page).not.toContain('<VaultHeader');
  });

  test('every per-account action stays reachable from the details sheet', () => {
    const summary = read('src/features/authFiles/components/AccountSheetSummary.tsx');
    for (const action of [
      'onShowModels(file)',
      'onManualRefresh(file)',
      'onDownload(file.name)',
      'onDelete(file.name)',
      '<AuthFileCooldownSection',
      '<AccountClientLinks',
    ]) {
      expect(summary).toContain(action);
    }
  });

  test('one primary Add account action with upload and OAuth; refresh-all in the overflow', () => {
    expect(page).toContain("navigate('/oauth')");
    expect(page).toContain('onSelect: handleUploadClick');
    expect(page).toContain('handleRefreshAllCredentials');
    expect(page.match(/variant="primary"/g)).toHaveLength(1);
  });
});

describe('ActionMenu', () => {
  test('a menu button: haspopup, collapsed until opened', () => {
    const markup = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(ActionMenu, {
          items: [{ id: 'a', label: 'Upload', onSelect: () => {} }],
          children: 'Add account',
        })
      )
    );
    expect(markup).toContain('aria-haspopup="menu"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).not.toContain('role="menu"');
    const source = read('src/components/flow/ActionMenu.tsx');
    expect(source).toContain('role="menuitem"');
    expect(source).toMatch(/'ArrowDown'[\s\S]*'ArrowUp'[\s\S]*'Home'[\s\S]*'End'[\s\S]*'Escape'/);
  });
});

describe('Quota page', () => {
  test('provider tabs hide providers with no accounts but keep All and the active tab', () => {
    const counts = { all: 3, claude: 2, codex: 1, kimi: 0, xai: 0 };
    expect(visibleQuotaTabs(['all', 'claude', 'codex', 'kimi', 'xai'], counts, 'all')).toEqual([
      'all',
      'claude',
      'codex',
    ]);
    expect(visibleQuotaTabs(['all', 'claude', 'kimi'], counts, 'kimi')).toEqual([
      'all',
      'claude',
      'kimi',
    ]);
  });
});
