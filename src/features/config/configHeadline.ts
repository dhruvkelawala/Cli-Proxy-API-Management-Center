/**
 * The Config page's sentence: the editor's status (resolveStatus) said as an outcome. React-free;
 * copy is returned as i18n key descriptors.
 */

import type { Copy } from '@/features/clientProfiles/routing/routingOrder';
import type { ConfigStatus } from './uiState';

const C = 'config_management.flow';

export interface ConfigHeadline {
  title: Copy;
  subtitle: Copy | null;
  tone: 'ok' | 'warn' | 'bad' | 'off';
}

export interface DescribeConfigInput {
  status: ConfigStatus;
  /** Visual fields changed but not saved. */
  dirtyCount: number;
  /** The YAML source was edited directly. */
  sourceDirty: boolean;
  errorCount: number;
  fieldCount: number;
  sectionCount: number;
  /** The last save could only be partly applied and needs a reload. */
  recoveryRequired?: boolean;
}

export function describeConfig({
  status,
  dirtyCount,
  sourceDirty,
  errorCount,
  fieldCount,
  sectionCount,
  recoveryRequired = false,
}: DescribeConfigInput): ConfigHeadline {
  if (recoveryRequired) {
    return {
      title: { key: `${C}.title_recovery` },
      subtitle: { key: `${C}.subtitle_recovery` },
      tone: 'bad',
    };
  }
  switch (status.key) {
    case 'disconnected':
      return {
        title: { key: `${C}.title_disconnected` },
        subtitle: { key: `${C}.subtitle_disconnected` },
        tone: 'off',
      };
    case 'loading':
      return { title: { key: `${C}.title_loading` }, subtitle: null, tone: 'off' };
    case 'load_failed':
      return {
        title: { key: `${C}.title_load_failed` },
        subtitle: { key: `${C}.subtitle_load_failed` },
        tone: 'bad',
      };
    case 'yaml_error':
      return {
        title: { key: `${C}.title_yaml_error` },
        subtitle: { key: `${C}.subtitle_yaml_error` },
        tone: 'bad',
      };
    case 'validation_blocked':
      return {
        title: { key: `${C}.title_invalid`, values: { count: Math.max(errorCount, 1) } },
        subtitle: { key: `${C}.subtitle_invalid` },
        tone: 'bad',
      };
    case 'saving':
      return { title: { key: `${C}.title_saving` }, subtitle: null, tone: 'off' };
    case 'dirty':
      // A direct YAML edit supersedes the visual count: the source is what will be saved.
      if (sourceDirty)
        return {
          title: { key: `${C}.title_source_dirty` },
          subtitle: { key: `${C}.subtitle_dirty` },
          tone: 'warn',
        };
      return {
        title:
          dirtyCount > 0
            ? { key: `${C}.title_dirty`, values: { count: dirtyCount } }
            : { key: `${C}.title_dirty_some` },
        subtitle: { key: `${C}.subtitle_dirty` },
        tone: 'warn',
      };
    case 'synced':
      return {
        title: { key: `${C}.title_synced` },
        subtitle: {
          key: `${C}.subtitle_synced`,
          values: { count: fieldCount, sections: sectionCount },
        },
        tone: 'ok',
      };
  }
}
