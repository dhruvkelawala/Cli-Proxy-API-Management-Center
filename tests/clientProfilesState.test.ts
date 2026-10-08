import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { apiClient } from '@/services/api/client';
import { classifyClientProfileError, clientProfilesApi } from '@/services/api/clientProfiles';
import { useClientProfilesStore } from '@/stores/useClientProfilesStore';
import { sharedBandWroteConfig } from '@/features/clientProfiles/sharedBand';
import type { SharedRoutingBandState } from '@/features/config/routing/SharedRoutingBand';
import {
  buildPoolPreview,
  buildProfileRows,
  clientKeyFingerprint,
  clientKeyListSignature,
  effectiveKeySelection,
  linkableClientKeys,
  resolveKeyToLink,
  countAutomaticProfiles,
  credentialRefForAuthFile,
  findAccountForAuthFile,
  pinnedProfilesFor,
  planPinChanges,
  policiesWithEdit,
  resolveTargetState,
  targetOptionsFor,
} from '@/features/clientProfiles/model';
import type { AuthFileItem } from '@/types';
import type {
  ClientProfileAccount,
  ClientProfilesCapabilities,
  ClientProfilesSnapshot,
} from '@/types/clientProfiles';

const spies: Array<{ mockRestore(): void }> = [];
const track = <T extends { mockRestore(): void }>(spy: T) => {
  spies.push(spy);
  return spy;
};
afterEach(() => spies.splice(0).forEach((spy) => spy.mockRestore()));

const apiError = (status: number, code?: string) =>
  Object.assign(new Error(code ?? 'Request failed'), {
    name: 'ApiError',
    status,
    apiCode: code,
    data: code ? { error: { code } } : undefined,
  });

const A_REF = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B_REF = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const GONE_REF = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const P_MINI = '10000000-0000-4000-8000-000000000001';
const P_MBP = '10000000-0000-4000-8000-000000000002';
const P_MBP_B = '10000000-0000-4000-8000-000000000003';

const files: AuthFileItem[] = [
  {
    id: 'claude-a.json',
    name: 'claude-a.json',
    type: 'claude',
    status: 'active',
    note: 'Claude A',
    priority: 0,
  },
  {
    id: 'claude-b.json',
    name: 'claude-b.json',
    type: 'claude',
    status: 'disabled',
    disabled: true,
    note: 'Claude B',
  },
  { id: 'codex.json', name: 'codex.json', type: 'codex', status: 'pending', note: 'Codex' },
];

const account = (
  file: AuthFileItem,
  overrides: Partial<ClientProfileAccount>
): ClientProfileAccount => ({
  credentialRef: credentialRefForAuthFile(file) as string,
  accountRef: null,
  provider: String(file.type),
  label: `${file.type} credential`,
  available: true,
  state: 'available',
  enrollmentSupported: true,
  targetSupported: true,
  ...overrides,
});

const accounts: ClientProfileAccount[] = [
  account(files[0], { accountRef: A_REF }),
  account(files[1], { accountRef: B_REF, available: false, state: 'unavailable' }),
  account(files[2], { accountRef: null, state: 'not_enrolled' }),
  {
    credentialRef: 'credential_config_key',
    accountRef: null,
    provider: 'claude',
    label: 'claude credential',
    available: true,
    state: 'not_enrolled',
    enrollmentSupported: false,
    targetSupported: false,
  },
];

const snapshot: ClientProfilesSnapshot = {
  revision: '"r1"',
  profiles: [
    {
      profileRef: P_MINI,
      label: 'Mini · T3 Claude',
      revision: 1,
      policies: { claude: { mode: 'automatic' }, codex: { mode: 'automatic' } },
    },
    {
      profileRef: P_MBP,
      label: 'MacBook · T3 Claude',
      revision: 3,
      policies: { claude: { mode: 'only', accountRef: GONE_REF }, codex: { mode: 'automatic' } },
    },
    {
      profileRef: P_MBP_B,
      label: 'MacBook · T3 Claude B',
      revision: 2,
      policies: { claude: { mode: 'only', accountRef: B_REF }, codex: { mode: 'automatic' } },
    },
  ],
  keys: [{ keyRef: 'k1', label: 'MacBook key', profileRef: P_MBP_B, revision: 1 }],
  accounts,
  targetStates: {
    [P_MINI]: { claude: 'automatic', codex: 'automatic' },
    [P_MBP]: { claude: 'target_removed', codex: 'automatic' },
    [P_MBP_B]: { claude: 'target_unavailable', codex: 'automatic' },
  },
};

const capabilities: ClientProfilesCapabilities = {
  contractVersion: 1,
  management: true,
  enforcement: false,
  strictRequests: 'rejected',
  providers: ['claude', 'codex'],
  modes: ['automatic', 'only'],
  sessionBehavior: 'fresh_session_required',
  bindingRequires: ['websocket_auth_enabled'],
  enrollmentStores: ['file'],
  enrollmentStorage: ['metadata'],
  unsupported: [],
};

const connect = (base: string) => apiClient.setConfig({ apiBase: base, managementKey: 'fixture' });

beforeEach(() => {
  connect('https://first.invalid');
  useClientProfilesStore.getState().reset();
});
afterEach(() => {
  useClientProfilesStore.getState().reset();
  apiClient.setConfig({ apiBase: '', managementKey: '' });
});

describe('client profiles store: capability and loading', () => {
  test('supported backend with enforcement off loads the snapshot', async () => {
    track(spyOn(clientProfilesApi, 'probe').mockResolvedValue({ supported: true, capabilities }));
    track(spyOn(clientProfilesApi, 'list').mockResolvedValue(snapshot));
    await useClientProfilesStore.getState().load();
    const state = useClientProfilesStore.getState();
    expect(state.status).toBe('ready');
    expect(state.capabilities?.enforcement).toBe(false);
    expect(state.snapshot?.profiles).toHaveLength(3);
  });

  test('unsupported backend never lists or writes', async () => {
    track(
      spyOn(clientProfilesApi, 'probe').mockResolvedValue({ supported: false, reason: 'not_found' })
    );
    const list = track(spyOn(clientProfilesApi, 'list'));
    await useClientProfilesStore.getState().load();
    expect(useClientProfilesStore.getState().status).toBe('unsupported');
    expect(list).not.toHaveBeenCalled();
    const write = track(spyOn(clientProfilesApi, 'createProfile'));
    const outcome = await useClientProfilesStore.getState().mutate((revision) =>
      clientProfilesApi.createProfile(revision, {
        label: 'x',
        policies: { claude: { mode: 'automatic' }, codex: { mode: 'automatic' } },
      })
    );
    expect(outcome).toMatchObject({ ok: false, kind: 'unsupported' });
    expect(write).not.toHaveBeenCalled();
  });

  test('a list 404 after a successful probe is still Unsupported', async () => {
    track(spyOn(clientProfilesApi, 'probe').mockResolvedValue({ supported: true, capabilities }));
    track(spyOn(clientProfilesApi, 'list').mockRejectedValue(apiError(404, 'not_found')));
    await useClientProfilesStore.getState().load();
    expect(useClientProfilesStore.getState().status).toBe('unsupported');
  });

  test('reload_pending is an error state with the contract code, not Unsupported', async () => {
    track(spyOn(clientProfilesApi, 'probe').mockResolvedValue({ supported: true, capabilities }));
    track(spyOn(clientProfilesApi, 'list').mockRejectedValue(apiError(409, 'reload_pending')));
    await useClientProfilesStore.getState().load();
    const state = useClientProfilesStore.getState();
    expect(state.status).toBe('error');
    expect(state.loadFailure?.kind).toBe('reload_pending');
  });

  test('a load that completes after a connection switch is dropped', async () => {
    track(spyOn(clientProfilesApi, 'probe').mockResolvedValue({ supported: true, capabilities }));
    let release: (value: ClientProfilesSnapshot) => void = () => {};
    track(
      spyOn(clientProfilesApi, 'list').mockImplementation(
        () => new Promise<ClientProfilesSnapshot>((resolve) => (release = resolve))
      )
    );
    const pending = useClientProfilesStore.getState().load();
    await Promise.resolve();
    await Promise.resolve();
    // Switch to another gateway and back (ABA): the old response must still be ignored.
    connect('https://second.invalid');
    connect('https://first.invalid');
    release(snapshot);
    await pending;
    expect(useClientProfilesStore.getState().snapshot).toBeNull();
  });

  test('reset (logout) drops in-flight results', async () => {
    track(spyOn(clientProfilesApi, 'probe').mockResolvedValue({ supported: true, capabilities }));
    let release: (value: ClientProfilesSnapshot) => void = () => {};
    track(
      spyOn(clientProfilesApi, 'list').mockImplementation(
        () => new Promise<ClientProfilesSnapshot>((resolve) => (release = resolve))
      )
    );
    const pending = useClientProfilesStore.getState().load();
    await Promise.resolve();
    useClientProfilesStore.getState().reset();
    release(snapshot);
    await pending;
    expect(useClientProfilesStore.getState().status).toBe('idle');
    expect(useClientProfilesStore.getState().snapshot).toBeNull();
  });
});

describe('client profiles store: writes', () => {
  const ready = async () => {
    track(spyOn(clientProfilesApi, 'probe').mockResolvedValue({ supported: true, capabilities }));
    const list = track(spyOn(clientProfilesApi, 'list').mockResolvedValue(snapshot));
    await useClientProfilesStore.getState().load();
    return list;
  };
  const policies = {
    claude: { mode: 'automatic' as const },
    codex: { mode: 'automatic' as const },
  };

  test('a successful write uses the list ETag, then re-reads from the server', async () => {
    const list = await ready();
    const update = track(
      spyOn(clientProfilesApi, 'updateProfile').mockResolvedValue({
        revision: '"r2"',
        result: null,
        sessionBehavior: 'fresh_session_required',
      })
    );
    list.mockResolvedValue({ ...snapshot, revision: '"r2"' });
    const outcome = await useClientProfilesStore
      .getState()
      .mutate((revision) =>
        clientProfilesApi.updateProfile(revision, P_MBP, { label: 'MacBook · T3 Claude', policies })
      );
    expect(update.mock.calls[0][0]).toBe('"r1"');
    expect(outcome).toMatchObject({ ok: true, sessionBehavior: 'fresh_session_required' });
    expect(list).toHaveBeenCalledTimes(2);
    expect(useClientProfilesStore.getState().snapshot?.revision).toBe('"r2"');
  });

  test('a failed save reports the failure and leaves the saved snapshot untouched', async () => {
    const list = await ready();
    track(
      spyOn(clientProfilesApi, 'updateProfile').mockRejectedValue(
        apiError(422, 'target_unavailable')
      )
    );
    const before = useClientProfilesStore.getState().snapshot;
    const outcome = await useClientProfilesStore
      .getState()
      .mutate((revision) =>
        clientProfilesApi.updateProfile(revision, P_MBP, { label: 'x', policies })
      );
    expect(outcome).toMatchObject({ ok: false, kind: 'target_invalid' });
    expect(useClientProfilesStore.getState().snapshot).toBe(before);
    expect(list).toHaveBeenCalledTimes(1);
    expect(useClientProfilesStore.getState().mutating).toBe(false);
  });

  test('412 stale is classified so the editor can keep the draft and offer Reload', async () => {
    await ready();
    track(
      spyOn(clientProfilesApi, 'updateProfile').mockRejectedValue(apiError(412, 'stale_revision'))
    );
    const outcome = await useClientProfilesStore
      .getState()
      .mutate((revision) =>
        clientProfilesApi.updateProfile(revision, P_MBP, { label: 'x', policies })
      );
    expect(outcome).toMatchObject({ ok: false, kind: 'stale', error: { status: 412 } });
    expect(useClientProfilesStore.getState().snapshot?.revision).toBe('"r1"');
  });

  test('a write that completes after a connection switch is not applied', async () => {
    const list = await ready();
    let release: () => void = () => {};
    track(
      spyOn(clientProfilesApi, 'updateProfile').mockImplementation(
        () =>
          new Promise((resolve) => {
            release = () =>
              resolve({
                revision: '"other"',
                result: null,
                sessionBehavior: 'fresh_session_required',
              });
          })
      )
    );
    const pending = useClientProfilesStore
      .getState()
      .mutate((revision) =>
        clientProfilesApi.updateProfile(revision, P_MBP, { label: 'x', policies })
      );
    connect('https://second.invalid');
    release();
    expect(await pending).toMatchObject({ ok: false, kind: 'aborted' });
    expect(list).toHaveBeenCalledTimes(1);
    expect(useClientProfilesStore.getState().snapshot?.revision).toBe('"r1"');
  });

  test('enrollment refreshes the inventory on success', async () => {
    const list = await ready();
    track(
      spyOn(clientProfilesApi, 'enroll').mockResolvedValue({
        credentialRef: 'c',
        accountRef: A_REF,
      })
    );
    const outcome = await useClientProfilesStore.getState().enroll('c');
    expect(outcome).toMatchObject({ ok: true, result: A_REF });
    expect(list).toHaveBeenCalledTimes(2);
  });

  test('contract errors map to the explanations the UI shows', () => {
    const kind = (status: number, code: string | null) =>
      classifyClientProfileError({ status, code, field: null });
    expect(kind(428, 'revision_required')).toBe('stale');
    expect(kind(409, 'profile_in_use')).toBe('profile_in_use');
    expect(kind(409, 'last_client_key')).toBe('last_client_key');
    expect(kind(409, 'reload_pending')).toBe('reload_pending');
    expect(kind(422, 'websocket_auth_required')).toBe('websocket_auth_required');
    expect(kind(422, 'key_removed')).toBe('key_missing');
    expect(kind(409, 'already_enrolled')).toBe('already_enrolled');
    expect(kind(503, 'activation_unavailable')).toBe('activation_unavailable');
    expect(kind(500, 'persistence_failed')).toBe('persistence');
  });
});

describe('client routes presentation model', () => {
  test('Automatic shows the eligible pool with illustrative shares; disabled accounts excluded', () => {
    const pool = buildPoolPreview('claude', files, 'round-robin');
    expect(pool.known).toBe(true);
    if (!pool.known) return;
    expect(pool.candidates.map((member) => [member.label, member.sharePercent])).toEqual([
      ['Claude A', 100],
    ]);
    expect(pool.members.find((member) => member.label === 'Claude B')?.reason).toBe('disabled');
  });

  test('unknown availability stays unknown; a missing list or strategy is an unknown pool', () => {
    const codex = buildPoolPreview('codex', files, 'fill-first');
    expect(codex.known && codex.hasUnknown).toBe(true);
    expect(buildPoolPreview('claude', null, 'round-robin')).toEqual({ known: false });
    expect(buildPoolPreview('claude', files, null)).toEqual({ known: false });
  });

  test('Only cells show configured target state; disabled and deleted targets will fail', () => {
    const rows = buildProfileRows(snapshot, files, 'round-robin');
    const [mini, removed, disabled] = rows;
    expect(mini.cells.claude).toMatchObject({ kind: 'automatic', willFail: false });
    expect(removed.cells.claude).toMatchObject({
      kind: 'only',
      state: 'target_removed',
      account: null,
      willFail: true,
    });
    expect(disabled.cells.claude).toMatchObject({
      kind: 'only',
      state: 'target_unavailable',
      accountLabel: 'Claude B',
      willFail: true,
    });
    expect(disabled.cells.codex.kind).toBe('automatic');
    expect(disabled.keyCount).toBe(1);
    expect(disabled.hasOnlyRule).toBe(true);
    expect(countAutomaticProfiles(snapshot)).toBe(3);
  });

  test('an Automatic pool with no eligible account will fail', () => {
    const allOff = files.map((file) => ({ ...file, disabled: true }));
    const [mini] = buildProfileRows(snapshot, allOff, 'round-robin');
    expect(mini.cells.claude).toMatchObject({ kind: 'automatic', willFail: true });
  });

  test('local resolution mirrors the backend for drafts', () => {
    const only = (accountRef: string) => ({ mode: 'only' as const, accountRef });
    expect(resolveTargetState('claude', only(A_REF), accounts)).toBe('available');
    expect(resolveTargetState('claude', only(B_REF), accounts)).toBe('target_unavailable');
    expect(resolveTargetState('codex', only(A_REF), accounts)).toBe('provider_mismatch');
    expect(resolveTargetState('claude', only(GONE_REF), accounts)).toBe('target_removed');
    const duplicated = [...accounts, { ...accounts[0], credentialRef: 'copy' }];
    expect(resolveTargetState('claude', only(A_REF), duplicated)).toBe('duplicate_account_ref');
  });

  test('editor options: unenrolled can be prepared, unsupported is not selectable', () => {
    const claude = targetOptionsFor('claude', accounts, files);
    expect(claude.map((option) => [option.label, option.status, option.selectable])).toEqual([
      ['Claude A', 'ready', true],
      ['Claude B', 'will_fail', true],
      ['claude credential', 'unsupported', false],
    ]);
    const codex = targetOptionsFor('codex', accounts, files);
    expect(codex[0]).toMatchObject({
      label: 'Codex',
      status: 'needs_enrollment',
      selectable: false,
    });
  });

  test('a one-cell edit sends both mandatory rules; unknown saved rules block the write', () => {
    expect(
      policiesWithEdit(snapshot.profiles[0], 'claude', { mode: 'only', accountRef: A_REF })
    ).toEqual({
      claude: { mode: 'only', accountRef: A_REF },
      codex: { mode: 'automatic' },
    });
    const odd = {
      ...snapshot.profiles[0],
      policies: {
        claude: { mode: 'automatic' as const },
        codex: { mode: 'unknown' as const, rawMode: 'prefer' },
      },
    };
    expect(policiesWithEdit(odd, 'claude', { mode: 'automatic' })).toBeNull();
  });

  test('accounts link to the profiles pinned to them and plan pin changes per profile', () => {
    const b = findAccountForAuthFile(files[1], accounts) as ClientProfileAccount;
    expect(b.accountRef).toBe(B_REF);
    expect(pinnedProfilesFor(b, snapshot).map((pin) => pin.profile.label)).toEqual([
      'MacBook · T3 Claude B',
    ]);
    const plan = planPinChanges(b, snapshot, new Set([P_MINI]));
    expect(plan.map((change) => [change.profile.label, change.policies?.claude])).toEqual([
      ['Mini · T3 Claude', { mode: 'only', accountRef: B_REF }],
      ['MacBook · T3 Claude B', { mode: 'automatic' }],
    ]);
    const unenrolled = findAccountForAuthFile(files[2], accounts) as ClientProfileAccount;
    expect(pinnedProfilesFor(unenrolled, snapshot)).toEqual([]);
    expect(planPinChanges(unenrolled, snapshot, new Set([P_MINI]))).toEqual([]);
  });

  test('the key picker never links a different key when the list shifts under it', () => {
    const [k1, k2, k3] = ['sk-fixture-one', 'sk-fixture-two', 'sk-fixture-three'];
    const before = [k1, k2, k3];
    const picked = clientKeyFingerprint(k2);
    const selection = { fingerprint: picked, listSignature: clientKeyListSignature(before) };
    expect(effectiveKeySelection(selection, before, null)).toBe(picked);
    expect(resolveKeyToLink(picked, before, null)).toBe(k2);

    // k1 revoked elsewhere: position 1 now holds k3, but the picked key is still k2.
    const shifted = [k2, k3];
    expect(resolveKeyToLink(picked, shifted, null)).toBe(k2);
    expect(effectiveKeySelection(selection, shifted, null)).toBe('');

    // k2 itself removed or rotated: refuse rather than link whatever sits there now.
    expect(resolveKeyToLink(picked, [k1, k3], null)).toBeNull();
    // k2 linked to a profile meanwhile (e.g. from another tab): refuse as well.
    expect(resolveKeyToLink(picked, before, new Set([picked]))).toBeNull();
    expect(effectiveKeySelection(selection, before, new Set([picked]))).toBe('');
    // An identical re-fetch keeps the choice.
    expect(effectiveKeySelection(selection, [...before], null)).toBe(picked);
  });

  test('keys already linked to any profile are not offered; unknown links offer all', () => {
    const keys = ['sk-a', ' sk-b ', 'sk-a', ''];
    const linked = new Set([clientKeyFingerprint('sk-b')]);
    expect(linkableClientKeys(keys, linked).map((choice) => choice.value)).toEqual(['sk-a']);
    expect(linkableClientKeys(keys, null).map((choice) => choice.value)).toEqual([
      'sk-a',
      ' sk-b ',
    ]);
  });

  test('a shared band save that wrote the config is reported once', () => {
    const base: SharedRoutingBandState = {
      saved: null,
      dirty: false,
      attention: false,
      save: { phase: 'idle' },
    };
    const saving = { ...base, save: { phase: 'saving' as const } };
    const saved = { ...base, save: { phase: 'saved' as const } };
    expect(sharedBandWroteConfig(null, base)).toBe(false);
    expect(sharedBandWroteConfig(base, saving)).toBe(false);
    expect(sharedBandWroteConfig(saving, saved)).toBe(true);
    // Same save object re-reported (e.g. a dirty flag change): not another write.
    expect(sharedBandWroteConfig(saved, { ...saved, dirty: true })).toBe(false);
    const reloadFailed = { ...base, save: { phase: 'reload_failed' as const } };
    expect(sharedBandWroteConfig(saving, reloadFailed)).toBe(true);
    const failed = { ...base, save: { phase: 'failed' as const, message: 'x' } };
    expect(sharedBandWroteConfig(saving, failed)).toBe(false);
  });

  test('key fingerprints follow the contract (SHA-256 of the trimmed value)', () => {
    expect(clientKeyFingerprint(' abc ')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });
});
