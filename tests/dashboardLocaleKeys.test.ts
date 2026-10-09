import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'locales' ? [] : walk(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
const source = walk('src')
  .map((path) => readFileSync(path, 'utf8'))
  .join('\n');
const PLURAL = /_(zero|one|two|few|many|other)$/;

describe('dashboard locale keys', () => {
  test('no dashboard key is built dynamically, so a literal search finds every use', () => {
    expect(source).not.toMatch(/['"`]dashboard\.['"`]\s*\+/);
    expect(source).not.toMatch(/`dashboard\.\$\{/);
  });

  for (const locale of ['en', 'zh-CN', 'zh-TW', 'ru', 'vi']) {
    test(`${locale}: every dashboard key is still used (the old dashboard's copy is gone)`, () => {
      const messages = JSON.parse(readFileSync(`src/i18n/locales/${locale}.json`, 'utf8')) as {
        dashboard: Record<string, string>;
      };
      const unused = Object.keys(messages.dashboard).filter(
        (key) => !source.includes(`dashboard.${key.replace(PLURAL, '')}`)
      );
      expect(unused).toEqual([]);
      expect(messages.dashboard.hero_verdict_good).toBeUndefined();
      expect(typeof messages.dashboard.success_rate).toBe('string');
    });
  }
});
