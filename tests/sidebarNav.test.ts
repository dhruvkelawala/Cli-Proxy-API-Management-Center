import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  NAV_MORE_STORAGE_KEY,
  buildSidebarNav,
  findActiveNavLink,
  flattenNavItems,
  readNavMoreOpen,
  writeNavMoreOpen,
  type SidebarIconKey,
} from '@/components/layout/navModel';

const icons = new Proxy({}, { get: () => null }) as Record<SidebarIconKey, null>;
const paths = (items: ReturnType<typeof buildSidebarNav>['primary']) =>
  flattenNavItems(items).map((item) => item.path);

describe('sidebar navigation', () => {
  test('primary shows only Overview, Routing, Accounts and Quota', () => {
    const nav = buildSidebarNav({ icons, supportsPlugin: true, authFilesCount: 3 });
    expect(paths(nav.primary)).toEqual(['/', '/client-routes', '/auth-files', '/quota']);
    expect(flattenNavItems(nav.primary).map((item) => item.labelKey)).toEqual([
      'nav.overview',
      'nav.client_routes',
      'nav.auth_files',
      'nav.quota',
    ]);
    // The only badge is a useful count.
    expect(flattenNavItems(nav.primary).filter((item) => item.badge !== undefined)).toHaveLength(1);
  });

  test('everything else lives under More; plugin pages only when supported', () => {
    const withPlugins = buildSidebarNav({ icons, supportsPlugin: true, authFilesCount: null });
    expect(paths(withPlugins.more)).toEqual([
      '/quick-start',
      '/ai-providers',
      '/oauth',
      '/logs',
      '/config',
      '/plugins',
      '/plugin-store',
      '/system',
    ]);
    const without = buildSidebarNav({ icons, supportsPlugin: false, authFilesCount: null });
    expect(paths(without.more)).not.toContain('/plugins');
    expect(paths(without.more)).not.toContain('/plugin-store');
    expect(flattenNavItems(without.primary)[2].badge).toBeUndefined();
  });

  test('the sponsor name replaces the Quick Start label when configured', () => {
    const nav = buildSidebarNav({
      icons,
      supportsPlugin: false,
      authFilesCount: null,
      quickStartLabel: 'APIKEY.FUN',
    });
    expect(flattenNavItems(nav.more)[0]).toMatchObject({
      label: 'APIKEY.FUN',
      labelKey: undefined,
    });
  });

  test('an active More page is found so it stays visible while the group is collapsed', () => {
    const nav = buildSidebarNav({ icons, supportsPlugin: false, authFilesCount: null });
    expect(findActiveNavLink(nav.more, '/config')?.path).toBe('/config');
    expect(findActiveNavLink(nav.more, '/logs/')?.path).toBe('/logs');
    expect(findActiveNavLink(nav.more, '/client-routes')).toBeNull();
    expect(findActiveNavLink(nav.primary, '/dashboard')?.path).toBe('/');
  });

  test('More is collapsed by default and its state persists', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    };
    expect(readNavMoreOpen(storage)).toBe(false);
    writeNavMoreOpen(storage, true);
    expect(store.get(NAV_MORE_STORAGE_KEY)).toBe('true');
    expect(readNavMoreOpen(storage)).toBe(true);
    expect(readNavMoreOpen(null)).toBe(false);
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readNavMoreOpen(throwing)).toBe(false);
  });

  test('MainLayout keeps the drawer focus and Escape handling (CPA-006)', () => {
    const layout = readFileSync(
      new URL('../src/components/layout/MainLayout.tsx', import.meta.url),
      'utf8'
    );
    expect(layout).toContain('<SidebarMoreGroup');
    expect(layout).toContain('closeSidebarRestoringFocus');
    expect(layout).toContain(`document.querySelector('[role="dialog"][aria-modal="true"]')`);
  });
});
