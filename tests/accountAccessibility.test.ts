import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import { AuthFileModelList } from '@/features/authFiles/components/AuthFileModelsModal';
import { contrastRatio, loadThemeTokens, readScssVariable } from './helpers/wcagContrast';

const read = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');

const themes = loadThemeTokens();
const THEME_NAMES = ['light', 'white', 'dark'] as const;
const TEXT_MIN = 4.5; // WCAG 1.4.3, normal text
const CONTROL_MIN = 3; // WCAG 1.4.11, control boundaries and focus indicators

// Surfaces operational text is actually drawn on (page, card, floating dialog, hover/secondary).
const SURFACES = ['--bg-secondary', '--bg-primary', '--floating-surface', '--bg-tertiary'];

describe('WCAG contrast helper', () => {
  test('matches published reference values', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    // The historical light Login button: white on --primary-color.
    expect(contrastRatio('#ffffff', '#8b8680')).toBeCloseTo(3.61, 2);
  });
});

describe('theme contrast', () => {
  for (const name of THEME_NAMES) {
    const tokens = themes[name];

    test(`${name}: primary text tokens meet 4.5:1 on operational surfaces`, () => {
      for (const surface of SURFACES) {
        for (const text of ['--text-primary', '--text-operational-muted']) {
          expect(contrastRatio(tokens[text], tokens[surface])).toBeGreaterThanOrEqual(TEXT_MIN);
        }
      }
      // Secondary text sits on pages, cards and dialogs (not on hover fills).
      for (const surface of ['--bg-secondary', '--bg-primary', '--floating-surface']) {
        expect(contrastRatio(tokens['--text-secondary'], tokens[surface])).toBeGreaterThanOrEqual(
          TEXT_MIN
        );
      }
    });

    test(`${name}: --text-muted resolves to the accessible operational token`, () => {
      expect(tokens['--text-muted']).toBe(tokens['--text-operational-muted']);
    });

    test(`${name}: enabled primary button text is 4.5:1 and the control is 3:1 against its surface`, () => {
      for (const bg of ['--btn-primary-bg', '--btn-primary-bg-hover']) {
        expect(contrastRatio(tokens['--btn-primary-fg'], tokens[bg])).toBeGreaterThanOrEqual(
          TEXT_MIN
        );
      }
      for (const surface of ['--bg-secondary', '--bg-primary']) {
        expect(contrastRatio(tokens['--btn-primary-bg'], tokens[surface])).toBeGreaterThanOrEqual(
          CONTROL_MIN
        );
      }
    });

    test(`${name}: focus ring colour (--text-secondary) is 3:1 on dialog and card surfaces`, () => {
      for (const surface of [
        '--bg-secondary',
        '--bg-primary',
        '--floating-surface',
        '--bg-tertiary',
      ]) {
        const ratio = contrastRatio(tokens['--text-secondary'], tokens[surface]);
        // Light --bg-tertiary is the hover fill; still >= 3:1 for a non-text indicator.
        expect(ratio).toBeGreaterThanOrEqual(CONTROL_MIN);
      }
    });
  }

  test('danger button label is 4.5:1', () => {
    const bg = readScssVariable('components.scss', 'btn-danger-bg');
    expect(contrastRatio('#ffffff', bg)).toBeGreaterThanOrEqual(TEXT_MIN);
  });

  test('primary button styles consume the accessible button tokens', () => {
    const components = read('src/styles/components.scss');
    expect(components).toContain('background-color: var(--btn-primary-bg, var(--primary-color))');
    expect(components).toContain('color: var(--btn-primary-fg, var(--primary-contrast, #fff))');
    expect(components).toContain('background-color: $btn-danger-bg');
  });
});

describe('AuthFileModelList copy buttons', () => {
  const models = [{ id: 'gpt-5.5', display_name: 'GPT 5.5', type: 'chat' }, { id: 'gpt-5.5-mini' }];
  const render = (excluded: Record<string, string[]> = {}) =>
    renderToStaticMarkup(
      createElement(AuthFileModelList, {
        models,
        fileType: 'codex',
        excluded,
        onCopyText: () => {},
      })
    );

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  test('renders one real button per model, named after the model id', async () => {
    await i18n.changeLanguage('en');
    const markup = render();
    expect(markup.match(/<button\b/g)).toHaveLength(models.length);
    expect(markup).not.toMatch(/<div[^>]*onclick/i);
    expect(markup).toContain('aria-label="Copy model ID gpt-5.5"');
    expect(markup).toContain('aria-label="Copy model ID gpt-5.5-mini"');
    // Visible label is a prefix of the accessible name (WCAG 2.5.3).
    expect(markup).toMatch(/aria-label="Copy model ID gpt-5\.5"[^>]*><span>Copy<\/span>/);
  });

  test('keeps model text readable as plain text outside the button', async () => {
    await i18n.changeLanguage('en');
    const markup = render();
    const buttonFree = markup.replace(/<button\b[\s\S]*?<\/button>/g, '');
    expect(buttonFree).toContain('gpt-5.5-mini');
    expect(buttonFree).toContain('GPT 5.5');
    expect(markup).toContain('<ul');
    expect(markup.match(/<li\b/g)).toHaveLength(models.length);
  });

  test('keeps the disabled badge visible while the model stays copyable', async () => {
    await i18n.changeLanguage('en');
    const markup = render({ codex: ['gpt-5.5-mini'] });
    expect(markup).toContain('Disabled');
    expect(markup.match(/<button\b/g)).toHaveLength(models.length);
  });

  test('localizes the accessible name in every shipped locale', async () => {
    for (const lng of ['en', 'zh-CN', 'zh-TW', 'ru', 'vi']) {
      await i18n.changeLanguage(lng);
      const expected = i18n.t('auth_files.models_copy_aria', { id: 'gpt-5.5' });
      expect(expected).toContain('gpt-5.5');
      expect(expected).not.toContain('{{');
      expect(render()).toContain(`aria-label="${expected}"`);
    }
  });

  test('source contract: no clickable div rows, explicit focus ring, no opacity dimming', () => {
    const source = read('src/features/authFiles/components/AuthFileModelsModal.tsx');
    const styles = read('src/features/authFiles/components/AuthFileModelsModal.module.scss');
    expect(source).not.toMatch(/<div[^>]*onClick/);
    expect(styles).toContain(':focus-visible');
    expect(styles).not.toContain('opacity: 0.55');
    expect(styles).not.toContain('var(--text-tertiary)');
  });
});
