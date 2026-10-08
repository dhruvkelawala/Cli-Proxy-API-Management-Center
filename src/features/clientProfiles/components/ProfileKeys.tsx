import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { clientProfilesApi } from '@/services/api/clientProfiles';
import { useConfigStore, useNotificationStore } from '@/stores';
import {
  useClientProfilesStore,
  type ClientProfilesFailure,
} from '@/stores/useClientProfilesStore';
import { apiKeyNameFingerprint, readApiKeyNames } from '@/features/config/apiKeyNames';
import { generateSecureApiKey } from '@/utils/apiKey';
import { copyToClipboard } from '@/utils/clipboard';
import { maskApiKey } from '@/utils/format';
import type {
  ClientProfile,
  ClientProfileKey,
  ClientProfilesSnapshot,
} from '@/types/clientProfiles';
import { CR } from '../copy';
import { FailureNotice, Notice } from './Notices';
import styles from './ProfileKeys.module.scss';

type ProfileKeysProps = {
  profile: ClientProfile;
  snapshot: ClientProfilesSnapshot;
  /** Legacy `access.api-keys` values; null while the config is unknown. Never rendered raw. */
  apiKeys: string[] | null;
  wsAuth: boolean | null;
  enforcement: boolean;
  hasOnlyRule: boolean;
  apiBase: string;
};

type Editing = { keyRef: string; action: 'move' | 'rotate' } | null;

/**
 * Client keys linked to a profile. Values are never shown: existing keys appear masked in the
 * picker (option values are list positions), and links show only their label.
 */
export function ProfileKeys(props: ProfileKeysProps) {
  const { profile, snapshot, apiKeys, wsAuth, enforcement, hasOnlyRule, apiBase } = props;
  const { t } = useTranslation();
  const mutate = useClientProfilesStore((state) => state.mutate);
  const mutating = useClientProfilesStore((state) => state.mutating);
  const load = useClientProfilesStore((state) => state.load);
  const fetchConfig = useConfigStore((state) => state.fetchConfig);
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);

  const [failure, setFailure] = useState<ClientProfilesFailure | null>(null);
  const [reloading, setReloading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState('');
  const [linkLabel, setLinkLabel] = useState('');
  const [editing, setEditing] = useState<Editing>(null);
  const [moveTarget, setMoveTarget] = useState('');
  const [rotateValue, setRotateValue] = useState('');

  const keys = snapshot.keys.filter((key) => key.profileRef === profile.profileRef);
  const names = useMemo(() => readApiKeyNames(apiBase), [apiBase]);
  const keyOptions = useMemo(
    () =>
      (apiKeys ?? []).map((value, index) => {
        const name = names[apiKeyNameFingerprint(apiBase, value)];
        return {
          value: String(index),
          label: name ? `${name} · ${maskApiKey(value)}` : maskApiKey(value),
          name: name ?? '',
        };
      }),
    [apiBase, apiKeys, names]
  );
  const otherProfiles = snapshot.profiles.filter((item) => item.profileRef !== profile.profileRef);

  const finish = async (
    run: () => Promise<{ ok: boolean } & Partial<ClientProfilesFailure>>,
    successKey: string,
    refreshConfig: boolean
  ) => {
    setFailure(null);
    const outcome = await run();
    if (!outcome.ok) {
      setFailure(outcome as ClientProfilesFailure);
      return false;
    }
    if (refreshConfig) void fetchConfig(true);
    showNotification(t(successKey), 'success');
    return true;
  };

  const handleLink = async () => {
    const value = apiKeys?.[Number(selectedIndex)];
    if (!value) return;
    const option = keyOptions[Number(selectedIndex)];
    const label = linkLabel.trim() || option?.name || t(`${CR}.keys.default_label`);
    const ok = await finish(
      () =>
        mutate((revision) =>
          clientProfilesApi.associateKey(revision, {
            label,
            profileRef: profile.profileRef,
            apiKey: value,
          })
        ),
      `${CR}.keys.linked`,
      false
    );
    if (ok) {
      setSelectedIndex('');
      setLinkLabel('');
    }
  };

  const handleMove = async (key: ClientProfileKey) => {
    if (!moveTarget) return;
    const ok = await finish(
      () =>
        mutate((revision) =>
          clientProfilesApi.updateKey(revision, key.keyRef, { profileRef: moveTarget })
        ),
      `${CR}.keys.moved`,
      false
    );
    if (ok) setEditing(null);
  };

  const handleRotate = async (key: ClientProfileKey) => {
    if (!rotateValue.trim()) return;
    const ok = await finish(
      () =>
        mutate((revision) =>
          clientProfilesApi.updateKey(revision, key.keyRef, { apiKey: rotateValue })
        ),
      `${CR}.keys.rotated`,
      true
    );
    if (ok) {
      setEditing(null);
      setRotateValue('');
    }
  };

  const handleRevoke = (key: ClientProfileKey) => {
    showConfirmation({
      title: t(`${CR}.keys.revoke_confirm_title`, { name: key.label }),
      message: t(`${CR}.keys.revoke_confirm`),
      variant: 'danger',
      confirmText: t(`${CR}.keys.revoke`),
      cancelText: t('common.cancel'),
      onConfirm: async () => {
        await finish(
          () => mutate((revision) => clientProfilesApi.deleteKey(revision, key.keyRef)),
          `${CR}.keys.revoked`,
          true
        );
      },
    });
  };

  const startEditing = (keyRef: string, action: 'move' | 'rotate') => {
    setFailure(null);
    setMoveTarget('');
    setRotateValue('');
    setEditing((current) =>
      current?.keyRef === keyRef && current.action === action ? null : { keyRef, action }
    );
  };

  return (
    <div className={styles.keys}>
      <p className={styles.hint}>{t(`${CR}.keys.hint`)}</p>

      {failure && (
        <FailureNotice
          failure={failure}
          reloading={reloading}
          onReload={async () => {
            setReloading(true);
            await Promise.allSettled([load(), fetchConfig(true)]);
            setReloading(false);
            setFailure(null);
          }}
        />
      )}
      {!enforcement && hasOnlyRule && keys.length > 0 && (
        <Notice>
          <p>{t(`${CR}.keys.strict_warning`)}</p>
        </Notice>
      )}

      {keys.length === 0 ? (
        <p className={styles.empty}>{t(`${CR}.keys.empty`)}</p>
      ) : (
        <ul className={styles.list}>
          {keys.map((key) => (
            <li key={key.keyRef} className={styles.item}>
              <div className={styles.itemHead}>
                <span className={styles.itemLabel}>{key.label}</span>
                <span className={styles.itemValue}>{t(`${CR}.keys.value_hidden`)}</span>
              </div>
              <div className={styles.itemActions}>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => startEditing(key.keyRef, 'move')}
                  disabled={mutating || otherProfiles.length === 0}
                  aria-expanded={editing?.keyRef === key.keyRef && editing.action === 'move'}
                  aria-label={t(`${CR}.keys.move_aria`, { name: key.label })}
                >
                  {t(`${CR}.keys.move`)}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => startEditing(key.keyRef, 'rotate')}
                  disabled={mutating}
                  aria-expanded={editing?.keyRef === key.keyRef && editing.action === 'rotate'}
                  aria-label={t(`${CR}.keys.rotate_aria`, { name: key.label })}
                >
                  {t(`${CR}.keys.rotate`)}
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => handleRevoke(key)}
                  disabled={mutating}
                  aria-label={t(`${CR}.keys.revoke_aria`, { name: key.label })}
                >
                  {t(`${CR}.keys.revoke`)}
                </Button>
              </div>

              {editing?.keyRef === key.keyRef && editing.action === 'move' && (
                <div className={styles.inlineForm}>
                  <Select
                    value={moveTarget}
                    onChange={setMoveTarget}
                    options={otherProfiles.map((item) => ({
                      value: item.profileRef,
                      label: item.label,
                    }))}
                    placeholder={t(`${CR}.keys.move_placeholder`)}
                    ariaLabel={t(`${CR}.keys.move_aria`, { name: key.label })}
                    fullWidth
                  />
                  <p className={styles.formHint}>{t(`${CR}.keys.move_hint`)}</p>
                  <Button
                    size="sm"
                    onClick={() => void handleMove(key)}
                    disabled={!moveTarget}
                    loading={mutating}
                  >
                    {t(`${CR}.keys.move_save`)}
                  </Button>
                </div>
              )}

              {editing?.keyRef === key.keyRef && editing.action === 'rotate' && (
                <div className={styles.inlineForm}>
                  <Input
                    label={t(`${CR}.keys.rotate_value`)}
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={rotateValue}
                    onChange={(event) => setRotateValue(event.target.value)}
                    hint={t(`${CR}.keys.rotate_hint`)}
                  />
                  <div className={styles.formRow}>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setRotateValue(generateSecureApiKey())}
                    >
                      {t(`${CR}.keys.rotate_generate`)}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={!rotateValue.trim()}
                      onClick={async () => {
                        const copied = await copyToClipboard(rotateValue.trim());
                        showNotification(
                          copied ? t(`${CR}.keys.copied`) : t(`${CR}.keys.copy_failed`),
                          copied ? 'success' : 'error'
                        );
                      }}
                    >
                      {t(`${CR}.keys.rotate_copy`)}
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => void handleRotate(key)}
                      disabled={!rotateValue.trim()}
                      loading={mutating}
                    >
                      {t(`${CR}.keys.rotate_save`)}
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className={styles.link}>
        <h4 className={styles.linkTitle}>{t(`${CR}.keys.link_title`)}</h4>
        {wsAuth === false && (
          <Notice>
            <p>
              {t(`${CR}.keys.ws_auth_off`)}{' '}
              <Link to="/config?field=wsAuth">{t(`${CR}.keys.open_config`)}</Link>
            </p>
          </Notice>
        )}
        {apiKeys === null ? (
          <p className={styles.empty}>{t(`${CR}.keys.config_unknown`)}</p>
        ) : keyOptions.length === 0 ? (
          <p className={styles.empty}>{t(`${CR}.keys.none_available`)}</p>
        ) : (
          <>
            <Select
              value={selectedIndex}
              onChange={(value) => {
                setSelectedIndex(value);
                setLinkLabel(keyOptions[Number(value)]?.name ?? '');
              }}
              options={keyOptions.map(({ value, label }) => ({ value, label }))}
              placeholder={t(`${CR}.keys.link_placeholder`)}
              ariaLabel={t(`${CR}.keys.link_select`)}
              fullWidth
            />
            <Input
              label={t(`${CR}.keys.link_label`)}
              value={linkLabel}
              onChange={(event) => setLinkLabel(event.target.value)}
              hint={t(`${CR}.keys.link_label_hint`)}
              maxLength={80}
            />
            <p className={styles.formHint}>{t(`${CR}.keys.link_hint`)}</p>
            <Button
              size="sm"
              className={styles.linkButton}
              onClick={() => void handleLink()}
              disabled={selectedIndex === '' || wsAuth === false}
              loading={mutating}
            >
              {t(`${CR}.keys.link`)}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
