import { afterEach, describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import { AuthFileModelList } from '@/features/authFiles/components/AuthFileModelsModal';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { isTopmostDialog } from '@/components/ui/dialogStack';
import { TYPE_COLORS } from '@/utils/quota/constants';
import { contrastRatio, loadThemeTokens } from './helpers/wcagContrast';

const read = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');

const themes = loadThemeTokens();
const THEME_NAMES = ['light', 'white', 'dark'] as const;
const TEXT_MIN = 4.5; // WCAG 1.4.3, normal text
const CONTROL_MIN = 3; // WCAG 1.4.11, control boundaries and focus indicators

// Surfaces operational text is actually drawn on (page, card, floating dialog, hover/secondary).
// Every surface a button can sit on, including dialogs/sheets and hover fills.
const BUTTON_SURFACES = [
  '--bg-secondary',
  '--bg-primary',
  '--floating-surface',
  '--bg-tertiary',
  '--bg-hover',
];
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

    for (const kind of ['primary', 'danger'] as const) {
      test(`${name}: ${kind} button text is 4.5:1 and its fill is 3:1 on every surface it sits on`, () => {
        for (const state of ['', '-hover']) {
          const fill = tokens[`--btn-${kind}-bg${state}`];
          expect(contrastRatio(tokens[`--btn-${kind}-fg`], fill)).toBeGreaterThanOrEqual(TEXT_MIN);
          for (const surface of BUTTON_SURFACES) {
            expect(contrastRatio(fill, tokens[surface])).toBeGreaterThanOrEqual(CONTROL_MIN);
          }
        }
      });
    }

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

  test('button styles consume the themed button tokens and dark mode does not override them', () => {
    const components = read('src/styles/components.scss');
    expect(components).toContain('background-color: var(--btn-primary-bg, var(--primary-color))');
    expect(components).toContain('color: var(--btn-primary-fg, var(--primary-contrast, #fff))');
    expect(components).toContain('background-color: var(--btn-danger-bg,');
    expect(components).toContain('color: var(--btn-danger-fg, #fff)');
    // `[data-theme='dark'] .btn { color: #fff }` would otherwise beat the equal-specificity variants.
    expect(components).toContain('.btn:not(.btn-primary):not(.btn-danger) {');
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

  test('keeps the disabled badge visible and describes the excluded Copy button', async () => {
    await i18n.changeLanguage('en');
    const markup = render({ codex: ['gpt-5.5-mini'] });
    expect(markup).toContain('Disabled');
    expect(markup.match(/<button\b/g)).toHaveLength(models.length);
    const describedBy = markup.match(/aria-describedby="([^"]+)"/);
    expect(describedBy).not.toBeNull();
    expect(markup.match(/aria-describedby=/g)).toHaveLength(1);
    expect(markup).toMatch(
      new RegExp(`id="${describedBy![1]}"[^>]*>This OAuth model is disabled</span>`)
    );
    expect(render()).not.toContain('aria-describedby');
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
    expect(styles).not.toContain('.item:hover');
  });
});

// ---------------------------------------------------------------------------------------------
// CPA-006 part 2: Accounts, Client routes and the shared band in both themes.
// Static markup / pure contrast only. Focus, Escape and clipboard behaviour is proven in a real
// browser (see plans/006-account-accessibility.md), not by these tests.
// ---------------------------------------------------------------------------------------------

const LOCALES = ['en', 'zh-CN', 'zh-TW', 'ru', 'vi'] as const;
const locale = (name: string) =>
  JSON.parse(read(`src/i18n/locales/${name}.json`)) as Record<string, unknown>;
const lookup = (data: Record<string, unknown>, path: string): unknown =>
  path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown>)?.[key], data);

describe('operational status colours', () => {
  for (const name of THEME_NAMES) {
    const tokens = themes[name];
    test(`${name}: success/danger text tokens are 4.5:1 on cards, pages, dialogs and tinted rows`, () => {
      for (const text of ['--text-operational-success', '--text-operational-danger']) {
        for (const surface of SURFACES) {
          expect(contrastRatio(tokens[text], tokens[surface])).toBeGreaterThanOrEqual(TEXT_MIN);
        }
      }
    });
  }

  test('dark sidebar group labels (operational muted on the shell ground) are 4.5:1', () => {
    const layout = read('src/styles/layout.scss');
    const ground = layout.match(/--shell-ground:\s*(#[0-9a-f]{6})/i)?.[1];
    expect(ground).toBeDefined();
    expect(contrastRatio(themes.dark['--text-operational-muted'], ground!)).toBeGreaterThanOrEqual(
      TEXT_MIN
    );
    expect(layout).toMatch(/\.nav-group-label\s*\{[^}]*color:\s*var\(--text-operational-muted\)/);
    expect(layout).not.toMatch(/\.nav-group-label\s*\{[^}]*color-mix/);
  });

  test('provider badge colours are 4.5:1 in light and dark', () => {
    for (const [provider, set] of Object.entries(TYPE_COLORS)) {
      for (const mode of ['light', 'dark'] as const) {
        const colors = set[mode];
        if (!colors) continue;
        expect({
          provider,
          mode,
          ok: contrastRatio(colors.text, colors.bg) >= TEXT_MIN,
        }).toEqual({ provider, mode, ok: true });
      }
    }
  });

  test('Accounts styles use operational tokens for text and never dim content with opacity', () => {
    const dir = 'src/features/authFiles/components';
    for (const file of [
      'AuthFileCard',
      'AuthFileQuota',
      'AuthFilesToolbar',
      'ProviderTabs',
      'VaultHeader',
      'VaultPulse',
      'AuthFileDetailsSheet',
    ]) {
      const css = read(`${dir}/${file}.module.scss`);
      expect({
        file,
        hits: css.match(/^\s*color:\s*var\(--text-(tertiary|quaternary)\)/gm),
      }).toEqual({ file, hits: null });
    }
    const card = read(`${dir}/AuthFileCard.module.scss`);
    // Status dots keep the brand fills; the text next to them uses the operational tokens.
    expect(card).toMatch(/\.countLive\.countOk\s*\{[^}]*--text-operational-success/);
    expect(card).toMatch(/\.countLive\.countFail\s*\{[^}]*--text-operational-danger/);
    expect(card).not.toMatch(/\.cardDisabled\s*>/);
    expect(card).not.toMatch(/\.metaMetricLabel\s*\{[^}]*opacity/);
    expect(read('src/components/excludedModels/ExcludedModelsPicker.module.scss')).not.toMatch(
      /\.rowLocked\s*\{[^}]*opacity/
    );
  });
});

describe('ToggleSwitch', () => {
  test('renders a real switch whose name is the supplied state-aware label', () => {
    const markup = renderToStaticMarkup(
      createElement(ToggleSwitch, {
        checked: true,
        onChange: () => {},
        ariaLabel: 'Claude A: enabled',
      })
    );
    expect(markup).toContain('type="checkbox"');
    expect(markup).toContain('role="switch"');
    expect(markup).toContain('aria-label="Claude A: enabled"');
    expect(markup).toContain('checked=""');
  });

  test('has a visible keyboard focus ring and a 3:1 off-state boundary', () => {
    const css = read('src/components/ui/ToggleSwitch.module.scss');
    expect(css).toMatch(/input:focus-visible\s*\+\s*\.track\s*\{[^}]*outline:\s*2px solid/);
    expect(css).toMatch(
      /input:not\(:checked\)\s*\+\s*\.track\s*\{[^}]*var\(--text-operational-muted\)/
    );
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce[\s\S]*transition:\s*none/);
    for (const name of THEME_NAMES) {
      for (const surface of SURFACES) {
        expect(
          contrastRatio(themes[name]['--text-operational-muted'], themes[name][surface])
        ).toBeGreaterThanOrEqual(CONTROL_MIN);
      }
    }
  });
});

describe('SelectionCheckbox', () => {
  test('unchecked boundary uses a 3:1 colour (the border token is far below it)', () => {
    const css = read('src/components/ui/SelectionCheckbox.module.scss');
    expect(css).toMatch(/\.box\s*\{[^}]*border:\s*1px solid var\(--text-operational-muted\)/);
    for (const name of THEME_NAMES) {
      const tokens = themes[name];
      expect(contrastRatio(tokens['--border-color'], tokens['--bg-primary'])).toBeLessThan(
        CONTROL_MIN
      );
      for (const surface of SURFACES) {
        expect(
          contrastRatio(tokens['--text-operational-muted'], tokens[surface])
        ).toBeGreaterThanOrEqual(CONTROL_MIN);
      }
    }
  });
});

describe('Accounts controls: names that contain their visible text (WCAG 2.5.3)', () => {
  test('"Use only this subscription for…" keeps its visible text at the start of its name in every locale', () => {
    for (const lng of LOCALES) {
      const data = locale(lng);
      const visible = lookup(data, 'client_routes.accounts.use_only') as string;
      const named = lookup(data, 'client_routes.accounts.use_only_aria') as string;
      expect(named.startsWith(visible)).toBe(true);
      expect(named).toContain('{{account}}');
    }
  });

  test('icon-only account actions carry an explicit aria-label equal to their title', () => {
    const card = read('src/features/authFiles/components/AuthFileCard.tsx');
    for (const key of [
      'manual_refresh_button',
      'download_button',
      'prefix_proxy_button',
      'delete_button',
    ]) {
      expect(card).toContain(`title={t('auth_files.${key}')}`);
      expect(card).toContain(`aria-label={t('auth_files.${key}')}`);
    }
  });

  test('the Sort select name includes the visible current value', () => {
    const toolbar = read('src/features/authFiles/components/AuthFilesToolbar.tsx');
    expect(toolbar).toMatch(/ariaLabel=\{`\$\{t\('auth_files\.sort_label'\)\}: \$\{/);
  });

  test('copy feedback uses a generic message that exists in every locale', () => {
    for (const lng of LOCALES) {
      const data = locale(lng);
      expect(typeof lookup(data, 'notification.copied')).toBe('string');
      expect(typeof lookup(data, 'notification.copy_failed')).toBe('string');
      expect(typeof lookup(data, 'client_routes.matrix.cell_context')).toBe('string');
      expect(typeof lookup(data, 'client_routes.matrix.cell_change')).toBe('string');
      expect(lookup(data, 'client_routes.matrix.cell_label')).toBeUndefined();
    }
    expect(read('src/features/authFiles/AuthFilesPage.tsx')).toContain("t('notification.copied')");
  });
});

describe('Client routes and the shared band', () => {
  test('shared band disclosure exposes expanded state and a name that starts with its visible text', () => {
    const source = read('src/features/clientProfiles/components/CollapsibleSharedRoutingBand.tsx');
    expect(source).toContain('aria-expanded={open}');
    expect(source).toContain('aria-controls={regionId}');
    for (const lng of LOCALES) {
      const data = locale(lng);
      const base = 'client_routes.shared_band';
      expect((lookup(data, `${base}.edit_aria`) as string).toLowerCase()).toContain(
        (lookup(data, `${base}.edit`) as string).toLowerCase()
      );
      expect((lookup(data, `${base}.hide_aria`) as string).toLowerCase()).toContain(
        (lookup(data, `${base}.hide`) as string).toLowerCase()
      );
    }
  });

  test('matrix cells are named from visible text, with narrow-screen provider text kept in the tree', () => {
    const matrix = read('src/features/clientProfiles/components/ClientRoutesMatrix.tsx');
    expect(matrix).not.toMatch(/aria-label=\{t\(`\$\{CR\}\.matrix\.cell_label`/);
    expect(matrix).not.toContain('aria-hidden="true">\n                          {providerName}');
    const css = read('src/features/clientProfiles/components/ClientRoutesMatrix.module.scss');
    // Visually hidden (not display:none) so the provider stays part of the cell's name.
    expect(css).toMatch(/\.visuallyHidden,\s*\.mobileProvider\s*\{[^}]*clip-path:\s*inset\(50%\)/);
    expect(css).not.toMatch(/\.mobileProvider\s*\{[^}]*display:\s*none/);
  });
});

describe('dialogs, drawer and motion', () => {
  test('only the topmost modal dialog reacts to Escape and Tab', () => {
    const bottom = {} as HTMLElement;
    const top = {} as HTMLElement;
    const original = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = {
      querySelectorAll: () => [bottom, top],
    };
    try {
      expect(isTopmostDialog(top)).toBe(true);
      expect(isTopmostDialog(bottom)).toBe(false);
      expect(isTopmostDialog(null)).toBe(true);
    } finally {
      (globalThis as { document?: unknown }).document = original;
    }
    expect(read('src/components/ui/Sheet/Sheet.tsx')).toContain(
      'if (!isTopmostDialog(sheetRef.current)) return;'
    );
    expect(read('src/components/ui/Modal.tsx')).toContain(
      'if (!isTopmostDialog(modalRef.current)) return;'
    );
  });

  test('the confirmation dialog returns focus to its opener (it unmounts, so Modal cannot)', () => {
    const source = read('src/components/common/ConfirmationModal.tsx');
    expect(source).toContain('openerRef.current = ');
    expect(source).toContain('document.activeElement instanceof HTMLElement');
    expect(source).toContain('opener?.isConnected');
    expect(source).toContain('opener.focus(');
  });

  test('the closed mobile drawer is not focusable and motion honours reduced-motion', () => {
    const layout = read('src/styles/layout.scss');
    const mobileSidebar = layout.slice(
      layout.indexOf('transform: translateX(calc(-100% - 24px));')
    );
    expect(mobileSidebar.slice(0, 400)).toContain('visibility: hidden;');
    expect(mobileSidebar).toMatch(/&\.open\s*\{[^}]*visibility:\s*visible/);
    const components = read('src/styles/components.scss');
    expect(components).toMatch(
      /prefers-reduced-motion:\s*reduce\)\s*\{[^}]*\.modal\.modal-entering[^}]*animation:\s*none/
    );
  });

  test('Select keyboard focus has a high-contrast outline, not only a faint ring', () => {
    expect(read('src/components/ui/Select.module.scss')).toMatch(
      /&:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--text-secondary\)/
    );
  });
});

describe('CSS module class names', () => {
  test('no component reads a class name that collides with String.prototype in Bun tests', () => {
    // In Bun tests SCSS modules load as strings, so `styles.link` is String.prototype.link (a
    // function), which React rejects as an invalid className prop.
    const collisions =
      /\bstyles\.(anchor|big|blink|bold|fixed|fontcolor|fontsize|italics|link|small|strike|sub|sup)\b/;
    const walk = (dir: string): string[] =>
      readdirSync(new URL(`../${dir}`, import.meta.url), { withFileTypes: true }).flatMap(
        (entry) =>
          entry.isDirectory()
            ? walk(`${dir}/${entry.name}`)
            : entry.name.endsWith('.tsx')
              ? [`${dir}/${entry.name}`]
              : []
      );
    const offenders = walk('src').filter((file) => collisions.test(read(file)));
    expect(offenders).toEqual([]);
  });

  test('RoutingTuningPanel renders its providers link without an invalid className', () => {
    const source = read('src/features/config/routing/RoutingTuningPanel.tsx');
    expect(source).toContain('styles.providersLink');
    expect(read('src/features/config/routing/RoutingTuningPanel.module.scss')).toContain(
      '.providersLink {'
    );
  });
});
