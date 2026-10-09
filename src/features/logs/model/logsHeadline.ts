/**
 * The Logs page's sentence: whether the gateway writes logs we can read, and whether reading
 * follows them live. React-free; copy is returned as i18n key descriptors.
 */

import type { Copy } from '@/features/clientProfiles/routing/routingOrder';

const L = 'logs.flow';

export interface LogsHeadline {
  title: Copy;
  subtitle: Copy | null;
  tone: 'ok' | 'warn' | 'bad' | 'off';
  /** Offer the shortcut to the "Log to file" setting. */
  linkToSetting: boolean;
}

export interface DescribeLogsInput {
  connected: boolean;
  /** The gateway only serves logs it writes to a file, and that is off. */
  fileLoggingOff: boolean;
  /**
   * Why: 'config' when the configuration says logging to file is off, 'server' when the gateway
   * refused to serve logs. Only 'config' depends on the setting having been read.
   */
  fileOffReason?: 'config' | 'server';
  /** Whether the logging setting has been read: until it has, "off" is not known. */
  setting?: 'known' | 'checking' | 'failed';
  failed: boolean;
  /** The read error, shown once, in the subtitle. */
  errorMessage?: string;
  loading: boolean;
  live: boolean;
  lineCount: number;
  /** Time of the last successful read, already formatted; empty when never read. */
  lastRead: string;
}

export function describeLogs(input: DescribeLogsInput): LogsHeadline {
  const none = { linkToSetting: false };
  if (!input.connected) {
    return { title: { key: `${L}.title_disconnected` }, subtitle: null, tone: 'off', ...none };
  }
  if (input.fileLoggingOff) {
    const reason = input.fileOffReason ?? 'config';
    if (reason === 'config' && input.setting === 'checking') {
      return { title: { key: `${L}.title_checking` }, subtitle: null, tone: 'off', ...none };
    }
    if (reason === 'config' && input.setting === 'failed') {
      return {
        title: { key: `${L}.title_setting_failed` },
        subtitle: { key: `${L}.subtitle_setting_failed` },
        tone: 'bad',
        ...none,
      };
    }
    return {
      title: { key: `${L}.title_file_off` },
      subtitle: {
        key:
          reason === 'config'
            ? 'logs.cpa_file_logging_required_desc'
            : 'logs.file_logging_required_desc',
      },
      tone: 'warn',
      linkToSetting: true,
    };
  }
  if (input.failed) {
    return {
      title: { key: `${L}.title_failed` },
      subtitle: input.errorMessage
        ? { key: `${L}.subtitle_failed_detail`, values: { message: input.errorMessage } }
        : { key: `${L}.subtitle_failed` },
      tone: 'bad',
      ...none,
    };
  }
  if (input.loading && input.lineCount === 0) {
    return { title: { key: `${L}.title_loading` }, subtitle: null, tone: 'off', ...none };
  }
  const values = { count: input.lineCount, time: input.lastRead };
  const read = input.lastRead ? 'read' : 'unread';
  if (input.live) {
    return {
      title: { key: `${L}.title_live` },
      subtitle: { key: `${L}.subtitle_live_${read}`, values },
      tone: 'ok',
      ...none,
    };
  }
  return {
    title: { key: `${L}.title_paused` },
    subtitle: { key: `${L}.subtitle_paused_${read}`, values },
    tone: 'off',
    ...none,
  };
}
