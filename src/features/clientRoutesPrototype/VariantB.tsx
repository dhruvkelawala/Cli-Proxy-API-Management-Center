/**
 * PROTOTYPE (throwaway) — Variant B "Matrix".
 * One overview grid: rows = client profiles, columns = providers, each cell a policy pill. A cell
 * opens a side sheet to change that single policy. The global shared-pool strategy sits as a
 * compact band above the matrix; priorities/weights live in their own sheet. Hard-coded English.
 */
import { useState } from 'react';
import { Sheet } from '@/components/ui/Sheet';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { Button } from '@/components/ui/Button';
import { IconSlidersHorizontal } from '@/components/ui/icons';
import styles from './VariantB.module.scss';
import { useProtoStore } from './useProtoStore';
import {
  PROVIDERS,
  STRATEGIES,
  accountsFor,
  automaticProfilesFor,
  formatShare,
  isDirty,
  pinnedProfiles,
  policyLabel,
  policyOutcome,
  poolPreview,
  profileScopeText,
  providerLabel,
  routingScopeText,
  strategyMeta,
  targetStateText,
  type ProtoPolicy,
  type ProviderId,
  type SaveGroup,
} from './prototypeModel';
import {
  PoolLegend,
  ScopedSave,
  ShareBar,
  StatusDot,
  TopologyPath,
  TuningInput,
} from './protoBits';
import { accountTone, consequenceText } from './protoCopy';

export const VARIANT_B_NAME = 'Matrix';

type CellRef = { profileId: string; provider: ProviderId } | null;

export function VariantB() {
  const state = useProtoStore();
  const { draft } = state;
  const [cell, setCell] = useState<CellRef>(null);
  const [tuningOpen, setTuningOpen] = useState(false);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Client routes</h1>
        <p className={styles.lede}>
          Which subscription each client may use. Pick a cell to change one policy.
        </p>
      </header>

      <StrategyBand onOpenTuning={() => setTuningOpen(true)} />

      <div className={styles.matrixWrap}>
        <table className={styles.matrix} aria-label="Client policies by provider">
          <thead>
            <tr>
              <th scope="col">Client profile</th>
              {PROVIDERS.map((p) => (
                <th key={p.id} scope="col">
                  {p.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {draft.profiles.map((profile) => {
              const dirty = isDirty(state, `profile:${profile.id}`);
              return (
                <tr key={profile.id}>
                  <th scope="row" className={styles.rowHead}>
                    <span className={styles.profileName}>
                      {profile.label}
                      {dirty && (
                        <span className={styles.unsaved} title="Unsaved changes">
                          Unsaved
                        </span>
                      )}
                    </span>
                    <TopologyPath machine={profile.machine} compact />
                  </th>
                  {PROVIDERS.map((prov) => {
                    const outcome = policyOutcome(draft, profile, prov.id);
                    const label = policyLabel(draft, profile.policies[prov.id]);
                    const status =
                      outcome.kind === 'only'
                        ? targetStateText[outcome.state]
                        : outcome.fails
                          ? 'No eligible account · requests fail'
                          : outcome.pool.rows
                              .filter((r) => r.status === 'share')
                              .map((r) => `${r.account.label} ${formatShare(r.share)}`)
                              .join(' · ');
                    return (
                      <td key={prov.id} data-label={prov.label} className={styles.cellTd}>
                        <button
                          type="button"
                          className={`${styles.cell} ${
                            outcome.kind === 'only' ? styles.cellOnly : styles.cellAuto
                          } ${outcome.fails ? styles.cellFail : ''}`}
                          aria-label={`${prov.label} policy for ${profile.label}: ${label}. ${status}. Edit`}
                          onClick={() => setCell({ profileId: profile.id, provider: prov.id })}
                        >
                          <span className={styles.pill}>
                            {outcome.kind === 'only' ? (
                              <span className={styles.pin} aria-hidden="true">
                                ●
                              </span>
                            ) : null}
                            {label}
                          </span>
                          {outcome.kind === 'pool' && !outcome.fails && (
                            <ShareBar pool={outcome.pool} compact caption={false} />
                          )}
                          <span className={styles.cellStatus}>
                            {outcome.kind === 'only' && (
                              <StatusDot
                                tone={
                                  outcome.fails
                                    ? 'bad'
                                    : outcome.state === 'unknown'
                                      ? 'unknown'
                                      : 'ok'
                                }
                              />
                            )}
                            {status}
                          </span>
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className={styles.caption}>
          Policies are enforced by the Mini gateway for every request made with that profile.
        </p>
      </div>

      <section className={styles.accounts} aria-labelledby="proto-b-accounts">
        <h2 id="proto-b-accounts" className={styles.sectionTitle}>
          Subscriptions
        </h2>
        <ul className={styles.accountList}>
          {draft.accounts.map((a) => {
            const pinned = pinnedProfiles(draft, a.id).length;
            const auto = automaticProfilesFor(draft, a.provider).length;
            return (
              <li key={a.id} className={`${styles.account} ${!a.enabled ? styles.accountOff : ''}`}>
                <StatusDot tone={accountTone(a)} />
                <span className={styles.accountText}>
                  <strong>{a.label}</strong>
                  <span>
                    {a.enabled
                      ? a.availability === 'unknown'
                        ? 'Availability unknown'
                        : a.availability === 'available'
                          ? 'Available'
                          : 'Unavailable'
                      : 'Disabled'}
                    {' · '}
                    {pinned} pinned · pool for {auto} Automatic
                  </span>
                </span>
                <ToggleSwitch
                  checked={a.enabled}
                  onChange={(v) => state.setEnabled(a.id, v)}
                  ariaLabel={`${a.label} enabled`}
                />
              </li>
            );
          })}
        </ul>
      </section>

      <PolicySheet cell={cell} onClose={() => setCell(null)} />
      <TuningSheet open={tuningOpen} onClose={() => setTuningOpen(false)} />
    </div>
  );
}

function StrategyBand({ onOpenTuning }: { onOpenTuning: () => void }) {
  const draft = useProtoStore((s) => s.draft);
  const saved = useProtoStore((s) => s.saved);
  const setRouting = useProtoStore((s) => s.setRouting);
  const { routing } = draft;

  return (
    <section className={styles.band} aria-labelledby="proto-b-band">
      <div className={styles.bandHead}>
        <h2 id="proto-b-band" className={styles.bandTitle}>
          Shared pool
          <span className={styles.bandSub}>for Automatic cells</span>
        </h2>
        <span className={styles.globalChip}>{routingScopeText(draft)}</span>
      </div>

      <div className={styles.bandControls}>
        <div className={styles.bandStrategy} role="radiogroup" aria-labelledby="proto-b-band">
          {STRATEGIES.map((s) => (
            <label
              key={s.id}
              className={`${styles.bandOption} ${routing.strategy === s.id ? styles.bandOptionOn : ''}`}
              title={s.blurb}
            >
              <input
                type="radio"
                name="proto-b-strategy"
                checked={routing.strategy === s.id}
                onChange={() => setRouting({ strategy: s.id })}
              />
              {s.label}
            </label>
          ))}
        </div>
        <div className={styles.bandAffinity}>
          <ToggleSwitch
            checked={routing.affinity}
            onChange={(affinity) => setRouting({ affinity })}
            label="Keep conversations on one account"
          />
          <label className={styles.ttl}>
            <span>for</span>
            <input
              className="input"
              value={routing.affinityTtl}
              disabled={!routing.affinity}
              aria-label="Conversation binding TTL"
              onChange={(e) => setRouting({ affinityTtl: e.target.value })}
            />
          </label>
        </div>
        <Button variant="secondary" size="sm" onClick={onOpenTuning}>
          <IconSlidersHorizontal size={15} /> Priorities &amp; weights
        </Button>
      </div>

      <p className={styles.bandBlurb}>
        {strategyMeta(routing.strategy).blurb}
        {routing.strategy !== saved.routing.strategy &&
          ` (Saved: ${strategyMeta(saved.routing.strategy).label}.)`}{' '}
        <span className={styles.recommend}>
          Recommended for coding: Rotate evenly with conversations kept on one account.
        </span>
      </p>

      <ScopedSave
        groups={['routing']}
        scope="Strategy and conversation settings"
        saveLabel="Save"
      />
    </section>
  );
}

function PolicySheet({ cell, onClose }: { cell: CellRef; onClose: () => void }) {
  const draft = useProtoStore((s) => s.draft);
  const setPolicy = useProtoStore((s) => s.setPolicy);
  const [last, setLast] = useState<CellRef>(cell);
  if (cell && cell !== last) setLast(cell);
  const shown = cell ?? last;
  const profile = shown ? draft.profiles.find((p) => p.id === shown.profileId) : undefined;
  if (!shown || !profile) return <Sheet open={false} onClose={onClose} />;
  const provider = shown.provider;
  const policy = profile.policies[provider];
  const outcome = policyOutcome(draft, profile, provider);
  const pool = poolPreview(draft, provider);
  const options: { key: string; policy: ProtoPolicy }[] = [
    { key: 'automatic', policy: { mode: 'automatic' } },
    ...accountsFor(draft, provider).map((a) => ({
      key: a.id,
      policy: { mode: 'only', accountId: a.id } as ProtoPolicy,
    })),
  ];
  const currentKey = policy.mode === 'automatic' ? 'automatic' : policy.accountId;

  return (
    <Sheet
      open={cell !== null}
      onClose={onClose}
      eyebrow={`${providerLabel(provider)} policy`}
      title={profile.label}
      description={<TopologyPath machine={profile.machine} compact />}
      footer={
        <ScopedSave
          groups={[`profile:${profile.id}`]}
          scope={profileScopeText(profile, provider)}
          saveLabel="Save policy"
        />
      }
    >
      <fieldset className={styles.choiceList}>
        <legend className={styles.choiceLegend}>
          Which {providerLabel(provider)} subscription may this profile use?
        </legend>
        {options.map((o) => {
          const account =
            o.policy.mode === 'only' ? draft.accounts.find((a) => a.id === o.key) : null;
          const fails = account
            ? !account.enabled || account.availability === 'unavailable'
            : !pool.anyEligible;
          return (
            <label
              key={o.key}
              className={`${styles.choice} ${currentKey === o.key ? styles.choiceOn : ''}`}
            >
              <input
                type="radio"
                name={`proto-b-${profile.id}-${provider}`}
                checked={currentKey === o.key}
                onChange={() => setPolicy(profile.id, provider, o.policy)}
              />
              <span className={styles.choiceBody}>
                <span className={styles.choiceTitle}>
                  {account ? `Only ${account.label}` : 'Automatic'}
                  {account && <StatusDot tone={accountTone(account)} />}
                </span>
                <span className={styles.choiceText}>
                  {account
                    ? `Strict. ${account.label} or an error — never another account.`
                    : 'Shared pool. The global strategy picks an eligible account.'}
                </span>
                {fails && (
                  <span className={styles.choiceWarn}>
                    {account
                      ? `${account.label} is ${account.enabled ? 'unavailable' : 'disabled'}: requests would fail.`
                      : 'No eligible account right now: requests would fail.'}
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </fieldset>

      <div className={`${styles.what} ${outcome.fails ? styles.whatFail : ''}`} aria-live="polite">
        <h3 className={styles.whatTitle}>What happens</h3>
        <p>{consequenceText(outcome, providerLabel(provider))}</p>
        {outcome.kind === 'pool' ? (
          <>
            <ShareBar pool={outcome.pool} />
            <PoolLegend pool={outcome.pool} />
          </>
        ) : (
          <p className={styles.fine}>
            Strategy, priority and weight are ignored for Only. The configured target is not proof
            of which account served a past request.
          </p>
        )}
      </div>
      <p className={styles.fine}>
        Running sessions keep their connection; reconnect them to pick up a new policy.
      </p>
    </Sheet>
  );
}

function TuningSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const draft = useProtoStore((s) => s.draft);
  const groups = draft.accounts.map((a) => `account:${a.id}` as SaveGroup);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      eyebrow="Shared pool"
      title="Priorities & weights"
      description="Higher priority wins new assignments; equal priorities share; lower priorities are fallback. Weights matter only for Weighted split."
      footer={
        <ScopedSave
          groups={groups}
          scope="Affects every Automatic client that can use these accounts, on both Macs"
          saveLabel="Save accounts"
        />
      }
    >
      {PROVIDERS.map((prov) => {
        const pool = poolPreview(draft, prov.id);
        return (
          <section key={prov.id} className={styles.tuneGroup}>
            <h3 className={styles.whatTitle}>{prov.label}</h3>
            {pool.rows.map((r) => (
              <div key={r.account.id} className={styles.tuneRow}>
                <span className={styles.tuneName}>
                  <StatusDot tone={accountTone(r.account)} />
                  <strong>{r.account.label}</strong>
                </span>
                <TuningInput account={r.account} field="priority" compact />
                <TuningInput
                  account={r.account}
                  field="weight"
                  compact
                  inactive={draft.routing.strategy !== 'weighted-round-robin'}
                />
              </div>
            ))}
            <ShareBar pool={pool} />
            <PoolLegend pool={pool} />
          </section>
        );
      })}
    </Sheet>
  );
}
