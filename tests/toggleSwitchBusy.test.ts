import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';

const render = (props: { busy?: boolean; disabled?: boolean }) =>
  renderToStaticMarkup(
    createElement(ToggleSwitch, {
      checked: true,
      onChange: () => {},
      ariaLabel: 'Claude Work',
      ...props,
    })
  );

describe('ToggleSwitch busy state', () => {
  test('busy stays focusable (not disabled) and is announced as busy and unavailable', () => {
    const markup = render({ busy: true });
    expect(markup).toContain('role="switch"');
    expect(markup).not.toMatch(/\sdisabled=""/);
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('aria-disabled="true"');
    // The fixed name and checked state are unchanged (CPA-006).
    expect(markup).toContain('aria-label="Claude Work"');
    expect(markup).toContain('checked=""');
  });

  test('not busy: no busy attributes; disabled still disables', () => {
    expect(render({})).not.toContain('aria-busy');
    expect(render({ disabled: true })).toMatch(/\sdisabled=""/);
  });

  test('busy is dimmed without opacity on text, and its pulse stops under reduced motion', () => {
    const css = readFileSync('src/components/ui/ToggleSwitch.module.scss', 'utf8');
    expect(css).toMatch(/\.busy \.track\s*\{[^}]*color-mix/);
    expect(css).toMatch(
      /prefers-reduced-motion: reduce[\s\S]*\.busy \.track\s*\{\s*animation: none/
    );
  });

  test('both account switches (row and card) use busy during a save instead of disabling', () => {
    const card = readFileSync('src/features/authFiles/components/AuthFileCard.tsx', 'utf8');
    const footer = card.split('<footer')[1].split('</footer>')[0];
    expect(footer).toContain('disabled={disableControls}');
    expect(footer).toContain(
      'busy={statusUpdating[getAuthFileRefreshKey(file)] === true || isManualRefreshing}'
    );
    const row = readFileSync('src/features/authFiles/components/AccountRow.tsx', 'utf8');
    expect(row).toContain('busy={toggleBusy}');
  });
});
