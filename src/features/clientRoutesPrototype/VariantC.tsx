/**
 * PROTOTYPE (throwaway) — Variant C "Account-centric + request journey".
 * Lives on the Accounts list: each subscription card shows which clients are pinned to it and a
 * "Use only this subscription for…" action. Routing is explained as a vertical request journey
 * (client → policy → strategy → priority tier → account) with the shared strategy editable in
 * place. Hard-coded English on purpose.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import styles from './VariantC.module.scss';
import { useProtoStore } from './useProtoStore';
import {
  MACHINES,
  PROVIDERS,
  STRATEGIES,
  accountScopeText,
  automaticProfilesFor,
  pinnedProfiles,
  policyLabel,
  policyOutcome,
  providerLabel,
  routingScopeText,
  strategyMeta,
  type ProtoAccount,
  type ProviderId,
  type SaveGroup,
} from './prototypeModel';
import { ScopedSave, ShareBar, StatusDot, TopologyPath, TuningInput } from './protoBits';
import { accountTone, consequenceText } from './protoCopy';

export const VARIANT_C_NAME = 'Accounts + journey';

export function VariantC() {
  const draft = useProtoStore((s) => s.draft);
  const enabled = draft.accounts.filter((a) => a.enabled).length;
  const [journeyProfile, setJourneyProfile] = useState(draft.profiles[0].id);
  const [journeyProvider, setJourneyProvider] = useState<ProviderId>('claude');

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Accounts</h1>
        <p className={styles.meta}>
          <span>{draft.accounts.length} subscriptions</span>
          <span aria-hidden="true">·</span>
          <span className={styles.metaActive}>{enabled} enabled</span>
          <span aria-hidden="true">·</span>
          <span>Mini gateway, shared by both Macs</span>
        </p>
      </header>

      <div className={styles.layout}>
        <div className={styles.accounts}>
          {PROVIDERS.map((prov) => (
            <section key={prov.id} aria-labelledby={`proto-c-${prov.id}`}>
              <h2 id={`proto-c-${prov.id}`} className={styles.groupTitle}>
                {prov.label}
              </h2>
              <div className={styles.grid}>
                {draft.accounts
                  .filter((a) => a.provider === prov.id)
                  .map((a) => (
                    <AccountCard
                      key={a.id}
                      account={a}
                      onTrace={(profileId) => {
                        setJourneyProfile(profileId);
                        setJourneyProvider(a.provider);
                      }}
                    />
                  ))}
              </div>
            </section>
          ))}
        </div>

        <Journey
          profileId={journeyProfile}
          provider={journeyProvider}
          onProfile={setJourneyProfile}
          onProvider={setJourneyProvider}
        />
      </div>
    </div>
  );
}

function AccountCard({
  account,
  onTrace,
}: {
  account: ProtoAccount;
  onTrace: (profileId: string) => void;
}) {
  const draft = useProtoStore((s) => s.draft);
  const setEnabled = useProtoStore((s) => s.setEnabled);
  const setPolicy = useProtoStore((s) => s.setPolicy);
  const [pinOpen, setPinOpen] = useState(false);
  const [tuneOpen, setTuneOpen] = useState(false);
  const pinned = pinnedProfiles(draft, account.id);
  const automatic = automaticProfilesFor(draft, account.provider);
  const unusable = !account.enabled || account.availability === 'unavailable';
  const panelId = `proto-c-pin-${account.id}`;
  const tuneId = `proto-c-tune-${account.id}`;
  const profileGroups = draft.profiles.map((p) => `profile:${p.id}` as SaveGroup);

  return (
    <article className={`${styles.card} ${!account.enabled ? styles.cardOff : ''}`}>
      <div className={styles.cardHead}>
        <span className={styles.providerBadge}>{providerLabel(account.provider)}</span>
        <h3 className={styles.cardTitle}>{account.label}</h3>
        <ToggleSwitch
          checked={account.enabled}
          onChange={(v) => setEnabled(account.id, v)}
          ariaLabel={`${account.label} enabled`}
        />
      </div>
      <p className={styles.cardMeta}>
        <StatusDot tone={accountTone(account)} />
        {account.enabled
          ? account.availability === 'unknown'
            ? 'Enabled · availability unknown'
            : account.availability === 'available'
              ? 'Enabled · available'
              : 'Enabled · unavailable'
          : 'Disabled · off by choice'}
        <span className={styles.plan}>{account.plan}</span>
      </p>

      <div className={styles.usage}>
        <div className={styles.usageLabel}>Pinned clients</div>
        {pinned.length === 0 ? (
          <p className={styles.usageEmpty}>No client uses only this subscription.</p>
        ) : (
          <ul className={styles.chips}>
            {pinned.map((p) => (
              <li key={p.id} className={`${styles.chip} ${unusable ? styles.chipFail : ''}`}>
                <button
                  type="button"
                  className={styles.chipName}
                  onClick={() => onTrace(p.id)}
                  title="Trace this client's request"
                >
                  {p.label}
                </button>
                <span className={styles.chipMode}>{unusable ? 'will fail' : 'only'}</span>
              </li>
            ))}
          </ul>
        )}
        <p className={styles.usageNote}>
          {account.enabled
            ? `Also in the shared pool for ${automatic.length} Automatic client${automatic.length === 1 ? '' : 's'}.`
            : 'Not in the shared pool while disabled.'}
          {unusable && pinned.length > 0 && (
            <strong className={styles.failNote}>
              {' '}
              {pinned.length} pinned client{pinned.length === 1 ? '' : 's'} will fail; no other
              account substitutes.
            </strong>
          )}
        </p>
      </div>

      <div className={styles.cardActions}>
        <Button
          variant={pinOpen ? 'secondary' : 'primary'}
          size="sm"
          aria-expanded={pinOpen}
          aria-controls={panelId}
          onClick={() => setPinOpen((v) => !v)}
        >
          Use only this subscription for…
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={tuneOpen}
          aria-controls={tuneId}
          onClick={() => setTuneOpen((v) => !v)}
        >
          Pool tuning · P{account.priority} · W{account.weight}
        </Button>
      </div>

      {pinOpen && (
        <fieldset id={panelId} className={styles.pinPanel}>
          <legend className={styles.pinLegend}>
            Clients whose {providerLabel(account.provider)} requests must use {account.label}
          </legend>
          {draft.profiles.map((p) => {
            const policy = p.policies[account.provider];
            const checked = policy.mode === 'only' && policy.accountId === account.id;
            const elsewhere = policy.mode === 'only' && policy.accountId !== account.id;
            return (
              <label key={p.id} className={styles.pinRow}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) =>
                    setPolicy(
                      p.id,
                      account.provider,
                      e.target.checked
                        ? { mode: 'only', accountId: account.id }
                        : { mode: 'automatic' }
                    )
                  }
                />
                <span className={styles.pinText}>
                  <span className={styles.pinName}>{p.label}</span>
                  <span className={styles.pinCurrent}>
                    Now: {policyLabel(draft, policy)}
                    {elsewhere && ' · checking moves it here'}
                    {checked && ' · uncheck to return to Automatic'}
                  </span>
                </span>
              </label>
            );
          })}
          <p className={styles.pinWarn}>
            Strict: if {account.label} is disabled or unavailable, these clients get an error. Other
            subscriptions stay enabled and are never used instead.
          </p>
          <ScopedSave
            groups={profileGroups}
            scope={`Applies to all ${providerLabel(account.provider)} requests using the checked profiles · new sessions`}
            saveLabel="Save pins"
            layout="stack"
          />
        </fieldset>
      )}

      {tuneOpen && (
        <div id={tuneId} className={styles.tunePanel}>
          <div className={styles.tuneInputs}>
            <TuningInput account={account} field="priority" compact />
            <TuningInput
              account={account}
              field="weight"
              compact
              inactive={draft.routing.strategy !== 'weighted-round-robin'}
            />
          </div>
          <ScopedSave
            groups={[`account:${account.id}`]}
            scope={accountScopeText(draft, account)}
            saveLabel="Save"
            layout="stack"
          />
        </div>
      )}
    </article>
  );
}

function Journey({
  profileId,
  provider,
  onProfile,
  onProvider,
}: {
  profileId: string;
  provider: ProviderId;
  onProfile: (id: string) => void;
  onProvider: (p: ProviderId) => void;
}) {
  const draft = useProtoStore((s) => s.draft);
  const setRouting = useProtoStore((s) => s.setRouting);
  const profile = draft.profiles.find((p) => p.id === profileId) ?? draft.profiles[0];
  const outcome = policyOutcome(draft, profile, provider);
  const only = outcome.kind === 'only';
  const pool = outcome.kind === 'pool' ? outcome.pool : null;
  const { routing } = draft;
  const top = pool?.rows.filter((r) => r.status === 'share' || r.status === 'standby') ?? [];
  const fallback = pool?.rows.filter((r) => r.status === 'fallback') ?? [];
  const excluded = pool?.rows.filter((r) => r.status === 'excluded') ?? [];

  return (
    <aside className={styles.journey} aria-labelledby="proto-c-journey">
      <h2 id="proto-c-journey" className={styles.journeyTitle}>
        Request journey
      </h2>
      <p className={styles.journeyLede}>
        How the Mini gateway would pick an account for a new request. Illustration, not a trace.
      </p>

      <div className={styles.journeyPickers}>
        <div className={styles.picker}>
          <span id="proto-c-from" className={styles.pickerLabel}>
            From client
          </span>
          <Select
            value={profile.id}
            options={draft.profiles.map((p) => ({ value: p.id, label: p.label }))}
            onChange={onProfile}
            ariaLabelledBy="proto-c-from"
            fullWidth
          />
        </div>
        <fieldset className={styles.providerSwitch}>
          <legend className={styles.pickerLabel}>Provider</legend>
          <div className={styles.providerSeg}>
            {PROVIDERS.map((p) => (
              <label key={p.id} className={provider === p.id ? styles.segOn : ''}>
                <input
                  type="radio"
                  name="proto-c-provider"
                  checked={provider === p.id}
                  onChange={() => onProvider(p.id)}
                />
                {p.label}
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <ol className={styles.steps}>
        <li className={styles.step}>
          <span className={styles.stepKicker}>1 · Client</span>
          <strong>{profile.label}</strong>
          <TopologyPath machine={profile.machine} compact />
          <span className={styles.stepFine}>
            {MACHINES[profile.machine].label} · configured topology, not a live check
          </span>
        </li>

        <li className={`${styles.step} ${only ? styles.stepStrict : ''}`}>
          <span className={styles.stepKicker}>2 · Policy</span>
          <strong>{policyLabel(draft, profile.policies[provider])}</strong>
          <span className={styles.stepFine}>
            {only
              ? 'Strict. Skips the shared pool entirely.'
              : 'Uses the shared pool. Change per account with “Use only this subscription for…”.'}
          </span>
        </li>

        <li className={`${styles.step} ${only ? styles.stepSkipped : ''}`}>
          <span className={styles.stepKicker}>3 · Strategy · global</span>
          {only ? (
            <span className={styles.stepFine}>Skipped — Only ignores the shared strategy.</span>
          ) : (
            <>
              <div className={styles.strategySeg} role="radiogroup" aria-label="Shared strategy">
                {STRATEGIES.map((s) => (
                  <label key={s.id} className={routing.strategy === s.id ? styles.segOn : ''}>
                    <input
                      type="radio"
                      name="proto-c-strategy"
                      checked={routing.strategy === s.id}
                      onChange={() => setRouting({ strategy: s.id })}
                    />
                    {s.label}
                  </label>
                ))}
              </div>
              <span className={styles.stepFine}>{strategyMeta(routing.strategy).blurb}</span>
              <ToggleSwitch
                checked={routing.affinity}
                onChange={(affinity) => setRouting({ affinity })}
                label={`Keep conversations on one account${routing.affinity ? ` (${routing.affinityTtl})` : ''}`}
              />
            </>
          )}
        </li>

        <li className={`${styles.step} ${only ? styles.stepSkipped : ''}`}>
          <span className={styles.stepKicker}>4 · Priority tier</span>
          {only ? (
            <span className={styles.stepFine}>Skipped — priority and weight don’t apply.</span>
          ) : pool && pool.topPriority !== null ? (
            <>
              <strong>
                Priority {pool.topPriority}: {top.map((r) => r.account.label).join(', ')}
              </strong>
              {fallback.length > 0 && (
                <span className={styles.stepFine}>
                  Fallback:{' '}
                  {fallback.map((r) => `${r.account.label} (P${r.account.priority})`).join(', ')}
                </span>
              )}
              {excluded.length > 0 && (
                <span className={styles.stepFine}>
                  Left out: {excluded.map((r) => `${r.account.label} — ${r.reason}`).join('; ')}
                </span>
              )}
            </>
          ) : (
            <strong className={styles.failText}>No eligible account in any tier</strong>
          )}
        </li>

        <li className={`${styles.step} ${styles.stepEnd} ${outcome.fails ? styles.stepFail : ''}`}>
          <span className={styles.stepKicker}>5 · Account</span>
          {outcome.kind === 'only' ? (
            outcome.fails ? (
              <strong className={styles.failText}>Request fails</strong>
            ) : (
              <strong>
                {outcome.account?.label}
                <span className={styles.targetTag}>configured target</span>
              </strong>
            )
          ) : outcome.fails ? (
            <strong className={styles.failText}>Request fails</strong>
          ) : (
            <ShareBar pool={outcome.pool} />
          )}
          <span className={styles.stepFine}>
            {consequenceText(outcome, providerLabel(provider))}
          </span>
        </li>
      </ol>

      <div className={styles.journeySave}>
        <ScopedSave
          groups={['routing']}
          scope={routingScopeText(draft)}
          saveLabel="Save strategy"
          layout="stack"
        />
      </div>
    </aside>
  );
}
