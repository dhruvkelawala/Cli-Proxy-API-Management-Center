import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

// The quota host binds CSS-module classes at import time, which Bun cannot render.
// Keep these source contracts small; browser checks cover the actual card interactions.
const source = readFileSync(
  new URL('../src/features/authFiles/components/AuthFileCard.tsx', import.meta.url),
  'utf8'
);
const styles = readFileSync(
  new URL('../src/features/authFiles/components/AuthFileCard.module.scss', import.meta.url),
  'utf8'
);

describe('auth file card presentation contract', () => {
  test('uses identity rather than logos or duplicate status badges', () => {
    expect(source).not.toContain('<img');
    expect(source).not.toContain('getAuthFileIcon');
    expect(source).not.toContain('stateBadge');
    const titleSource = readFileSync(
      new URL('../src/features/authFiles/components/AuthFileAccountTitle.tsx', import.meta.url),
      'utf8'
    );
    expect(titleSource).toContain('<h3');
    expect(titleSource).not.toContain('<img');
    expect(source).toContain('<AuthFileAccountHeading');
    expect(source).toContain('<AuthFileAccountSubtitle title={accountTitle} />');
  });

  test('uses one footer toggle and credential-specific accessible names', () => {
    const header = source.split('<header')[1].split('</header>')[0];
    const footer = source.split('<footer')[1].split('</footer>')[0];
    expect(source.match(/<ToggleSwitch/g)).toHaveLength(1);
    expect(header).not.toContain('<ToggleSwitch');
    expect(header).toContain("ariaLabel={t('auth_files.card_select', { name: accountName })}");
    expect(header).not.toContain('aria-label=');
    expect(footer).toContain('<ToggleSwitch');
    expect(source).toContain('const enabled = !isAccountDisabled(file);');
    expect(footer).toContain('checked={enabled}');
    expect(footer).toContain('statusUpdating[getAuthFileRefreshKey(file)] === true ||');
    expect(footer).toContain('isManualRefreshing');
    expect(footer).toContain('!isRuntimeOnly &&');
  });

  test('labels the switch from the actual account state', () => {
    const footer = source.split('<footer')[1].split('</footer>')[0];
    expect(footer).not.toContain('status_toggle_label');
    expect(footer).toMatch(
      /enabled\s*\?\s*t\('auth_files\.status_toggle_enabled'\)\s*:\s*t\('auth_files\.status_toggle_disabled'\)/
    );
    expect(footer).toMatch(
      /enabled\s*\?\s*t\('auth_files\.card_toggle_enabled', \{ name: accountName \}\)\s*:\s*t\('auth_files\.card_toggle_disabled', \{ name: accountName \}\)/
    );
  });

  test('keeps the account title and state visible in compact mode', () => {
    // The note is the title when set, so it is never repeated as a separate line.
    expect(source).not.toContain('noteValue');
    expect(source).not.toMatch(/compact\s*&&[^\n]*AuthFileAccount/);
    const stateLine = source.split('{stateKey && (')[1].split('</p>')[0];
    expect(stateLine).toContain('STATE_LABEL_KEYS[stateKey]');
    expect(stateLine).toContain('{poolLabel}');
    expect(source).toMatch(
      /presentation\.availability === 'attention' && presentation\.poolRole !== 'skipped'\s*\?\s*t\('auth_files\.pool_attention'\)/
    );
    expect(source).not.toMatch(/compact\s*&&[^\n]*stateKey/);
  });

  test('marks disabled cards with a surface tint, never opacity (text must stay >= 4.5:1)', () => {
    expect(source).toContain("file.disabled === true ? styles.cardDisabled : ''");
    expect(styles).toMatch(/\.cardDisabled\s*\{[^}]*background:/);
    expect(styles).not.toMatch(/\.cardDisabled[^{]*\{[^}]*opacity:/);
  });

  test('uses a plain-text weight tooltip while preserving the details link', () => {
    expect(source).toContain("title={t('auth_files.weight_tooltip')}");
    expect(source).not.toContain("title={t('auth_files.weight_hint')}");
    const detailsSource = readFileSync(
      new URL('../src/features/authFiles/components/AuthFileDetailsSheet.tsx', import.meta.url),
      'utf8'
    );
    expect(detailsSource).toContain('i18nKey="auth_files.weight_hint"');

    for (const locale of ['en', 'zh-CN', 'zh-TW', 'ru']) {
      const { auth_files: messages } = JSON.parse(
        readFileSync(new URL(`../src/i18n/locales/${locale}.json`, import.meta.url), 'utf8')
      ) as { auth_files: Record<string, string> };
      expect(messages.weight_tooltip).toBeTruthy();
      expect(messages.weight_tooltip).not.toMatch(/<[^>]+>/);
      expect(messages.weight_hint).toContain('<settingsLink>');
      expect(messages.weight_hint).toContain('</settingsLink>');
      expect(messages.weight_tooltip).toBe(messages.weight_hint.replace(/<\/?settingsLink>/g, ''));
    }
  });

  test('retains individual management actions and warning detail', () => {
    for (const handler of [
      'onShowModels(file)',
      'onDownload(file.name)',
      'onManualRefresh(file)',
      'onCooldownReset(file)',
      'onOpenPrefixProxyEditor(file)',
      'onDelete(file.name)',
    ]) {
      expect(source).toContain(handler);
    }
    expect(source).toContain('rawStatusMessage && hasStatusWarning && isProblemAuthFile(file)');
    expect(source).toContain('showManualRefreshButton');
    expect(source).toContain('file.disabled ||');
  });
});
