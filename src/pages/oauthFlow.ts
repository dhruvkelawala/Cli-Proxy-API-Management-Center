/**
 * The OAuth page's read model: which sign-in providers are shown up front, and the one sentence
 * (plus the step of "browser → sign in → account added") that says where a sign-in stands.
 * React-free; copy is returned as i18n key descriptors.
 */

import type { Copy } from '@/features/clientProfiles/routing/routingOrder';

const O = 'auth_login.flow';

/** The everyday providers. Everything else (Kimi, Muse, xAI, Devin, plugins, Vertex) is under More. */
export const PRIMARY_OAUTH_PROVIDERS: ReadonlyArray<string> = ['anthropic', 'codex', 'antigravity'];

export type OAuthStep = 'idle' | 'browser' | 'signin' | 'added' | 'failed';

export interface AttemptLike {
  url?: string;
  status?: 'idle' | 'waiting' | 'success' | 'error';
  polling?: boolean;
}

export const splitOAuthProviders = <T extends { id: string }>(cards: ReadonlyArray<T>) => ({
  primary: PRIMARY_OAUTH_PROVIDERS.flatMap((id) => cards.filter((card) => card.id === id)),
  other: cards.filter((card) => !PRIMARY_OAUTH_PROVIDERS.includes(card.id)),
});

/** A sign-in that still needs the user (a link to open, a callback to paste, an error to read). */
export const attemptNeedsUser = (state: AttemptLike | undefined): boolean =>
  Boolean(
    state && (state.url || state.polling || state.status === 'waiting' || state.status === 'error')
  );

export const stepOf = (state: AttemptLike | undefined): OAuthStep => {
  if (!state) return 'idle';
  if (state.status === 'success') return 'added';
  if (state.status === 'error') return 'failed';
  if (state.url) return 'signin';
  if (state.polling || state.status === 'waiting') return 'browser';
  return 'idle';
};

const PRIORITY: Record<OAuthStep, number> = {
  added: 4,
  failed: 3,
  signin: 2,
  browser: 1,
  idle: 0,
};

export interface OAuthHeadline {
  title: Copy;
  subtitle: Copy;
  step: OAuthStep;
  /** The provider the sentence is about, when a sign-in is under way. */
  provider: string | null;
}

/**
 * "Sign in a new account." until a sign-in starts; then the step it is on. With several at once,
 * the most decisive wins: added, then failed, then waiting in the browser.
 */
export function describeOAuth(
  states: Readonly<Record<string, AttemptLike | undefined>>,
  nameOf: (provider: string) => string
): OAuthHeadline {
  let focus: { provider: string; step: OAuthStep } | null = null;
  for (const [provider, state] of Object.entries(states)) {
    const step = stepOf(state);
    if (step === 'idle') continue;
    if (!focus || PRIORITY[step] > PRIORITY[focus.step]) focus = { provider, step };
  }
  if (!focus) {
    return {
      title: { key: `${O}.title_idle` },
      subtitle: { key: `${O}.subtitle_idle` },
      step: 'idle',
      provider: null,
    };
  }
  const values = { name: nameOf(focus.provider) };
  return {
    title: { key: `${O}.title_${focus.step}`, values },
    subtitle: { key: `${O}.subtitle_${focus.step}`, values },
    step: focus.step,
    provider: focus.provider,
  };
}
