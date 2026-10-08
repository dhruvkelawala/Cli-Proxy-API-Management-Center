// Test-only WCAG 2.x contrast helpers. Token values are parsed from the real SCSS sources
// so the assertions track theme changes instead of copies of the colours.
import { readFileSync } from 'node:fs';

export type Rgb = [number, number, number];

export const parseHex = (value: string): Rgb => {
  const hex = value.trim().replace(/^#/, '');
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex;
  if (!/^[0-9a-f]{6}$/i.test(full)) throw new Error(`Unsupported colour: ${value}`);
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const channel = (c: number) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

export const luminance = ([r, g, b]: Rgb) =>
  0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

export const contrastRatio = (a: string, b: string) => {
  const la = luminance(parseHex(a));
  const lb = luminance(parseHex(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

export type ThemeTokens = Record<string, string>;

const readStyle = (relative: string) =>
  readFileSync(new URL(`../../src/styles/${relative}`, import.meta.url), 'utf8');

const blockBody = (source: string, selector: string) => {
  const open = source.indexOf(`${selector} {`);
  if (open < 0) throw new Error(`Missing ${selector} in themes.scss`);
  const end = source.indexOf('\n}', open);
  return source.slice(open, end);
};

const declarations = (body: string): ThemeTokens => {
  const tokens: ThemeTokens = {};
  for (const m of body.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)) {
    tokens[m[1]] = m[2].replace(/\/\/.*$/, '').trim();
  }
  return tokens;
};

/** Resolves `var(--x)` chains; themes inherit from `:root` for tokens they do not redefine. */
export const loadThemeTokens = (): Record<'light' | 'white' | 'dark', ThemeTokens> => {
  const source = readStyle('themes.scss');
  const root = declarations(blockBody(source, ':root'));
  const merge = (selector: string) => ({ ...root, ...declarations(blockBody(source, selector)) });
  const raw = {
    light: root,
    white: merge("[data-theme='white']"),
    dark: merge("[data-theme='dark']"),
  };
  const resolve = (tokens: ThemeTokens, name: string, depth = 0): string => {
    const value = tokens[name];
    if (value === undefined || depth > 8) throw new Error(`Unresolved token ${name}`);
    const ref = value.match(/^var\((--[\w-]+)\)$/);
    return ref ? resolve(tokens, ref[1], depth + 1) : value;
  };
  const out = {} as Record<'light' | 'white' | 'dark', ThemeTokens>;
  for (const theme of ['light', 'white', 'dark'] as const) {
    out[theme] = {};
    for (const name of Object.keys(raw[theme])) {
      try {
        out[theme][name] = resolve(raw[theme], name);
      } catch {
        // Non-colour or unresolved tokens (shadows, color-mix) are not needed here.
      }
    }
  }
  return out;
};

export const readScssVariable = (file: string, name: string): string => {
  const m = readStyle(file).match(new RegExp(`^\\$${name}:\\s*([^;]+);`, 'm'));
  if (!m) throw new Error(`Missing $${name} in ${file}`);
  return m[1].trim();
};
