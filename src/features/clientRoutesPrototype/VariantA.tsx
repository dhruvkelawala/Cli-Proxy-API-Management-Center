/**
 * PROTOTYPE (throwaway) — Variant A "Client routes page".
 * Dedicated page: profile list + editor. Each provider gets a segmented Automatic / Only A / Only B
 * choice with a live policy preview; Automatic links to a "Shared pool" panel below that owns the
 * global strategy, affinity, priority and weight. Hard-coded English on purpose.
 */
import { useRef, useState } from 'react';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { IconChevronDown, IconNetwork } from '@/components/ui/icons';
import styles from './VariantA.module.scss';
import { useProtoStore } from './useProtoStore';
import {
  PROVIDERS,
  STRATEGIES,
  accountsFor,
  isDirty,
  policyLabel,
  policyOutcome,
  poolPreview,
  profileScopeText,
  routingScopeText,
  type ProtoPolicy,
  type ProtoProfile,
  type ProviderId,
  type SaveGroup,
} from './prototypeModel';
import {
  PoolLegend,
  ScopedSave,
  ShareBar,
  StatusDot,
  TargetBadge,
  TopologyPath,
  TuningInput,
} from './protoBits';
import { accountTone, consequenceText } from './protoCopy';

export const VARIANT_A_NAME = 'Client routes page';

export function VariantA() {
  const draft = useProtoStore((s) => s.draft);
  const state = useProtoStore();
  const [selectedId, setSelectedId] = useState(draft.profiles[1].id);
  const [poolOpen, setPoolOpen] = useState(true);
  const poolRef = useRef<HTMLElement | null>(null);
  const poolHeadingRef = useRef<HTMLButtonElement | null>(null);
  const profile = draft.profiles.find((p) => p.id === selectedId) ?? draft.profiles[0];

  const openPool = () => {
    setPoolOpen(true);
    requestAnimationFrame(() => {
      poolRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      poolHeadingRef.current?.focus({ preventScroll: true });
    });
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Client routes</h1>
          <p className={styles.meta}>
            <span>{draft.profiles.length} client profiles</span>
            <span aria-hidden="true">·</span>
            <span>Mini gateway, shared by both Macs</span>
          </p>
        </div>
        <span className={styles.topologyChip}>
          <IconNetwork size={14} /> Configured topology · no live checks
        </span>
      </header>

      <div className={styles.layout}>
        <nav className={styles.list} aria-label="Client profiles">
          <ul>
            {draft.profiles.map((p) => {
              const fails = PROVIDERS.some((prov) => policyOutcome(draft, p, prov.id).fails);
              const dirty = isDirty(state, `profile:${p.id}`);
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    className={`${styles.profileItem} ${p.id === profile.id ? styles.profileActive : ''}`}
                    aria-current={p.id === profile.id ? 'true' : undefined}
                    onClick={() => setSelectedId(p.id)}
                  >
                    <span className={styles.profileTop}>
                      <span className={styles.profileName}>{p.label}</span>
                      {dirty && <span className={styles.unsavedChip}>Unsaved</span>}
                    </span>
                    <span className={styles.profileMachine}>
                      {p.machine === 'mini' ? 'Mac mini · local' : 'MacBook · via tunnel'}
                    </span>
                    <span className={styles.profilePolicies}>
                      {PROVIDERS.map((prov) => {
                        const o = policyOutcome(draft, p, prov.id);
                        return (
                          <span key={prov.id} className={styles.profilePolicy}>
                            <StatusDot
                              tone={
                                o.fails ? 'bad' : p.policies[prov.id].mode === 'only' ? 'ok' : 'off'
                              }
                            />
                            <span className={styles.profilePolicyProvider}>{prov.label}</span>
                            <span>{policyLabel(draft, p.policies[prov.id])}</span>
                          </span>
                        );
                      })}
                    </span>
                    {fails && <span className={styles.failLine}>A policy will fail requests</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          <p className={styles.listNote}>
            A profile is the identity a client connects with. Credentials stay on the proxy and are
            never shown here.
          </p>
        </nav>

        <section className={styles.editor} aria-labelledby="proto-a-editor-title">
          <div className={styles.editorHead}>
            <h2 id="proto-a-editor-title" className={styles.editorTitle}>
              {profile.label}
            </h2>
            <TopologyPath machine={profile.machine} />
          </div>

          {PROVIDERS.map((prov) => (
            <ProviderPolicy
              key={`${profile.id}-${prov.id}`}
              profile={profile}
              provider={prov.id}
              onOpenPool={openPool}
            />
          ))}

          <div className={styles.editorSave}>
            <ScopedSave
              groups={[`profile:${profile.id}`]}
              scope={profileScopeText(profile)}
              saveLabel="Save policy"
            />
            <p className={styles.sessionNote}>
              Running sessions keep their connection; reconnect them to pick up a new policy.
            </p>
          </div>
        </section>
      </div>

      <SharedPool
        open={poolOpen}
        onToggle={() => setPoolOpen((v) => !v)}
        sectionRef={poolRef}
        headingRef={poolHeadingRef}
      />
    </div>
  );
}

function ProviderPolicy({
  profile,
  provider,
  onOpenPool,
}: {
  profile: ProtoProfile;
  provider: ProviderId;
  onOpenPool: () => void;
}) {
  const draft = useProtoStore((s) => s.draft);
  const setPolicy = useProtoStore((s) => s.setPolicy);
  const policy = profile.policies[provider];
  const accounts = accountsFor(draft, provider);
  const outcome = policyOutcome(draft, profile, provider);
  const providerName = provider === 'claude' ? 'Claude' : 'Codex';
  const options: {
    key: string;
    label: string;
    policy: ProtoPolicy;
    tone?: ReturnType<typeof accountTone>;
  }[] = [
    { key: 'automatic', label: 'Automatic', policy: { mode: 'automatic' } },
    ...accounts.map((a) => ({
      key: a.id,
      label: `Only ${a.label}`,
      policy: { mode: 'only', accountId: a.id } as ProtoPolicy,
      tone: accountTone(a),
    })),
  ];
  const currentKey = policy.mode === 'automatic' ? 'automatic' : policy.accountId;
  const name = `proto-a-${profile.id}-${provider}`;

  return (
    <fieldset className={styles.provider}>
      <legend className={styles.providerLegend}>
        {providerName} requests
        <span className={styles.providerHint}>Independent of the other provider</span>
      </legend>

      <div className={styles.segmented}>
        {options.map((o) => (
          <label
            key={o.key}
            className={`${styles.segment} ${currentKey === o.key ? styles.segmentOn : ''}`}
          >
            <input
              type="radio"
              name={name}
              checked={currentKey === o.key}
              onChange={() => setPolicy(profile.id, provider, o.policy)}
            />
            {o.tone && <StatusDot tone={o.tone} />}
            <span>{o.label}</span>
          </label>
        ))}
      </div>

      <div
        className={`${styles.preview} ${outcome.fails ? styles.previewFail : ''}`}
        aria-live="polite"
      >
        {outcome.kind === 'only' ? (
          <>
            <div className={styles.previewTop}>
              <span className={styles.previewKicker}>Configured target</span>
              <TargetBadge outcome={outcome} />
            </div>
            <div className={styles.targetLine}>
              <span className={styles.lock} aria-hidden="true">
                ⟶
              </span>
              <strong>{outcome.account?.label ?? 'Removed account'}</strong>
              <span className={styles.targetPlan}>{outcome.account?.plan}</span>
            </div>
            <p className={styles.previewText}>{consequenceText(outcome, providerName)}</p>
            <p className={styles.previewFine}>
              Shared pool strategy, priority and weight don’t apply to an Only policy. This shows
              the configured target, not which account served past requests.
            </p>
          </>
        ) : (
          <>
            <div className={styles.previewTop}>
              <span className={styles.previewKicker}>Eligible shared pool</span>
              <button type="button" className={styles.linkBtn} onClick={onOpenPool}>
                Shared pool settings ↓
              </button>
            </div>
            <ShareBar pool={outcome.pool} />
            <PoolLegend pool={outcome.pool} />
            <p className={styles.previewText}>{consequenceText(outcome, providerName)}</p>
          </>
        )}
      </div>
    </fieldset>
  );
}

function SharedPool({
  open,
  onToggle,
  sectionRef,
  headingRef,
}: {
  open: boolean;
  onToggle: () => void;
  sectionRef: React.RefObject<HTMLElement | null>;
  headingRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const draft = useProtoStore((s) => s.draft);
  const saved = useProtoStore((s) => s.saved);
  const setRouting = useProtoStore((s) => s.setRouting);
  const setEnabled = useProtoStore((s) => s.setEnabled);
  const { routing } = draft;
  const groups: SaveGroup[] = [
    'routing',
    ...draft.accounts.map((a) => `account:${a.id}` as SaveGroup),
  ];

  return (
    <section ref={sectionRef} className={styles.pool} aria-labelledby="proto-a-pool-title">
      <h2 className={styles.poolHeading}>
        <button
          ref={headingRef}
          id="proto-a-pool-title"
          type="button"
          className={styles.poolToggle}
          aria-expanded={open}
          aria-controls="proto-a-pool-body"
          onClick={onToggle}
        >
          <span>
            Shared pool
            <span className={styles.poolSub}>Used by every Automatic client</span>
          </span>
          <span className={styles.poolScope}>{routingScopeText(draft)}</span>
          <IconChevronDown size={16} className={open ? styles.chevOpen : styles.chev} />
        </button>
      </h2>

      {open && (
        <div id="proto-a-pool-body" className={styles.poolBody}>
          <div className={styles.poolSection}>
            <div className={styles.poolLabelRow}>
              <span className={styles.poolLabel} id="proto-a-strategy">
                Strategy for new assignments
              </span>
              <span className={styles.recommend}>
                Recommended for coding: Rotate evenly + Keep conversations on one account
              </span>
            </div>
            <div
              className={styles.strategyGrid}
              role="radiogroup"
              aria-labelledby="proto-a-strategy"
            >
              {STRATEGIES.map((s) => (
                <label
                  key={s.id}
                  className={`${styles.strategy} ${routing.strategy === s.id ? styles.strategyOn : ''}`}
                >
                  <input
                    type="radio"
                    name="proto-a-strategy"
                    checked={routing.strategy === s.id}
                    onChange={() => setRouting({ strategy: s.id })}
                  />
                  <span className={styles.strategyTitle}>
                    {s.label}
                    {saved.routing.strategy === s.id && (
                      <span className={styles.savedTag}>Saved</span>
                    )}
                  </span>
                  <span className={styles.strategyBlurb}>{s.blurb}</span>
                  <code className={styles.wire}>{s.id}</code>
                </label>
              ))}
            </div>
          </div>

          <div className={`${styles.poolSection} ${styles.affinityRow}`}>
            <div>
              <ToggleSwitch
                checked={routing.affinity}
                onChange={(affinity) => setRouting({ affinity })}
                label={<strong>Keep conversations on one account</strong>}
              />
              <p className={styles.poolHint}>
                A healthy conversation keeps its account, even after a higher-priority account
                recovers. Strategy and weights then mostly shape new conversations.
              </p>
            </div>
            <div className={styles.ttl}>
              <label htmlFor="proto-a-ttl">Binding expires after</label>
              <input
                id="proto-a-ttl"
                className="input"
                value={routing.affinityTtl}
                disabled={!routing.affinity}
                onChange={(e) => setRouting({ affinityTtl: e.target.value })}
              />
            </div>
          </div>

          {PROVIDERS.map((prov) => {
            const pool = poolPreview(draft, prov.id);
            return (
              <div key={prov.id} className={styles.poolSection}>
                <span className={styles.poolLabel}>{prov.label} accounts</span>
                <div
                  className={styles.accountTable}
                  role="table"
                  aria-label={`${prov.label} accounts`}
                >
                  <div className={styles.accountHead} role="row">
                    <span role="columnheader">Account</span>
                    <span role="columnheader">Enabled</span>
                    <span role="columnheader">Priority</span>
                    <span role="columnheader">Weight</span>
                    <span role="columnheader">Role in pool</span>
                  </div>
                  {pool.rows.map((r) => (
                    <div key={r.account.id} className={styles.accountRow} role="row">
                      <span role="cell" className={styles.accountName}>
                        <StatusDot tone={accountTone(r.account)} />
                        <span>
                          <strong>{r.account.label}</strong>
                          <span className={styles.accountAvail}>
                            {r.account.enabled
                              ? r.account.availability === 'unknown'
                                ? 'Availability unknown'
                                : r.account.availability === 'available'
                                  ? 'Available'
                                  : 'Unavailable'
                              : 'Off by choice'}
                          </span>
                        </span>
                      </span>
                      <span role="cell">
                        <ToggleSwitch
                          checked={r.account.enabled}
                          onChange={(v) => setEnabled(r.account.id, v)}
                          ariaLabel={`${r.account.label} enabled`}
                        />
                      </span>
                      <span role="cell">
                        <TuningInput
                          account={r.account}
                          field="priority"
                          compact
                          showLabel={false}
                        />
                      </span>
                      <span role="cell">
                        <TuningInput
                          account={r.account}
                          field="weight"
                          compact
                          showLabel={false}
                          inactive={routing.strategy !== 'weighted-round-robin'}
                        />
                      </span>
                      <span role="cell" className={styles.role}>
                        {r.reason}
                      </span>
                    </div>
                  ))}
                </div>
                <ShareBar pool={pool} compact />
              </div>
            );
          })}

          <div className={styles.poolSave}>
            <ScopedSave
              groups={groups}
              scope={`${routingScopeText(draft)}. Priority and weight edits affect every Automatic client using that account.`}
              saveLabel="Save shared routing"
            />
            <p className={styles.sessionNote}>
              Only-profiles ignore these settings. Enabling or disabling an account saves
              immediately, as on the Accounts page.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
