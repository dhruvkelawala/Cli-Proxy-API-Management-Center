import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { contrastRatio, loadThemeTokens } from './helpers/wcagContrast';

const read = (relative: string) =>
  readFileSync(
    new URL(`../src/features/clientProfiles/components/${relative}`, import.meta.url),
    'utf8'
  );

const BADGE_MODULES = [
  'AccountClientLinks.module.scss',
  'PolicyPill.module.scss',
  'PolicySheet.module.scss',
];

describe('client routes in the dark theme', () => {
  test('"will fail" badges use the themed danger fill and foreground pair', () => {
    for (const file of BADGE_MODULES) {
      const source = read(file);
      expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(source).toContain('background: var(--btn-danger-bg);');
      expect(source).toContain('color: var(--btn-danger-fg);');
    }
  });

  test('the themed danger badge pair stays readable in every theme', () => {
    for (const [theme, tokens] of Object.entries(loadThemeTokens())) {
      const ratio = contrastRatio(tokens['--btn-danger-fg'], tokens['--btn-danger-bg']);
      expect({ theme, readable: ratio >= 4.5 }).toEqual({ theme, readable: true });
    }
  });

  test('native radios and checkboxes switch to the dark control palette', () => {
    for (const file of ['PolicySheet.module.scss', 'AccountPinSheet.module.scss']) {
      const source = read(file);
      expect(source).toMatch(/\[data-theme='dark'\] & \{\s*color-scheme: dark;/);
    }
  });
});
