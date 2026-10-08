/**
 * Rule editor state (PolicySheet). React-free so the save/reload behaviour is testable:
 * a failed save or a Reload never touches the draft; only Discard and a fresh sheet do.
 */

import type { ClientProfilesFailure } from '@/stores/useClientProfilesStore';
import type { WritableClientProfilePolicy } from '@/types/clientProfiles';

export type PolicyEditorState = {
  draft: WritableClientProfilePolicy | null;
  saving: boolean;
  /** Credential being prepared for strict routing, by credential_ref. */
  enrolling: string | null;
  failure: ClientProfilesFailure | null;
  /** The list was re-read after a failure; the draft was kept. */
  reloaded: boolean;
};

export type PolicyEditorAction =
  | { type: 'select'; policy: WritableClientProfilePolicy }
  | { type: 'discard'; saved: WritableClientProfilePolicy | null }
  | { type: 'save_start' }
  | { type: 'save_failed'; failure: ClientProfilesFailure }
  | { type: 'save_done' }
  | { type: 'reload_done' }
  | { type: 'enroll_start'; credentialRef: string }
  | { type: 'enroll_failed'; failure: ClientProfilesFailure }
  | { type: 'enroll_done'; accountRef: string | null };

export const initialPolicyEditorState = (
  saved: WritableClientProfilePolicy | null
): PolicyEditorState => ({
  draft: saved,
  saving: false,
  enrolling: null,
  failure: null,
  reloaded: false,
});

export const policyEditorReducer = (
  state: PolicyEditorState,
  action: PolicyEditorAction
): PolicyEditorState => {
  switch (action.type) {
    case 'select':
      return { ...state, draft: action.policy };
    case 'discard':
      return { ...state, draft: action.saved };
    case 'save_start':
      return { ...state, saving: true, failure: null, reloaded: false };
    case 'save_failed':
      return { ...state, saving: false, failure: action.failure };
    case 'save_done':
      return { ...state, saving: false, failure: null };
    case 'reload_done':
      return { ...state, failure: null, reloaded: true };
    case 'enroll_start':
      return { ...state, enrolling: action.credentialRef, failure: null };
    case 'enroll_failed':
      return { ...state, enrolling: null, failure: action.failure };
    case 'enroll_done':
      return {
        ...state,
        enrolling: null,
        draft: action.accountRef ? { mode: 'only', accountRef: action.accountRef } : state.draft,
      };
    default:
      return state;
  }
};
