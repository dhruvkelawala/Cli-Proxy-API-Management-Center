/**
 * Sidebar navigation: a short primary list for daily work and one collapsible "More" group
 * for everything else. React-free (icons are passed in) so the split can be tested.
 */

import type { ReactNode } from 'react';

export interface SidebarNavLinkItem {
  kind?: 'link';
  path: string;
  labelKey?: string;
  metaKey?: string;
  label?: string;
  meta?: string;
  badge?: number;
  badgeLabel?: string;
  icon: ReactNode;
}

export interface SidebarNavDrawerItem {
  kind: 'drawer';
  id: string;
  label: string;
  meta?: string;
  icon: ReactNode;
  children: SidebarNavLinkItem[];
}

export type SidebarNavItem = SidebarNavLinkItem | SidebarNavDrawerItem;

export type SidebarIconKey =
  | 'dashboard'
  | 'quickStart'
  | 'aiProviders'
  | 'authFiles'
  | 'clientRoutes'
  | 'oauth'
  | 'quota'
  | 'plugins'
  | 'pluginStore'
  | 'config'
  | 'logs'
  | 'system';

export interface SidebarNavInput {
  icons: Record<SidebarIconKey, ReactNode>;
  supportsPlugin: boolean;
  /** Quick Start becomes the sponsor's name when it is configured. */
  quickStartLabel?: string;
  authFilesCount: number | null;
  authFilesCountLabel?: string;
  /** Pages contributed by plugins (already gated on plugin support). */
  pluginPageItems?: SidebarNavItem[];
}

export interface SidebarNav {
  /** Day-to-day pages: Overview, Routing, Accounts, Quota. */
  primary: SidebarNavItem[];
  /** Everything else, behind one collapsible group. */
  more: SidebarNavItem[];
}

export const NAV_MORE_STORAGE_KEY = 'cpamc.sidebar.more-open';

export const buildSidebarNav = ({
  icons,
  supportsPlugin,
  quickStartLabel,
  authFilesCount,
  authFilesCountLabel,
  pluginPageItems = [],
}: SidebarNavInput): SidebarNav => ({
  primary: [
    { path: '/', labelKey: 'nav.overview', metaKey: 'nav_meta.dashboard', icon: icons.dashboard },
    {
      path: '/client-routes',
      labelKey: 'nav.client_routes',
      metaKey: 'nav_meta.client_routes',
      icon: icons.clientRoutes,
    },
    {
      path: '/auth-files',
      labelKey: 'nav.auth_files',
      metaKey: 'nav_meta.auth_files',
      badge: authFilesCount ?? undefined,
      badgeLabel: authFilesCount === null ? undefined : authFilesCountLabel,
      icon: icons.authFiles,
    },
    {
      path: '/quota',
      labelKey: 'nav.quota',
      metaKey: 'nav_meta.quota_management',
      icon: icons.quota,
    },
  ],
  more: [
    {
      path: '/quick-start',
      label: quickStartLabel,
      labelKey: quickStartLabel ? undefined : 'nav.quick_start',
      metaKey: 'nav_meta.quick_start',
      icon: icons.quickStart,
    },
    {
      path: '/ai-providers',
      labelKey: 'nav.ai_providers',
      metaKey: 'nav_meta.ai_providers',
      icon: icons.aiProviders,
    },
    { path: '/oauth', labelKey: 'nav.oauth', metaKey: 'nav_meta.oauth', icon: icons.oauth },
    { path: '/logs', labelKey: 'nav.logs', metaKey: 'nav_meta.logs', icon: icons.logs },
    {
      path: '/config',
      labelKey: 'nav.config_management',
      metaKey: 'nav_meta.config_management',
      icon: icons.config,
    },
    ...(supportsPlugin
      ? [
          {
            path: '/plugins',
            labelKey: 'nav.plugins',
            metaKey: 'nav_meta.plugins',
            icon: icons.plugins,
          },
          {
            path: '/plugin-store',
            labelKey: 'nav.plugin_store',
            metaKey: 'nav_meta.plugin_store',
            icon: icons.pluginStore,
          },
        ]
      : []),
    ...pluginPageItems,
    {
      path: '/system',
      labelKey: 'nav.system_info',
      metaKey: 'nav_meta.system_info',
      icon: icons.system,
    },
  ],
});

export const flattenNavItems = (items: SidebarNavItem[]): SidebarNavLinkItem[] =>
  items.flatMap((item) => (item.kind === 'drawer' ? item.children : [item]));

const normalizePath = (pathname: string) => {
  const trimmed = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  return trimmed === '/dashboard' ? '/' : trimmed;
};

/** The link that owns a route (exact, else the longest parent path), or null. */
export const findActiveNavLink = (
  items: SidebarNavItem[],
  pathname: string
): SidebarNavLinkItem | null => {
  const path = normalizePath(pathname);
  const links = flattenNavItems(items);
  return (
    links.find((item) => item.path === path) ??
    links
      .filter((item) => item.path !== '/' && path.startsWith(`${item.path}/`))
      .sort((a, b) => b.path.length - a.path.length)[0] ??
    null
  );
};

/** Saved More state; collapsed unless the user opened it before. */
export const readNavMoreOpen = (storage: Pick<Storage, 'getItem'> | null): boolean => {
  try {
    return storage?.getItem(NAV_MORE_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
};

export const writeNavMoreOpen = (storage: Pick<Storage, 'setItem'> | null, open: boolean) => {
  try {
    storage?.setItem(NAV_MORE_STORAGE_KEY, open ? 'true' : 'false');
  } catch {
    // Private mode or a full quota: the group simply starts collapsed next time.
  }
};
