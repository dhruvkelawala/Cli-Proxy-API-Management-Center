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
  failed: boolean;
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
    return {
      title: { key: `${L}.title_file_off` },
      subtitle: { key: `${L}.subtitle_file_off` },
      tone: 'warn',
      linkToSetting: true,
    };
  }
  if (input.failed) {
    return {
      title: { key: `${L}.title_failed` },
      subtitle: { key: `${L}.subtitle_failed` },
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
