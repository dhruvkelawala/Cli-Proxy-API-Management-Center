/**
 * The AI Providers and Quick Start pages' read model: which providers have keys (shown up front)
 * and which do not (behind More), plus the one sentence that says where things stand. React-free;
 * copy is returned as i18n key descriptors so it can be tested without rendering.
 */

import type { Copy } from '@/features/clientProfiles/routing/routingOrder';
import type { ProviderBrand } from './types';

const P = 'providersPage.flow';

export interface HeadlineGroup {
  id: ProviderBrand;
  resources: ReadonlyArray<{ disabled: boolean }>;
}

export interface ProvidersHeadline {
  title: Copy;
  subtitle: Copy | null;
  tone: 'ok' | 'warn' | 'bad' | 'off';
}

export interface DescribeProvidersInput {
  groups: ReadonlyArray<HeadlineGroup> | null;
  loading: boolean;
  failed: boolean;
  nameOf: (brand: ProviderBrand) => string;
  join: (names: string[]) => string;
}

export const countKeys = (groups: ReadonlyArray<HeadlineGroup>) => {
  let total = 0;
  let disabled = 0;
  for (const group of groups) {
    total += group.resources.length;
    disabled += group.resources.filter((resource) => resource.disabled).length;
  }
  return { total, disabled, active: total - disabled };
};

/** Providers with at least one key, in their catalogue order, and the rest. */
export const splitProviderGroups = <G extends HeadlineGroup>(groups: ReadonlyArray<G>) => ({
  configured: groups.filter((group) => group.resources.length > 0),
  empty: groups.filter((group) => group.resources.length === 0),
});

/** "3 provider keys configured." / "No API keys yet." and what that means. */
export function describeProviders({
  groups,
  loading,
  failed,
  nameOf,
  join,
}: DescribeProvidersInput): ProvidersHeadline {
  if (!groups) {
    if (failed) return { title: { key: `${P}.title_failed` }, subtitle: null, tone: 'bad' };
    if (loading) return { title: { key: `${P}.title_loading` }, subtitle: null, tone: 'off' };
  }
  const list = groups ?? [];
  const { total, disabled, active } = countKeys(list);
  if (total === 0) {
    return {
      title: { key: `${P}.title_none` },
      subtitle: { key: `${P}.subtitle_none` },
      tone: failed ? 'bad' : 'off',
    };
  }
  const names = join(splitProviderGroups(list).configured.map((group) => nameOf(group.id)));
  let subtitle: Copy;
  if (active === 0) subtitle = { key: `${P}.subtitle_all_off`, values: { names } };
  else if (disabled > 0)
    subtitle = { key: `${P}.subtitle_some_off`, values: { names, count: disabled } };
  else subtitle = { key: `${P}.subtitle_all_on`, values: { names } };
  return {
    title: { key: `${P}.title_keys`, values: { count: total } },
    subtitle,
    tone: failed ? 'bad' : active === 0 ? 'warn' : 'ok',
  };
}

/** Quick Start: the sponsor is either not set up, set up, or set up but turned off. */
export function describeQuickStart(input: {
  name: string;
  resource: { disabled: boolean } | null;
  loading: boolean;
  failed: boolean;
}): ProvidersHeadline {
  const values = { name: input.name };
  if (!input.resource) {
    if (input.failed) return { title: { key: `${P}.title_failed` }, subtitle: null, tone: 'bad' };
    if (input.loading) return { title: { key: `${P}.title_loading` }, subtitle: null, tone: 'off' };
    return {
      title: { key: `${P}.quick_title_none`, values },
      subtitle: { key: `${P}.quick_subtitle_none`, values },
      tone: 'off',
    };
  }
  if (input.resource.disabled) {
    return {
      title: { key: `${P}.quick_title_off`, values },
      subtitle: { key: `${P}.quick_subtitle_off`, values },
      tone: 'warn',
    };
  }
  return {
    title: { key: `${P}.quick_title_ready`, values },
    subtitle: { key: `${P}.quick_subtitle_ready`, values },
    tone: 'ok',
  };
}
