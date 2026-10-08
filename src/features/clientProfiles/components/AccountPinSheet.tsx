import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Sheet } from '@/components/ui/Sheet';
import { Button } from '@/components/ui/Button';
import { clientProfilesApi } from '@/services/api/clientProfiles';
import { useNotificationStore } from '@/stores';
import {
  useClientProfilesStore,
  type ClientProfilesFailure,
} from '@/stores/useClientProfilesStore';
import type { AuthFileItem } from '@/types';
import type {
  ClientProfileAccount,
  ClientProfileProvider,
  ClientProfilesCapabilities,
  ClientProfilesSnapshot,
} from '@/types/clientProfiles';
import {
  acceptsNewOnlyRules,
  accountDisplayLabel,
  pinnedProfilesFor,
  planPinChanges,
} from '../model';
import { CR, providerLabelKey } from '../copy';
import { useSheetCloseGuard } from '../sheetGuard';
import { FailureNotice, Notice } from './Notices';
import styles from './AccountPinSheet.module.scss';

export type AccountPinSheetProps = {
  open: boolean;
  /** Current inventory record (null if it disappeared). */
  account: ClientProfileAccount | null;
  provider: ClientProfileProvider;
  fallbackLabel: string;
  snapshot: ClientProfilesSnapshot;
  capabilities: ClientProfilesCapabilities;
  files: AuthFileItem[];
  onClose: () => void;
};

/**
 * "Use only this subscription for…": choose the client profiles whose rule for this provider
 * is Only this account. Each changed profile is saved separately with the current ETag.
 */
export function AccountPinSheet(props: AccountPinSheetProps) {
  const { open, account, provider, fallbackLabel, snapshot, capabilities, files, onClose } = props;
  const { t } = useTranslation();
  const mutate = useClientProfilesStore((state) => state.mutate);
  const enroll = useClientProfilesStore((state) => state.enroll);
  const load = useClientProfilesStore((state) => state.load);
  const showNotification = useNotificationStore((state) => state.showNotification);

  const providerName = t(providerLabelKey(provider));
  const accountName = account ? accountDisplayLabel(account, files) : fallbackLabel;
  const saved = useMemo(
    () =>
      new Set(
        account ? pinnedProfilesFor(account, snapshot).map(({ profile }) => profile.profileRef) : []
      ),
    [account, snapshot]
  );
  const [checked, setChecked] = useState<Set<string>>(() => new Set(saved));
  const [saving, setSaving] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [failure, setFailure] = useState<ClientProfilesFailure | null>(null);
  const [partial, setPartial] = useState<{ done: number; total: number } | null>(null);
  const [reloading, setReloading] = useState(false);

  const changes = account ? planPinChanges(account, snapshot, checked) : [];
  const dirty = changes.length > 0;

  const busy = saving || enrolling;
  const confirmClose = useSheetCloseGuard({ busy, dirty });

  const toggle = (profileRef: string) =>
    setChecked((current) => {
      const next = new Set(current);
      if (next.has(profileRef)) next.delete(profileRef);
      else next.add(profileRef);
      return next;
    });

  const handleEnroll = async () => {
    if (!account) return;
    setEnrolling(true);
    setFailure(null);
    const outcome = await enroll(account.credentialRef);
    setEnrolling(false);
    if (!outcome.ok) {
      setFailure(outcome);
      return;
    }
    showNotification(t(`${CR}.editor.enroll_done`, { account: accountName }), 'success');
  };

  const handleSave = async () => {
    setSaving(true);
    setFailure(null);
    setPartial(null);
    let done = 0;
    for (const change of changes) {
      const policies = change.policies;
      if (!policies) {
        setFailure({ kind: 'invalid', error: { status: null, code: null, field: null } });
        break;
      }
      const outcome = await mutate((revision) =>
        clientProfilesApi.updateProfile(revision, change.profile.profileRef, {
          label: change.profile.label,
          policies,
        })
      );
      if (!outcome.ok) {
        setFailure(outcome);
        break;
      }
      done += 1;
    }
    setSaving(false);
    if (done === changes.length) {
      showNotification(t(`${CR}.accounts.saved`), 'success');
      onClose();
      return;
    }
    if (done > 0) setPartial({ done, total: changes.length });
  };

  const canChoose = Boolean(account?.accountRef && account.targetSupported);
  const unavailable = Boolean(account && !acceptsNewOnlyRules(account));

  const footer = canChoose ? (
    <div className={styles.footer}>
      <p className={styles.scope}>{t(`${CR}.accounts.scope`, { provider: providerName })}</p>
      <div className={styles.actions}>
        <Button
          variant="ghost"
          onClick={() => setChecked(new Set(saved))}
          disabled={!dirty || saving}
        >
          {t(`${CR}.editor.discard`)}
        </Button>
        <Button onClick={() => void handleSave()} disabled={!dirty} loading={saving}>
          {t(`${CR}.accounts.save`)}
        </Button>
      </div>
    </div>
  ) : undefined;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="md"
      eyebrow={t(`${CR}.accounts.sheet_eyebrow`, { provider: providerName })}
      title={t(`${CR}.accounts.sheet_title`, { account: accountName })}
      confirmClose={confirmClose}
      closeDisabled={busy}
      footer={footer}
    >
      <div className={styles.body}>
        {failure && (
          <FailureNotice
            failure={failure}
            reloading={reloading}
            onReload={async () => {
              setReloading(true);
              await load({ fresh: true });
              setReloading(false);
              setFailure(null);
            }}
          />
        )}
        {partial && (
          <Notice tone="danger" live>
            <p>{t(`${CR}.accounts.partial`, partial)}</p>
          </Notice>
        )}

        {!account ? (
          <Notice tone="danger">
            <p>{t(`${CR}.errors.not_found`)}</p>
          </Notice>
        ) : !account.accountRef && account.enrollmentSupported ? (
          <div className={styles.enroll}>
            <p className={styles.text}>
              {t(`${CR}.accounts.enroll_first`, { account: accountName })}
            </p>
            <p className={styles.hint}>{t(`${CR}.editor.enroll_hint`, { account: accountName })}</p>
            <Button onClick={() => void handleEnroll()} loading={enrolling}>
              {t(`${CR}.editor.enroll`)}
            </Button>
          </div>
        ) : !canChoose ? (
          <Notice>
            <p>{t(`${CR}.accounts.unsupported`)}</p>
          </Notice>
        ) : snapshot.profiles.length === 0 ? (
          <Notice>
            <p>{t(`${CR}.accounts.no_profiles`)}</p>
            <Link to="/client-routes">{t(`${CR}.accounts.open_routes`)}</Link>
          </Notice>
        ) : (
          <>
            {!capabilities.enforcement && (
              <Notice>
                <p>{t(`${CR}.enforcement.short`)}</p>
              </Notice>
            )}
            <fieldset className={styles.list} disabled={saving}>
              <legend className={styles.legend}>
                {t(`${CR}.accounts.sheet_intro`, { provider: providerName, account: accountName })}
              </legend>
              {snapshot.profiles.map((profile) => {
                const policy = profile.policies[provider];
                const isThis = policy.mode === 'only' && policy.accountRef === account.accountRef;
                const otherAccount =
                  policy.mode === 'only' && !isThis
                    ? snapshot.accounts.find((item) => item.accountRef === policy.accountRef)
                    : undefined;
                const now =
                  policy.mode === 'automatic'
                    ? t(`${CR}.accounts.now_automatic`)
                    : policy.mode === 'unknown'
                      ? t(`${CR}.accounts.now_unknown`)
                      : isThis
                        ? t(`${CR}.accounts.now_this`)
                        : t(`${CR}.accounts.now_only`, {
                            account: otherAccount
                              ? accountDisplayLabel(otherAccount, files)
                              : t(`${CR}.pill.removed_account`),
                          });
                return (
                  <label key={profile.profileRef} className={styles.item}>
                    <input
                      type="checkbox"
                      className={styles.checkbox}
                      checked={checked.has(profile.profileRef)}
                      onChange={() => toggle(profile.profileRef)}
                      // The gateway refuses a new Only rule for an unavailable account (422);
                      // clients already pinned to it can still be returned to Automatic.
                      disabled={policy.mode === 'unknown' || (unavailable && !isThis)}
                    />
                    <span className={styles.itemText}>
                      <span className={styles.itemLabel}>{profile.label}</span>
                      <span className={styles.itemNow}>{now}</span>
                    </span>
                  </label>
                );
              })}
            </fieldset>
            <Notice tone={unavailable ? 'danger' : 'info'}>
              <p>
                {unavailable
                  ? t(`${CR}.accounts.will_fail_warning`, { account: accountName })
                  : t(`${CR}.accounts.strict_warning`, { account: accountName })}
              </p>
            </Notice>
            <p className={styles.hint}>{t(`${CR}.editor.session_note`)}</p>
          </>
        )}
      </div>
    </Sheet>
  );
}
