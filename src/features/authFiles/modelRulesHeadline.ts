/**
 * Sentences for the two model-rule editors (#/auth-files/oauth-excluded and
 * #/auth-files/oauth-model-alias). React-free; copy is returned as i18n key descriptors.
 */

import type { Copy } from '@/features/clientProfiles/routing/routingOrder';

export type ModelRuleKind = 'excluded' | 'alias';

const PREFIX: Record<ModelRuleKind, string> = {
  excluded: 'oauth_excluded.flow',
  alias: 'oauth_model_alias.flow',
};

export interface ModelRuleHeadline {
  title: Copy;
  subtitle: Copy;
}

/** Complete alias rows only: a source model and the alias clients ask for. */
export const countCompleteAliases = (
  rows: ReadonlyArray<{ name?: string; alias?: string }>
): number => rows.filter((row) => row.name?.trim() && row.alias?.trim()).length;

export function describeModelRuleEditor(input: {
  kind: ModelRuleKind;
  /** Display name of the chosen provider; empty while none is chosen. */
  provider: string;
  count: number;
  dirty: boolean;
}): ModelRuleHeadline {
  const P = PREFIX[input.kind];
  const provider = input.provider.trim();
  if (!provider) {
    return { title: { key: `${P}.title_pick` }, subtitle: { key: `${P}.subtitle_pick` } };
  }
  const values = { provider, count: input.count };
  return {
    title: { key: input.count > 0 ? `${P}.title_some` : `${P}.title_none`, values },
    subtitle: { key: input.dirty ? `${P}.subtitle_dirty` : `${P}.subtitle_saved`, values },
  };
}
