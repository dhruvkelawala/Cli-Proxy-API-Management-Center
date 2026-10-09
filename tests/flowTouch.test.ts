import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { FlowDiagram } from '@/components/flow';
import { isDragStart } from '@/components/flow/flowLayout';

const noop = () => {};
const render = renderToStaticMarkup;

describe('FlowDiagram on touch screens', () => {
  test('touch drags only from the grip; mouse and pen drag the whole card', () => {
    const grip = { closest: (selector: string) => (selector === '[data-grip]' ? {} : null) };
    const body = { closest: () => null };
    expect(isDragStart('touch', body as unknown as EventTarget)).toBe(false);
    expect(isDragStart('touch', grip as unknown as EventTarget)).toBe(true);
    expect(isDragStart('mouse', body as unknown as EventTarget)).toBe(true);
    expect(isDragStart('pen', body as unknown as EventTarget)).toBe(true);
    const markup = render(
      createElement(FlowDiagram, {
        sources: [{ id: 's', label: 'Mini' }],
        destinations: [
          { id: 'a', state: 'live' as const },
          { id: 'b', state: 'waiting' as const },
        ],
        label: 'Accounts',
        renderDestination: (d: { id: string }) => d.id,
        destinationLabel: (d: { id: string }) => d.id,
        onReorder: noop,
      })
    );
    expect(markup.match(/data-grip=""/g)).toHaveLength(2);
  });

  test('cards let the page scroll vertically; only the grip captures the gesture', () => {
    const css = readFileSync(
      new URL('../src/components/flow/FlowDiagram.module.scss', import.meta.url),
      'utf8'
    );
    expect(css).toMatch(/\[data-reorderable='true'\] \{[^}]*touch-action: pan-y;/);
    expect(css).toMatch(/\.grip \{[^}]*touch-action: none;/);
    expect(css).not.toMatch(/\[data-reorderable='true'\] \{[^}]*touch-action: none;/);
  });
});
