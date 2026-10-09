import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  UNTRACKED_HISTORY_KEY,
  historyKeyOf,
  layerIdFor,
  planNavigation,
  type LocationLike,
} from '@/components/common/pageTransitionModel';

const at = (pathname: string, extra: Partial<LocationLike> = {}): LocationLike => ({
  pathname,
  search: '',
  hash: '',
  key: UNTRACKED_HISTORY_KEY,
  state: null,
  ...extra,
});

describe('page transition navigation plan', () => {
  test('a hand-typed hash to another page transitions even though both keys are "default"', () => {
    expect(planNavigation(at('/'), at('/quota'))).toBe('transition');
    expect(planNavigation(at('/quota', { key: 'abc' }), at('/', { key: 'abc' }))).toBe(
      'transition'
    );
  });

  test('a query-only change on the same page updates the current layer in place', () => {
    expect(planNavigation(at('/config'), at('/config', { search: '?field=x' }))).toBe('update');
    expect(planNavigation(at('/config', { key: 'a' }), at('/config', { key: 'b' }))).toBe('update');
    const state = { from: 'accounts' };
    expect(planNavigation(at('/config'), at('/config', { state }))).toBe('update');
  });

  test('the same location is not a navigation', () => {
    expect(
      planNavigation(at('/config', { search: '?a=1' }), at('/config', { search: '?a=1' }))
    ).toBe('none');
    expect(planNavigation(null, at('/'))).toBe('transition');
  });

  test('layer ids stay unique when a page is visited again; "default" is no history key', () => {
    expect(layerIdFor('/quota', 1)).not.toBe(layerIdFor('/quota', 2));
    expect(historyKeyOf({ key: UNTRACKED_HISTORY_KEY })).toBeNull();
    expect(historyKeyOf({ key: 'k1' })).toBe('k1');
  });

  test('PageTransition keys layers by id and decides with the plan, not location.key', () => {
    const source = readFileSync('src/components/common/PageTransition.tsx', 'utf8');
    expect(source).toContain('key={layer.id}');
    expect(source).toContain('planNavigation(currentLayerLocation, location)');
    expect(source).not.toContain('location.key === currentLayerKey');
  });
});
