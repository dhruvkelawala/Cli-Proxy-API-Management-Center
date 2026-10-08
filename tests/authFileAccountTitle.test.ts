import { describe, expect, test } from 'bun:test';
import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  AuthFileAccountHeading,
  AuthFileAccountSubtitle,
} from '../src/features/authFiles/components/AuthFileAccountTitle';
import { deriveAccountTitle } from '../src/features/authFiles/identity';
import type { AuthFileItem } from '../src/types';

const authFile = (overrides: Partial<AuthFileItem> = {}): AuthFileItem => ({
  name: 'claude-claude-a@example.test.json',
  type: 'claude',
  email: 'claude-a@example.test',
  ...overrides,
});

const render = (file: AuthFileItem) => {
  const title = deriveAccountTitle(file);
  return renderToStaticMarkup(
    createElement(
      Fragment,
      null,
      createElement(AuthFileAccountHeading, { title, typeLabel: 'Claude', typeStyle: {} }),
      createElement(AuthFileAccountSubtitle, { title })
    )
  );
};

const headingText = (html: string) =>
  html
    .split('<h3')[1]
    .split('</h3>')[0]
    .replace(/^[^>]*>/, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

describe('account title rule', () => {
  test('a note becomes the title with the email underneath, shown once', () => {
    const html = render(authFile({ note: '  Work subscription  ' }));
    expect(headingText(html)).toBe('Claude Work subscription');
    const below = html.split('</h3>')[1];
    expect(below).toContain('>claude-a@example.test</p>');
    expect(below).toContain('>claude-claude-a@example.test</p>');
    expect(html.match(/Work subscription/g)).toHaveLength(2); // text + title attribute
  });

  test('without a note the email stays the title and is not repeated', () => {
    const html = render(authFile({ note: '   ' }));
    expect(headingText(html)).toBe('Claude claude-a@example.test');
    const below = html.split('</h3>')[1];
    expect(below).not.toContain('>claude-a@example.test</p>');
    expect(below).toContain('>claude-claude-a@example.test</p>');
  });

  test('a note over a file-name-only account keeps the file name line', () => {
    const title = deriveAccountTitle(
      authFile({ name: 'kimi-1712345678901.json', type: 'kimi', email: undefined, note: 'Kimi' })
    );
    expect(title).toMatchObject({
      title: 'Kimi',
      titleIsNote: true,
      titleMono: false,
      account: null,
      fileLine: 'kimi-1712345678901',
    });
  });

  test('without a note a file-name-only account keeps the mono title', () => {
    expect(
      deriveAccountTitle(authFile({ name: 'kimi-9.json', type: 'kimi', email: undefined }))
    ).toMatchObject({ title: 'kimi-9', titleMono: true, account: null, fileLine: null });
  });
});
