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
  /** Increasing number stamped when the attempt starts; later attempts win the headline. */
  startedAt?: number;
}

export const splitOAuthProviders = <T extends { id: string }>(cards: ReadonlyArray<T>) => ({
  primary: PRIMARY_OAUTH_PROVIDERS.flatMap((id) => cards.filter((card) => card.id === id)),
  other: cards.filter((card) => !PRIMARY_OAUTH_PROVIDERS.includes(card.id)),
});

/**
 * A sign-in still under way (preparing, or waiting for the browser). An error or a finished
 * sign-in is not pending: it can be read or dismissed without holding More open.
 */
export const attemptPending = (state: AttemptLike | undefined): boolean =>
  Boolean(
    state &&
    state.status !== 'error' &&
    state.status !== 'success' &&
    (state.polling || state.status === 'waiting')
  );

export const stepOf = (state: AttemptLike | undefined): OAuthStep => {
  if (!state) return 'idle';
  if (state.status === 'success') return 'added';
  if (state.status === 'error') return 'failed';
  if (state.url) return 'signin';
  if (state.polling || state.status === 'waiting') return 'browser';
  return 'idle';
};

export interface OAuthHeadline {
  title: Copy;
  subtitle: Copy;
  step: OAuthStep;
  /** The provider the sentence is about, when a sign-in is under way. */
  provider: string | null;
}

/**
 * "Sign in a new account." until a sign-in starts; then the step it is on. With several, a sign-in
 * still under way wins over a finished or failed one, and among equals the latest started wins,
 * so an old result never hides what the user is doing now.
 */
export function describeOAuth(
  states: Readonly<Record<string, AttemptLike | undefined>>,
  nameOf: (provider: string) => string
): OAuthHeadline {
  let focus: { provider: string; step: OAuthStep; active: boolean; at: number } | null = null;
  for (const [provider, state] of Object.entries(states)) {
    const step = stepOf(state);
    if (step === 'idle') continue;
    const candidate = {
      provider,
      step,
      active: step === 'browser' || step === 'signin',
      at: state?.startedAt ?? 0,
    };
    if (
      !focus ||
      (candidate.active && !focus.active) ||
      (candidate.active === focus.active && candidate.at > focus.at)
    ) {
      focus = candidate;
    }
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
