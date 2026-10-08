import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { loadThemeTokens } from './helpers/wcagContrast';

const read = (relative: string) => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');

describe('dark shell theme', () => {
  const dark = loadThemeTokens().dark;

  test('theme menu dark preview matches the dark theme tokens', () => {
    const layout = read('src/components/layout/MainLayout.tsx');
    const preview = layout.slice(layout.indexOf("key: 'dark'"));
    for (const [field, token] of [
      ['bg', '--bg-secondary'],
      ['card', '--bg-primary'],
      ['border', '--border-color'],
      ['text', '--text-primary'],
      ['textMuted', '--text-tertiary'],
    ]) {
      expect(preview).toContain(`${field}: '${dark[token]}'`);
    }
  });

  test('dark content canvas sits inset on a darker shell ground and resets on mobile', () => {
    const layout = read('src/styles/layout.scss');
    const block = layout.slice(layout.lastIndexOf("[data-theme='dark'] {"));
    expect(block).toContain('--shell-ground: #08090a;');
    expect(block).toContain('margin: 8px 8px 8px 0;');
    expect(block).toContain('@media (max-width: $breakpoint-mobile)');
  });
});
