/**
 * Sentences for the Plugins and Plugin Store pages. React-free; copy is returned as i18n key
 * descriptors.
 */

import type { Copy } from '@/features/clientProfiles/routing/routingOrder';

const P = 'plugin_management.flow';
const S = 'plugin_store.flow';

export interface PluginsHeadline {
  title: Copy;
  subtitle: Copy | null;
  tone: 'ok' | 'warn' | 'bad' | 'off';
}

export function describePlugins(input: {
  loaded: boolean;
  failed: boolean;
  pluginsEnabled: boolean;
  total: number;
  running: number;
}): PluginsHeadline {
  if (!input.loaded) {
    if (input.failed) return { title: { key: `${P}.title_failed` }, subtitle: null, tone: 'bad' };
    return { title: { key: `${P}.title_loading` }, subtitle: null, tone: 'off' };
  }
  if (!input.pluginsEnabled) {
    return {
      title: { key: `${P}.title_off` },
      subtitle: { key: `${P}.subtitle_off`, values: { count: input.total } },
      tone: 'warn',
    };
  }
  if (input.total === 0) {
    return {
      title: { key: `${P}.title_none` },
      subtitle: { key: `${P}.subtitle_none` },
      tone: 'off',
    };
  }
  if (input.running === input.total) {
    return {
      title: { key: `${P}.title_all`, values: { count: input.total } },
      subtitle: { key: `${P}.subtitle_all` },
      tone: 'ok',
    };
  }
  return {
    title: { key: `${P}.title_some`, values: { running: input.running, count: input.total } },
    subtitle: { key: `${P}.subtitle_some` },
    tone: input.running === 0 ? 'warn' : 'ok',
  };
}

export function describeStore(input: {
  loaded: boolean;
  failed: boolean;
  total: number;
  installed: number;
  updates: number;
}): PluginsHeadline {
  if (!input.loaded) {
    if (input.failed) return { title: { key: `${S}.title_failed` }, subtitle: null, tone: 'bad' };
    return { title: { key: `${S}.title_loading` }, subtitle: null, tone: 'off' };
  }
  if (input.total === 0) {
    return {
      title: { key: `${S}.title_empty` },
      subtitle: { key: `${S}.subtitle_empty` },
      tone: 'off',
    };
  }
  if (input.updates > 0) {
    return {
      title: { key: `${S}.title_updates`, values: { count: input.updates } },
      subtitle: {
        key: `${S}.subtitle_counts`,
        values: { count: input.total, installed: input.installed },
      },
      tone: 'warn',
    };
  }
  return {
    title: { key: `${S}.title_available`, values: { count: input.total } },
    subtitle: { key: `${S}.subtitle_installed`, values: { count: input.installed } },
    tone: 'ok',
  };
}
