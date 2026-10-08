import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { apiClient } from '@/services/api/client';
import {
  clientProfilesApi,
  normalizeClientProfilesSnapshot,
  parseLinkedKeyFingerprints,
  readClientProfileError,
  serializeClientProfilePolicies,
} from '@/services/api/clientProfiles';

const spies: Array<{ mockRestore(): void }> = [];
const mock = (method: 'get' | 'put' | 'post' | 'delete' | 'getRaw', value: unknown = {}) => {
  const spy = spyOn(apiClient, method).mockResolvedValue(value as never);
  spies.push(spy);
  return spy;
};
afterEach(() => spies.splice(0).forEach((spy) => spy.mockRestore()));

const apiError = (status: number, code?: string, field?: string) =>
  Object.assign(new Error(code ?? 'Request failed'), {
    name: 'ApiError',
    status,
    apiCode: code,
    data: code ? { error: { code, ...(field ? { field } : {}) } } : undefined,
  });

const PROFILE_REF = '11111111-1111-4111-8111-111111111111';
const KEY_REF = '22222222-2222-4222-8222-222222222222';
const ACCOUNT_REF = '33333333-3333-4333-8333-333333333333';
const ETAG = '"abc123"';

const listBody = {
  revision: ETAG,
  profiles: [
    {
      profile_ref: PROFILE_REF,
      label: 'T3 Claude',
      revision: 2,
      policies: {
        claude: { mode: 'only', account_ref: ACCOUNT_REF },
        codex: { mode: 'automatic' },
      },
    },
  ],
  keys: [
    {
      key_ref: KEY_REF,
      label: 'T3 desktop key',
      profile_ref: PROFILE_REF,
      revision: 1,
      fingerprint: 'must-not-leak',
    },
  ],
  accounts: [
    {
      credential_ref: 'credential_opaque',
      account_ref: ACCOUNT_REF,
      provider: 'claude',
      label: 'Work account',
      available: true,
      state: 'available',
      enrollment_supported: true,
      target_supported: true,
      access_token: 'must-not-leak',
    },
    {
      credential_ref: 'credential_other',
      provider: 'codex',
      label: 'Codex seat',
      available: true,
      state: 'not_enrolled',
      enrollment_supported: true,
      target_supported: true,
    },
  ],
  target_states: { [PROFILE_REF]: { claude: 'available', codex: 'automatic', home: 'x' } },
};

describe('client profile capability probe', () => {
  test('reports a supported contract with enforcement off as returned by CPA-002', async () => {
    const get = mock('get', {
      contract_version: 1,
      management: true,
      enforcement: false,
      strict_requests: 'rejected',
      providers: ['claude', 'codex'],
      modes: ['automatic', 'only'],
      session_behavior: 'fresh_session_required',
      binding_requires: ['websocket_auth_enabled'],
      enrollment_stores: ['file'],
      enrollment_storage: ['metadata'],
      unsupported: ['prefer', 'fallback'],
    });
    const support = await clientProfilesApi.probe();
    expect(get).toHaveBeenCalledWith('/client-profiles/capabilities');
    expect(support).toEqual({
      supported: true,
      capabilities: {
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
        unsupported: ['prefer', 'fallback'],
      },
    });
  });

  test('CPA-003 enforcement (capabilities fixture from plans/client-profile-api.md)', async () => {
    mock('get', {
      contract_version: 1,
      management: true,
      enforcement: true,
      strict_requests: 'enforced',
      providers: ['claude', 'codex'],
      modes: ['automatic', 'only'],
      session_behavior: 'fresh_session_required',
      binding_requires: ['websocket_auth_enabled'],
      enrollment_stores: ['file'],
      enrollment_storage: ['metadata', 'native_claude', 'native_codex'],
      unsupported: ['home_strict', 'prefer', 'fallback'],
    });
    const support = await clientProfilesApi.probe();
    expect(support.supported && support.capabilities).toMatchObject({
      enforcement: true,
      strictRequests: 'enforced',
    });
  });

  test('an older backend (404) is unsupported instead of inventing local policies', async () => {
    spies.push(spyOn(apiClient, 'get').mockRejectedValue(apiError(404, 'not_found')));
    expect(await clientProfilesApi.probe()).toEqual({ supported: false, reason: 'not_found' });
  });

  test('an unknown contract version is unsupported; enforcement is never assumed true', async () => {
    mock('get', { contract_version: 2, management: true, enforcement: true });
    expect(await clientProfilesApi.probe()).toEqual({
      supported: false,
      reason: 'incompatible_contract',
    });
    mock('get', { contract_version: 1, management: true, enforcement: 'yes' });
    const support = await clientProfilesApi.probe();
    expect(support.supported && support.capabilities.enforcement).toBe(false);
  });

  test('other failures propagate so the page shows an error, not Unsupported', async () => {
    spies.push(spyOn(apiClient, 'get').mockRejectedValue(apiError(500, 'persistence_failed')));
    await expect(clientProfilesApi.probe()).rejects.toMatchObject({ status: 500 });
  });
});

describe('client profile list normalization', () => {
  test('normalizes snake_case and drops fields outside the safe projection', async () => {
    const getRaw = mock('getRaw', { data: listBody, headers: { etag: '"header"' } });
    const snapshot = await clientProfilesApi.list();
    expect(getRaw).toHaveBeenCalledWith('/client-profiles');
    expect(snapshot).toEqual({
      revision: ETAG,
      profiles: [
        {
          profileRef: PROFILE_REF,
          label: 'T3 Claude',
          revision: 2,
          policies: {
            claude: { mode: 'only', accountRef: ACCOUNT_REF },
            codex: { mode: 'automatic' },
          },
        },
      ],
      keys: [{ keyRef: KEY_REF, label: 'T3 desktop key', profileRef: PROFILE_REF, revision: 1 }],
      accounts: [
        {
          credentialRef: 'credential_opaque',
          accountRef: ACCOUNT_REF,
          provider: 'claude',
          label: 'Work account',
          available: true,
          state: 'available',
          enrollmentSupported: true,
          targetSupported: true,
        },
        {
          credentialRef: 'credential_other',
          accountRef: null,
          provider: 'codex',
          label: 'Codex seat',
          available: true,
          state: 'not_enrolled',
          enrollmentSupported: true,
          targetSupported: true,
        },
      ],
      targetStates: { [PROFILE_REF]: { claude: 'available', codex: 'automatic' } },
    });
    expect(JSON.stringify(snapshot)).not.toContain('must-not-leak');
  });

  test('falls back to the ETag header and accepts null keys and missing collections', () => {
    const snapshot = normalizeClientProfilesSnapshot({ profiles: [], keys: null }, '"etag"');
    expect(snapshot).toEqual({
      revision: '"etag"',
      profiles: [],
      keys: [],
      accounts: [],
      targetStates: {},
    });
  });

  test('keeps unreadable saved rules visible as unknown instead of defaulting to Automatic', () => {
    const snapshot = normalizeClientProfilesSnapshot(
      {
        revision: ETAG,
        profiles: [
          {
            profile_ref: PROFILE_REF,
            label: 'Odd',
            revision: 1,
            policies: { claude: { mode: 'prefer', account_ref: ACCOUNT_REF } },
          },
        ],
        target_states: { [PROFILE_REF]: { claude: 'something_new' } },
      },
      null
    );
    expect(snapshot.profiles[0].policies).toEqual({
      claude: { mode: 'unknown', rawMode: 'prefer', accountRef: ACCOUNT_REF },
      codex: { mode: 'unknown', rawMode: '' },
    });
    expect(snapshot.targetStates[PROFILE_REF]).toEqual({ claude: 'unknown' });
  });
});

describe('client profile mutations', () => {
  const policies = {
    claude: { mode: 'only' as const, accountRef: ACCOUNT_REF },
    codex: { mode: 'automatic' as const },
  };

  test('serializes both mandatory rules in backend field names', () => {
    expect(serializeClientProfilePolicies(policies)).toEqual({
      claude: { mode: 'only', account_ref: ACCOUNT_REF },
      codex: { mode: 'automatic' },
    });
  });

  test('profile create/update/delete send the exact list ETag as If-Match', async () => {
    const post = mock('post', {
      revision: '"next"',
      result: { profile_ref: PROFILE_REF, label: 'T3', revision: 1, policies: {} },
      session_behavior: 'fresh_session_required',
    });
    const created = await clientProfilesApi.createProfile(ETAG, { label: ' T3 ', policies });
    expect(post).toHaveBeenCalledWith(
      '/client-profiles',
      { label: 'T3', policies: serializeClientProfilePolicies(policies) },
      { headers: { 'If-Match': ETAG } }
    );
    expect(created.revision).toBe('"next"');
    expect(created.sessionBehavior).toBe('fresh_session_required');
    expect(created.result.profileRef).toBe(PROFILE_REF);

    const put = mock('put', { revision: '"n2"', result: {}, session_behavior: 'x' });
    const updated = await clientProfilesApi.updateProfile(ETAG, PROFILE_REF, {
      label: 'T3',
      policies,
    });
    expect(put).toHaveBeenCalledWith(
      `/client-profiles/${PROFILE_REF}`,
      { label: 'T3', policies: serializeClientProfilePolicies(policies) },
      { headers: { 'If-Match': ETAG } }
    );
    expect(updated.sessionBehavior).toBe('unknown');

    const del = mock('delete', { revision: '"n3"', result: { deleted: PROFILE_REF } });
    await clientProfilesApi.deleteProfile(ETAG, PROFILE_REF);
    expect(del).toHaveBeenCalledWith(`/client-profiles/${PROFILE_REF}`, {
      headers: { 'If-Match': ETAG },
    });
  });

  test('refuses to write without a revision rather than relying on 428', async () => {
    const post = mock('post');
    await expect(clientProfilesApi.createProfile('', { label: 'x', policies })).rejects.toThrow();
    expect(post).not.toHaveBeenCalled();
  });

  test('preview takes a saved profile or a draft, without If-Match', async () => {
    const post = mock('post', {
      revision: ETAG,
      policies: { claude: { mode: 'automatic' }, codex: { mode: 'automatic' } },
      target_states: { claude: 'automatic', codex: 'target_unavailable' },
      enforcement: false,
      strict_requests: 'rejected',
      session_behavior: 'fresh_session_required',
    });
    const preview = await clientProfilesApi.preview({ policies });
    expect(post).toHaveBeenCalledWith('/client-profiles/preview', {
      policies: serializeClientProfilePolicies(policies),
    });
    expect(preview.targetStates).toEqual({ claude: 'automatic', codex: 'target_unavailable' });
    expect(preview.enforcement).toBe(false);
    await clientProfilesApi.preview({ profileRef: PROFILE_REF });
    expect(post).toHaveBeenLastCalledWith('/client-profiles/preview', {
      profile_ref: PROFILE_REF,
    });
  });

  test('key association, rotation, move and revocation follow the contract', async () => {
    const post = mock('post', {
      revision: '"k1"',
      result: { key_ref: KEY_REF, label: 'Desk', profile_ref: PROFILE_REF, revision: 1 },
      session_behavior: 'fresh_session_required',
    });
    const associated = await clientProfilesApi.associateKey(ETAG, {
      label: 'Desk',
      profileRef: PROFILE_REF,
      apiKey: 'sk-fixture',
    });
    expect(post).toHaveBeenCalledWith(
      '/client-profile-keys',
      { label: 'Desk', profile_ref: PROFILE_REF, api_key: 'sk-fixture' },
      { headers: { 'If-Match': ETAG } }
    );
    expect(associated.result).toEqual({
      keyRef: KEY_REF,
      label: 'Desk',
      profileRef: PROFILE_REF,
      revision: 1,
    });

    const put = mock('put', { revision: '"k2"', result: {} });
    await clientProfilesApi.updateKey(ETAG, KEY_REF, { profileRef: PROFILE_REF });
    expect(put).toHaveBeenLastCalledWith(
      `/client-profile-keys/${KEY_REF}`,
      { profile_ref: PROFILE_REF },
      { headers: { 'If-Match': ETAG } }
    );
    await clientProfilesApi.updateKey(ETAG, KEY_REF, { apiKey: ' sk-new ', label: '' });
    expect(put).toHaveBeenLastCalledWith(
      `/client-profile-keys/${KEY_REF}`,
      { api_key: 'sk-new' },
      { headers: { 'If-Match': ETAG } }
    );

    const del = mock('delete', { revision: '"k3"', result: { deleted: KEY_REF } });
    await clientProfilesApi.deleteKey(ETAG, KEY_REF);
    expect(del).toHaveBeenCalledWith(`/client-profile-keys/${KEY_REF}`, {
      headers: { 'If-Match': ETAG },
    });
  });

  test('enrollment posts only the opaque credential handle', async () => {
    const post = mock('post', { credential_ref: 'credential_x', account_ref: ACCOUNT_REF });
    expect(await clientProfilesApi.enroll('credential_x')).toEqual({
      credentialRef: 'credential_x',
      accountRef: ACCOUNT_REF,
    });
    expect(post).toHaveBeenCalledWith('/client-profile-accounts/enroll', {
      credential_ref: 'credential_x',
    });
  });

  test('accounts inventory is normalized', async () => {
    const get = mock('get', { accounts: listBody.accounts });
    const accounts = await clientProfilesApi.listAccounts();
    expect(get).toHaveBeenCalledWith('/client-profile-accounts');
    expect(accounts).toHaveLength(2);
    expect(JSON.stringify(accounts)).not.toContain('must-not-leak');
  });
});

describe('client profile domain errors', () => {
  test('reads status, machine code and field from the domain envelope', () => {
    expect(readClientProfileError(apiError(412, 'stale_revision', 'If-Match'))).toEqual({
      status: 412,
      code: 'stale_revision',
      field: 'If-Match',
    });
    expect(readClientProfileError(apiError(409, 'last_client_key', KEY_REF))).toEqual({
      status: 409,
      code: 'last_client_key',
      field: KEY_REF,
    });
    expect(readClientProfileError(new Error('network'))).toEqual({
      status: null,
      code: null,
      field: null,
    });
  });
});

describe('linked client key fingerprints', () => {
  const A = 'a'.repeat(64);
  const B = 'B'.repeat(64);
  test('reads association fingerprints from the YAML backup, never raw key values', async () => {
    const yaml = [
      'api-keys:',
      '  - sk-raw-fixture-value',
      'access:',
      '  client-profile-keys:',
      `    - {key_ref: ${KEY_REF}, label: one, profile_ref: ${PROFILE_REF}, fingerprint: ${A}}`,
      '    - {label: broken, fingerprint: not-a-fingerprint}',
      'client-profile-keys:',
      `  - {label: legacy flat layout, fingerprint: ${B}}`,
    ].join('\n');
    const linked = parseLinkedKeyFingerprints(yaml);
    expect([...linked].sort()).toEqual([A, B.toLowerCase()].sort());
    expect([...linked].join()).not.toContain('sk-raw');

    const getRaw = mock('getRaw', { data: yaml });
    expect((await clientProfilesApi.linkedKeyFingerprints()).has(A)).toBe(true);
    expect(getRaw.mock.calls[0][0]).toBe('/config.yaml');
  });

  test('a config without associations links nothing', () => {
    expect(parseLinkedKeyFingerprints('api-keys: [sk-x]\n').size).toBe(0);
    expect(parseLinkedKeyFingerprints('').size).toBe(0);
  });
});
