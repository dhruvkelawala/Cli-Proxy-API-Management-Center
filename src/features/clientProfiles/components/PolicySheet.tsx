import { useCallback, useEffect, useId, useMemo, useReducer, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sheet } from '@/components/ui/Sheet';
import { Button } from '@/components/ui/Button';
import { apiClient } from '@/services/api/client';
import { clientProfilesApi } from '@/services/api/clientProfiles';
import { useNotificationStore } from '@/stores';
import { useClientProfilesStore } from '@/stores/useClientProfilesStore';
import type { AuthFileItem } from '@/types';
import type {
  ClientProfile,
  ClientProfileProvider,
  ClientProfilesCapabilities,
  ClientProfilesSnapshot,
  ClientProfileTargetState,
  WritableClientProfilePolicy,
} from '@/types/clientProfiles';
import {
  AUTOMATIC_POLICY,
  accountDisplayLabel,
  isFailingTargetState,
  policiesWithEdit,
  resolveTargetState,
  samePolicy,
  targetOptionsFor,
  toWritablePolicy,
  type PoolPreview,
  type TargetOption,
} from '../model';
import type { ConnectionContext } from '../connectionContext';
import { initialPolicyEditorState, policyEditorReducer } from '../policyEditorState';
import { continueAfterClose, useSheetCloseGuard } from '../sheetGuard';
import { CR, providerLabelKey } from '../copy';
import { ConnectionContextLine } from './ConnectionContextLine';
import { FailureNotice, Notice } from './Notices';
import { PolicyPreview } from './PolicyPreview';
import styles from './PolicySheet.module.scss';

export type PolicySheetProps = {
  open: boolean;
  /** Current saved profile; null if it disappeared on the gateway. */
  profile: ClientProfile | null;
  provider: ClientProfileProvider;
  snapshot: ClientProfilesSnapshot;
  capabilities: ClientProfilesCapabilities;
  files: AuthFileItem[] | null;
  pool: PoolPreview;
  context: ConnectionContext | null;
  onClose: () => void;
  onDirtyChange: (dirty: boolean) => void;
  /** Called only after the unsaved-changes check passed and nothing is in flight. */
  onOpenProfile: () => void;
};

type DraftKey = 'automatic' | `only:${string}`;
const draftKey = (policy: WritableClientProfilePolicy): DraftKey =>
  policy.mode === 'automatic' ? 'automatic' : `only:${policy.accountRef}`;

/**
 * Editor for one profile × provider rule: Automatic or Only <account>, with a live preview.
 * Saving sends the complete profile (both mandatory rules) with the list ETag.
 */
export function PolicySheet(props: PolicySheetProps) {
  const {
    open,
    profile,
    provider,
    snapshot,
    capabilities,
    files,
    pool,
    context,
    onClose,
    onDirtyChange,
    onOpenProfile,
  } = props;
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const mutate = useClientProfilesStore((state) => state.mutate);
  const enroll = useClientProfilesStore((state) => state.enroll);
  const load = useClientProfilesStore((state) => state.load);
  const groupName = useId();
  const providerName = t(providerLabelKey(provider));

  const savedPolicy = profile?.policies[provider] ?? null;
  const savedWritable = savedPolicy ? toWritablePolicy(savedPolicy) : null;
  const [editor, dispatch] = useReducer(
    policyEditorReducer,
    savedWritable,
    initialPolicyEditorState
  );
  const { draft, saving, enrolling, failure, reloaded } = editor;
  const setDraft = useCallback(
    (policy: WritableClientProfilePolicy) => dispatch({ type: 'select', policy }),
    []
  );
  const [reloading, setReloading] = useState(false);

  const dirty = Boolean(draft && savedPolicy && !samePolicy(draft, savedPolicy));
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  const savedAccountRef = savedPolicy?.mode === 'only' ? savedPolicy.accountRef : null;
  const options = useMemo(
    () => targetOptionsFor(provider, snapshot.accounts, files, savedAccountRef),
    [files, provider, savedAccountRef, snapshot.accounts]
  );
  const otherRuleUnreadable = profile
    ? policiesWithEdit(profile, provider, AUTOMATIC_POLICY) === null
    : false;
  const savedTargetMissing =
    savedPolicy?.mode === 'only' &&
    !options.some(
      (option) => option.selectable && option.account.accountRef === savedPolicy.accountRef
    );
  const profileKeyCount = profile
    ? snapshot.keys.filter((key) => key.profileRef === profile.profileRef).length
    : 0;

  /* Server-side preview of the draft target (falls back to the same inventory locally). */
  const [serverState, setServerState] = useState<{
    key: DraftKey;
    state: ClientProfileTargetState;
  } | null>(null);
  const previewRequest = useRef(0);
  useEffect(() => {
    if (!open || !profile || !draft || draft.mode !== 'only') return;
    const policies = policiesWithEdit(profile, provider, draft);
    if (!policies) return;
    const request = (previewRequest.current += 1);
    const connection = apiClient.getConnectionRevision();
    const key = draftKey(draft);
    clientProfilesApi
      .preview({ policies })
      .then((preview) => {
        if (request !== previewRequest.current) return;
        if (connection !== apiClient.getConnectionRevision()) return;
        const state = preview.targetStates[provider];
        if (state) setServerState({ key, state });
      })
      .catch(() => {
        /* Local resolution against the same server inventory stays in place. */
      });
  }, [draft, open, profile, provider, snapshot.revision]);

  const draftState: ClientProfileTargetState = useMemo(() => {
    if (!draft) return 'unknown_mode';
    if (draft.mode === 'automatic') return 'automatic';
    if (serverState && serverState.key === draftKey(draft)) return serverState.state;
    if (savedPolicy && profile && samePolicy(draft, savedPolicy)) {
      const reported = snapshot.targetStates[profile.profileRef]?.[provider];
      if (reported && reported !== 'unknown') return reported;
    }
    return resolveTargetState(provider, draft, snapshot.accounts);
  }, [draft, profile, provider, savedPolicy, serverState, snapshot]);

  const draftAccountLabel = useMemo(() => {
    if (!draft || draft.mode !== 'only') return null;
    const matches = snapshot.accounts.filter((account) => account.accountRef === draft.accountRef);
    return matches.length === 1 ? accountDisplayLabel(matches[0], files) : null;
  }, [draft, files, snapshot.accounts]);

  const busy = saving || enrolling !== null;
  const confirmClose = useSheetCloseGuard({ busy, dirty });

  const handleReload = useCallback(async () => {
    setReloading(true);
    try {
      await load({ fresh: true });
      dispatch({ type: 'reload_done' });
    } finally {
      setReloading(false);
    }
  }, [load]);

  const handleSave = useCallback(async () => {
    if (!profile || !draft || !dirty) return;
    const policies = policiesWithEdit(profile, provider, draft);
    if (!policies) return;
    dispatch({ type: 'save_start' });
    const outcome = await mutate((revision) =>
      clientProfilesApi.updateProfile(revision, profile.profileRef, {
        label: profile.label,
        policies,
      })
    );
    if (!outcome.ok) {
      dispatch({ type: 'save_failed', failure: outcome });
      return;
    }
    dispatch({ type: 'save_done' });
    onDirtyChange(false);
    showNotification(
      outcome.sessionBehavior === 'fresh_session_required'
        ? t(`${CR}.editor.saved`)
        : t(`${CR}.editor.saved_plain`),
      'success'
    );
    onClose();
  }, [dirty, draft, mutate, onClose, onDirtyChange, profile, provider, showNotification, t]);

  const handleEnroll = useCallback(
    async (option: TargetOption) => {
      dispatch({ type: 'enroll_start', credentialRef: option.account.credentialRef });
      const outcome = await enroll(option.account.credentialRef);
      if (!outcome.ok) {
        dispatch({ type: 'enroll_failed', failure: outcome });
        return;
      }
      dispatch({ type: 'enroll_done', accountRef: outcome.result || null });
      showNotification(t(`${CR}.editor.enroll_done`, { account: option.label }), 'success');
    },
    [enroll, showNotification, t]
  );

  const footer = (
    <div className={styles.footer}>
      <div className={styles.footerCopy}>
        <p className={styles.scope}>
          {t(`${CR}.editor.scope`, { provider: providerName, profile: profile?.label ?? '' })}
        </p>
        {dirty && <p className={styles.unsaved}>{t(`${CR}.editor.unsaved`)}</p>}
      </div>
      <div className={styles.footerActions}>
        <Button
          variant="ghost"
          onClick={() => dispatch({ type: 'discard', saved: savedWritable })}
          disabled={!dirty || saving}
        >
          {t(`${CR}.editor.discard`)}
        </Button>
        <Button
          onClick={() => void handleSave()}
          disabled={!dirty || !profile || otherRuleUnreadable}
          loading={saving}
        >
          {t(`${CR}.editor.save`)}
        </Button>
      </div>
    </div>
  );

  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="lg"
      eyebrow={t(`${CR}.editor.eyebrow`, { provider: providerName })}
      title={profile?.label ?? t(`${CR}.errors.not_found_title`)}
      confirmClose={confirmClose}
      closeDisabled={busy}
      footer={profile ? footer : undefined}
    >
      {!profile ? (
        <Notice tone="danger" title={t(`${CR}.errors.not_found_title`)}>
          <p>{t(`${CR}.errors.not_found`)}</p>
        </Notice>
      ) : (
        <div className={styles.body}>
          <ConnectionContextLine context={context} />

          {failure && (
            <FailureNotice
              failure={failure}
              onReload={() => void handleReload()}
              reloading={reloading}
            />
          )}
          {reloaded && !failure && (
            <Notice live>
              <p>{t(`${CR}.editor.reloaded`)}</p>
            </Notice>
          )}
          {otherRuleUnreadable && (
            <Notice tone="danger">
              <p>{t(`${CR}.editor.other_rule_unknown`)}</p>
            </Notice>
          )}

          <fieldset className={styles.options} disabled={saving}>
            <legend className={styles.legend}>
              {t(`${CR}.editor.question`, { provider: providerName })}
            </legend>

            <RadioCard
              name={groupName}
              checked={draft?.mode === 'automatic'}
              onSelect={() => setDraft(AUTOMATIC_POLICY)}
              title={t(`${CR}.editor.automatic`)}
              description={t(`${CR}.editor.automatic_desc`)}
            />

            {savedTargetMissing && savedPolicy?.mode === 'only' && (
              <RadioCard
                name={groupName}
                checked={draft?.mode === 'only' && draft.accountRef === savedPolicy.accountRef}
                onSelect={() => setDraft({ mode: 'only', accountRef: savedPolicy.accountRef })}
                title={t(`${CR}.editor.removed_option`)}
                description={t(`${CR}.editor.removed_desc`)}
                tone="fail"
              />
            )}

            {options.map((option) => {
              const accountRef = option.account.accountRef;
              if (option.selectable && accountRef) {
                return (
                  <RadioCard
                    key={option.account.credentialRef}
                    name={groupName}
                    checked={draft?.mode === 'only' && draft.accountRef === accountRef}
                    onSelect={() => setDraft({ mode: 'only', accountRef })}
                    title={t(`${CR}.editor.only`, { account: option.label })}
                    description={
                      option.status === 'will_fail'
                        ? t(`${CR}.editor.will_fail_desc`, { account: option.label })
                        : t(`${CR}.editor.only_desc`, { account: option.label })
                    }
                    tone={option.status === 'will_fail' ? 'fail' : undefined}
                    badge={option.status === 'will_fail' ? t(`${CR}.pill.will_fail`) : undefined}
                  />
                );
              }
              return (
                <div key={option.account.credentialRef} className={styles.staticCard}>
                  <div className={styles.cardHead}>
                    <span className={styles.cardTitle}>{option.label}</span>
                    <span className={styles.cardStatus}>
                      {t(`${CR}.editor.status_${option.status}`)}
                    </span>
                  </div>
                  <p className={styles.cardDesc}>
                    {option.status === 'will_fail'
                      ? t(`${CR}.editor.unavailable_choice_desc`, { account: option.label })
                      : t(`${CR}.editor.${option.status}_desc`, { account: option.label })}
                  </p>
                  {option.status === 'needs_enrollment' && (
                    <Button
                      variant="secondary"
                      size="sm"
                      className={styles.enrollButton}
                      onClick={() => void handleEnroll(option)}
                      loading={enrolling === option.account.credentialRef}
                      disabled={enrolling !== null || saving}
                    >
                      {t(`${CR}.editor.enroll`)}
                    </Button>
                  )}
                </div>
              );
            })}
            {options.length === 0 && (
              <p className={styles.emptyOptions}>
                {t(`${CR}.editor.no_accounts`, { provider: providerName })}
              </p>
            )}
          </fieldset>

          {!capabilities.enforcement && draft?.mode === 'only' && profileKeyCount > 0 && (
            <Notice>
              <p>{t(`${CR}.editor.strict_keys_warning`, { count: profileKeyCount })}</p>
            </Notice>
          )}

          {draft?.mode === 'automatic' && (
            <PolicyPreview kind="automatic" providerName={providerName} pool={pool} />
          )}
          {draft?.mode === 'only' && (
            <PolicyPreview
              kind="only"
              providerName={providerName}
              accountLabel={draftAccountLabel}
              state={draftState}
            />
          )}
          {draft?.mode === 'only' && isFailingTargetState(draftState) && dirty && (
            <p className={styles.saveHint}>{t(`${CR}.editor.will_fail_save_hint`)}</p>
          )}

          <p className={styles.sessionNote}>{t(`${CR}.editor.session_note`)}</p>

          <button
            type="button"
            className={styles.profileLink}
            onClick={() => void continueAfterClose(confirmClose, onOpenProfile)}
            disabled={busy}
          >
            {t(`${CR}.editor.manage_profile`)}
          </button>
        </div>
      )}
    </Sheet>
  );
}

function RadioCard({
  name,
  checked,
  onSelect,
  title,
  description,
  tone,
  badge,
}: {
  name: string;
  checked: boolean;
  onSelect: () => void;
  title: string;
  description: string;
  tone?: 'fail';
  badge?: string;
}) {
  const descId = useId();
  return (
    <label
      className={[
        styles.radioCard,
        checked ? styles.radioCardChecked : '',
        tone === 'fail' ? styles.radioCardFail : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onSelect}
        aria-describedby={descId}
        className={styles.radio}
      />
      <span className={styles.cardText}>
        <span className={styles.cardHead}>
          <span className={styles.cardTitle}>{title}</span>
          {badge && <span className={styles.failBadge}>{badge}</span>}
        </span>
        <span id={descId} className={tone === 'fail' ? styles.cardDescFail : styles.cardDesc}>
          {description}
        </span>
      </span>
    </label>
  );
}
