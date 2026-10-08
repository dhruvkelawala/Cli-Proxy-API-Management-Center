/**
 * PROTOTYPE (throwaway). Shared copy/tone helpers so every variant tells the same honest story.
 * Hard-coded English on purpose.
 */
import type { PolicyOutcome, ProtoAccount } from './prototypeModel';

export type Tone = 'ok' | 'unknown' | 'bad' | 'off';

export const accountTone = (a: ProtoAccount): Tone =>
  !a.enabled
    ? 'off'
    : a.availability === 'unavailable'
      ? 'bad'
      : a.availability === 'unknown'
        ? 'unknown'
        : 'ok';

/** One-sentence consequence of a policy, used verbatim by every variant so copy stays honest. */
export function consequenceText(outcome: PolicyOutcome, provider: string): string {
  if (outcome.kind === 'pool') {
    if (outcome.fails)
      return `No ${provider} account is eligible, so these requests fail until one is enabled or recovers.`;
    return `Uses the shared ${provider} pool. The shared strategy picks an account for each new assignment.`;
  }
  const name = outcome.account?.label ?? 'the removed account';
  if (outcome.fails)
    return `${name} is ${outcome.state === 'missing' ? 'gone' : outcome.state}. These requests fail; no other account is used instead.`;
  return `Every ${provider} request from this profile goes to ${name}. If ${name} becomes unavailable, requests fail; another account never substitutes.`;
}
