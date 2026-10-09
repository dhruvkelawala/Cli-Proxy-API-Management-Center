/**
 * The Management Center info page's sentence: whether we are connected, to which gateway
 * version, and whether a newer one exists (once checked). React-free; copy is returned as i18n
 * key descriptors.
 */

import type { Copy } from '@/features/clientProfiles/routing/routingOrder';

const S = 'system_info.flow';

const parseVersionSegments = (version?: string | null) => {
  if (!version) return null;
  const cleaned = version.trim().replace(/^v/i, '');
  if (!cleaned) return null;
  const parts = cleaned
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map((segment) => Number.parseInt(segment, 10))
    .filter(Number.isFinite);
  return parts.length ? parts : null;
};

/** 1 when `latest` is newer, -1 when older, 0 when equal, null when either is unreadable. */
export const compareVersions = (latest?: string | null, current?: string | null) => {
  const latestParts = parseVersionSegments(latest);
  const currentParts = parseVersionSegments(current);
  if (!latestParts || !currentParts) return null;
  const length = Math.max(latestParts.length, currentParts.length);
  for (let i = 0; i < length; i++) {
    const l = latestParts[i] || 0;
    const c = currentParts[i] || 0;
    if (l > c) return 1;
    if (l < c) return -1;
  }
  return 0;
};

export interface LatestCheck {
  latest: string;
  comparison: number | null;
}

export interface SystemHeadline {
  title: Copy;
  subtitle: Copy;
  tone: 'ok' | 'warn' | 'bad' | 'off';
}

export interface DescribeSystemInput {
  connection: 'connected' | 'connecting' | 'disconnected' | 'error';
  serverVersion: string | null;
  uiVersion: string;
  latest: LatestCheck | null;
}

/** "8.1.0" → "v8.1.0"; "v8.1.0" stays; a name such as "dev" is shown as it is. */
export const displayVersion = (version: string) => {
  const trimmed = version.trim();
  return /^\d/.test(trimmed) ? `v${trimmed}` : trimmed;
};

export function describeSystem({
  connection,
  serverVersion,
  uiVersion,
  latest,
}: DescribeSystemInput): SystemHeadline {
  const ui = { ui: uiVersion };
  if (connection === 'connecting') {
    return {
      title: { key: `${S}.title_connecting` },
      subtitle: { key: `${S}.subtitle_ui`, values: ui },
      tone: 'off',
    };
  }
  if (connection !== 'connected') {
    return {
      title: { key: `${S}.title_disconnected` },
      subtitle: { key: `${S}.subtitle_ui`, values: ui },
      tone: 'bad',
    };
  }
  if (!serverVersion?.trim()) {
    return {
      title: { key: `${S}.title_connected_unknown` },
      subtitle: { key: `${S}.subtitle_ui`, values: ui },
      tone: 'ok',
    };
  }
  const current = displayVersion(serverVersion);
  if (latest && latest.comparison !== null && latest.comparison > 0) {
    return {
      title: { key: `${S}.title_update`, values: { latest: displayVersion(latest.latest) } },
      subtitle: { key: `${S}.subtitle_update`, values: { current, ...ui } },
      tone: 'warn',
    };
  }
  if (latest && latest.comparison !== null && latest.comparison <= 0) {
    return {
      title: { key: `${S}.title_latest`, values: { current } },
      subtitle: { key: `${S}.subtitle_ui`, values: ui },
      tone: 'ok',
    };
  }
  return {
    title: { key: `${S}.title_connected`, values: { current } },
    subtitle: { key: `${S}.subtitle_ui`, values: ui },
    tone: 'ok',
  };
}
