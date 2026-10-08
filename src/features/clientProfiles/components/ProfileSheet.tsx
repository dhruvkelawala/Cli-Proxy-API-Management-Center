import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sheet } from '@/components/ui/Sheet';
import { Button } from '@/components/ui/Button';
import { Collapsible } from '@/components/ui/Collapsible';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { clientProfilesApi } from '@/services/api/clientProfiles';
import { useNotificationStore } from '@/stores';
import {
  useClientProfilesStore,
  type ClientProfilesFailure,
} from '@/stores/useClientProfilesStore';
import type {
  ClientProfile,
  ClientProfilesCapabilities,
  ClientProfilesSnapshot,
} from '@/types/clientProfiles';
import { CONNECTION_CONTEXTS, type ConnectionContext } from '../connectionContext';
import { DEFAULT_NEW_PROFILE_POLICIES, toWritablePolicy } from '../model';
import { CR } from '../copy';
import { FailureNotice, Notice } from './Notices';
import { ProfileKeys } from './ProfileKeys';
import styles from './ProfileSheet.module.scss';

export type ProfileSheetProps = {
  open: boolean;
  /** 'new' creates a profile; otherwise the current saved profile (null if it disappeared). */
  mode: 'new' | 'edit';
  profile: ClientProfile | null;
  snapshot: ClientProfilesSnapshot;
  capabilities: ClientProfilesCapabilities;
  context: ConnectionContext | null;
  apiKeys: string[] | null;
  wsAuth: boolean | null;
  apiBase: string;
  onContextChange: (profileRef: string, context: ConnectionContext | null) => void;
  onClose: () => void;
  onDirtyChange: (dirty: boolean) => void;
};

const CONTEXT_UNSET = 'unset';

/** Create, rename or delete a profile; set its connection context; manage its client keys. */
export function ProfileSheet(props: ProfileSheetProps) {
  const {
    open,
    mode,
    profile,
    snapshot,
    capabilities,
    context,
    apiKeys,
    wsAuth,
    apiBase,
    onContextChange,
    onClose,
    onDirtyChange,
  } = props;
  const { t } = useTranslation();
  const mutate = useClientProfilesStore((state) => state.mutate);
  const load = useClientProfilesStore((state) => state.load);
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);

  const savedLabel = profile?.label ?? '';
  const [name, setName] = useState(mode === 'new' ? '' : savedLabel);
  const [newContext, setNewContext] = useState<ConnectionContext | null>(null);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<ClientProfilesFailure | null>(null);
  const [reloading, setReloading] = useState(false);
  const [nameError, setNameError] = useState('');

  const dirty = mode === 'new' ? name.trim() !== '' : name.trim() !== savedLabel;
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  const keyCount = profile
    ? snapshot.keys.filter((key) => key.profileRef === profile.profileRef).length
    : 0;
  const hasOnlyRule = profile
    ? Object.values(profile.policies).some((policy) => policy.mode !== 'automatic')
    : false;
  // A rename re-sends both saved rules unchanged; an unreadable saved rule blocks it.
  const renameClaude = profile ? toWritablePolicy(profile.policies.claude) : null;
  const renameCodex = profile ? toWritablePolicy(profile.policies.codex) : null;
  const renamePolicies =
    renameClaude && renameCodex ? { claude: renameClaude, codex: renameCodex } : null;

  const confirmClose = useCallback((): boolean | Promise<boolean> => {
    if (!dirty || saving) return true;
    return new Promise<boolean>((resolve) => {
      showConfirmation({
        title: t('providersPage.unsavedChanges.title'),
        message: t('providersPage.unsavedChanges.message'),
        variant: 'danger',
        confirmText: t('providersPage.unsavedChanges.discard'),
        cancelText: t('providersPage.unsavedChanges.keepEditing'),
        onConfirm: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
  }, [dirty, saving, showConfirmation, t]);

  const handleReload = async () => {
    setReloading(true);
    await load();
    setReloading(false);
    setFailure(null);
  };

  const handleSubmit = async () => {
    const label = name.trim();
    if (!label) {
      setNameError(t(`${CR}.profile.name_required`));
      return;
    }
    setNameError('');
    setSaving(true);
    setFailure(null);
    if (mode === 'new') {
      const outcome = await mutate((revision) =>
        clientProfilesApi.createProfile(revision, {
          label,
          policies: DEFAULT_NEW_PROFILE_POLICIES,
        })
      );
      setSaving(false);
      if (!outcome.ok) {
        setFailure(outcome);
        return;
      }
      if (newContext) onContextChange(outcome.result.profileRef, newContext);
      onDirtyChange(false);
      showNotification(t(`${CR}.profile.created`), 'success');
      onClose();
      return;
    }
    if (!profile || !renamePolicies) {
      setSaving(false);
      return;
    }
    const outcome = await mutate((revision) =>
      clientProfilesApi.updateProfile(revision, profile.profileRef, {
        label,
        policies: renamePolicies,
      })
    );
    setSaving(false);
    if (!outcome.ok) {
      setFailure(outcome);
      return;
    }
    showNotification(t(`${CR}.profile.renamed`), 'success');
  };

  const handleDelete = () => {
    if (!profile) return;
    showConfirmation({
      title: t(`${CR}.profile.delete_confirm_title`, { name: profile.label }),
      message: t(`${CR}.profile.delete_confirm`),
      variant: 'danger',
      confirmText: t(`${CR}.profile.delete`),
      cancelText: t('common.cancel'),
      onConfirm: async () => {
        setFailure(null);
        const outcome = await mutate((revision) =>
          clientProfilesApi.deleteProfile(revision, profile.profileRef)
        );
        if (!outcome.ok) {
          setFailure(outcome);
          return;
        }
        onContextChange(profile.profileRef, null);
        onDirtyChange(false);
        showNotification(t(`${CR}.profile.deleted`), 'success');
        onClose();
      },
    });
  };

  const contextOptions = [
    { value: CONTEXT_UNSET, label: t(`${CR}.connection.option_unset`) },
    ...CONNECTION_CONTEXTS.map((value) => ({
      value,
      label: t(`${CR}.connection.option_${value}`),
    })),
  ];
  const contextValue = mode === 'new' ? newContext : context;

  const footer =
    mode === 'new' ? (
      <div className={styles.footer}>
        <Button
          variant="ghost"
          onClick={() => void Promise.resolve(confirmClose()).then((ok) => ok && onClose())}
        >
          {t('common.cancel')}
        </Button>
        <Button onClick={() => void handleSubmit()} loading={saving} disabled={!name.trim()}>
          {t(`${CR}.profile.create`)}
        </Button>
      </div>
    ) : undefined;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="lg"
      eyebrow={mode === 'new' ? undefined : t(`${CR}.profile.edit_eyebrow`)}
      title={
        mode === 'new'
          ? t(`${CR}.profile.create_title`)
          : (profile?.label ?? t(`${CR}.errors.not_found_title`))
      }
      confirmClose={confirmClose}
      footer={footer}
    >
      {mode === 'edit' && !profile ? (
        <Notice tone="danger" title={t(`${CR}.errors.not_found_title`)}>
          <p>{t(`${CR}.errors.not_found`)}</p>
        </Notice>
      ) : (
        <div className={styles.body}>
          {failure && (
            <FailureNotice failure={failure} onReload={handleReload} reloading={reloading} />
          )}

          <section className={styles.section}>
            <div className={styles.nameRow}>
              <Input
                label={t(`${CR}.profile.name`)}
                value={name}
                onChange={(event) => setName(event.target.value)}
                hint={t(`${CR}.profile.name_hint`)}
                error={nameError || undefined}
                maxLength={80}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && dirty) {
                    event.preventDefault();
                    void handleSubmit();
                  }
                }}
              />
              {mode === 'edit' && (
                <Button
                  variant="secondary"
                  size="sm"
                  className={styles.renameButton}
                  onClick={() => void handleSubmit()}
                  disabled={!dirty || !renamePolicies}
                  loading={saving}
                >
                  {t(`${CR}.profile.rename_save`)}
                </Button>
              )}
            </div>
            {mode === 'new' && <p className={styles.note}>{t(`${CR}.profile.create_note`)}</p>}
          </section>

          <section className={styles.section}>
            <span className={styles.fieldLabel} id="client-profile-context-label">
              {t(`${CR}.connection.label`)}
            </span>
            <Select
              value={contextValue ?? CONTEXT_UNSET}
              onChange={(value) => {
                const next = value === CONTEXT_UNSET ? null : (value as ConnectionContext);
                if (mode === 'new') setNewContext(next);
                else if (profile) onContextChange(profile.profileRef, next);
              }}
              options={contextOptions}
              ariaLabelledBy="client-profile-context-label"
              fullWidth
            />
            <p className={styles.note}>{t(`${CR}.connection.hint`)}</p>
          </section>

          {mode === 'edit' && profile && (
            <>
              <Collapsible
                label={t(`${CR}.keys.title`)}
                hint={t(`${CR}.matrix.keys_count`, { count: keyCount })}
              >
                <ProfileKeys
                  profile={profile}
                  snapshot={snapshot}
                  apiKeys={apiKeys}
                  wsAuth={wsAuth}
                  enforcement={capabilities.enforcement}
                  hasOnlyRule={hasOnlyRule}
                  apiBase={apiBase}
                />
              </Collapsible>

              <section className={styles.danger}>
                <div>
                  <h3 className={styles.dangerTitle}>{t(`${CR}.profile.delete`)}</h3>
                  <p className={styles.note}>
                    {keyCount > 0
                      ? t(`${CR}.profile.delete_blocked`, { count: keyCount })
                      : t(`${CR}.profile.delete_hint`)}
                  </p>
                </div>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={handleDelete}
                  disabled={keyCount > 0 || saving}
                >
                  {t(`${CR}.profile.delete`)}
                </Button>
              </section>
            </>
          )}
        </div>
      )}
    </Sheet>
  );
}
