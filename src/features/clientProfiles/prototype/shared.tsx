/** PROTOTYPE (throwaway): small pieces shared by the friendly Client routes variants. */
import { useEffect, type ReactNode } from 'react';
import {
  AFFINITY_COPY,
  STRICT_WARNING,
  describeChoice,
  describeMacs,
  describeServing,
  formatWhen,
  type Arrangement,
  type ProtoAccount,
  type ProtoModel,
} from './useProtoRoutesModel';
import styles from './Prototype.module.scss';

/** Health in one quiet line: a state dot (the only colour) and words. */
export function Health({ account }: { account: ProtoAccount }) {
  return (
    <span className={styles.health}>
      <span className={styles.dot} data-health={account.health} aria-hidden="true" />
      {account.healthText}
    </span>
  );
}

const weeklyText = (account: ProtoAccount): string | null => {
  const { quota } = account;
  if (account.health === 'disabled') return null;
  if (quota.status === 'loading') return 'Checking what’s left…';
  if (quota.status !== 'ready' || quota.weekLeft === null) return null;
  const reset = quota.weekResetAt ? ` · resets ${formatWhen(quota.weekResetAt)}` : '';
  return `${quota.weekLeft}% left this week${reset}`;
};

/** Hairline meter for weekly room left. */
export function WeeklyMeter({
  account,
  showText = true,
}: {
  account: ProtoAccount;
  showText?: boolean;
}) {
  const text = weeklyText(account);
  const left = account.quota.weekLeft;
  return (
    <div className={styles.weekly}>
      {left !== null && account.quota.status === 'ready' && (
        <span
          className={styles.meter}
          role="meter"
          aria-label={`${account.label}: weekly room left`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={left}
        >
          <span
            className={styles.meterFill}
            data-low={left < 20}
            style={{ transform: `scaleX(${Math.max(left, 1) / 100})` }}
          />
        </span>
      )}
      {showText && text && <span className={styles.weeklyText}>{text}</span>}
    </div>
  );
}

export function MacGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg
      className={styles.macGlyph}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="4" y="5" width="16" height="11" rx="1.8" />
      <path d="M2.5 19h19" />
    </svg>
  );
}

/** The two-sentence answer: where new conversations go, and what happens if it runs out. */
export function Serving({ model }: { model: ProtoModel }) {
  const { lead, follow } = describeServing(model);
  return (
    <div className={styles.serving} aria-live="polite">
      <p className={styles.lead}>{lead}</p>
      <p className={styles.follow}>{follow}</p>
    </div>
  );
}

/** Quiet footer: both Macs follow the order; Codex has nothing to choose. */
export function Footnotes({ model }: { model: ProtoModel }) {
  const macs = describeMacs(model);
  return (
    <div className={styles.footnotes}>
      <p data-problem={macs.problem}>
        <MacGlyph />
        {macs.text}
      </p>
      {model.codex.accounts > 0 && (
        <p>
          <span className={styles.codexMark} aria-hidden="true">
            ◇
          </span>
          Codex uses its{' '}
          {model.codex.accounts === 1 ? 'one account' : `${model.codex.accounts} accounts`}{' '}
          automatically. Nothing to choose.
        </p>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.advSection}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}

const ARRANGEMENTS: { key: Arrangement; title: string; body: string }[] = [
  { key: 'backup', title: 'First and backup', body: 'One account at a time, in your order.' },
  { key: 'turns', title: 'Take turns', body: 'New conversations alternate between accounts.' },
  {
    key: 'split',
    title: 'Split by weight',
    body: 'Like taking turns, but one gets a bigger share.',
  },
];

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { key: T; label: string }[];
  onChange: (next: T) => void;
}) {
  const index = options.findIndex((option) => option.key === value);
  return (
    <div
      className={styles.segmented}
      role="radiogroup"
      aria-label={label}
      data-arrow-keys
      onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        const step = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
        const next = options[(index + step + options.length) % options.length];
        onChange(next.key);
        requestAnimationFrame(() =>
          (
            event.currentTarget.querySelector('[aria-checked="true"]') as HTMLElement | null
          )?.focus()
        );
      }}
    >
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          role="radio"
          aria-checked={option.key === value}
          tabIndex={option.key === value ? 0 : -1}
          onClick={() => onChange(option.key)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Advanced({ model, open }: { model: ProtoModel; open?: boolean }) {
  const [first, second] = model.order;
  const notReady = model.accounts.filter((account) => !account.ready);
  const total = (first?.weight ?? 1) + (second?.weight ?? 1);
  const firstShare = first && second ? Math.round(((first.weight || 0) / (total || 1)) * 100) : 50;
  return (
    <details className={styles.advanced} open={open}>
      <summary>Advanced</summary>
      <div className={styles.advBody}>
        <Section title="How accounts are used">
          <div className={styles.arrangements} role="radiogroup" aria-label="How accounts are used">
            {ARRANGEMENTS.map((item) => (
              <button
                key={item.key}
                type="button"
                role="radio"
                aria-checked={model.arrangement === item.key}
                onClick={() => model.setArrangement(item.key)}
              >
                <strong>{item.title}</strong>
                <span>{item.body}</span>
              </button>
            ))}
          </div>
          {model.arrangement === 'split' && first && second && (
            <label className={styles.split}>
              <span>
                {first.label} {firstShare}%
              </span>
              <input
                type="range"
                min={10}
                max={90}
                step={5}
                value={firstShare}
                aria-label={`${first.label} share`}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  model.setWeight(first.id, value);
                  model.setWeight(second.id, 100 - value);
                }}
              />
              <span>
                {second.label} {100 - firstShare}%
              </span>
            </label>
          )}
        </Section>

        <Section title="Conversations">
          <div className={styles.switchRow}>
            <span>
              <strong>Keep each conversation on one account</strong>
              {model.sessionAffinity ? AFFINITY_COPY.on : AFFINITY_COPY.off}
            </span>
            <Switch
              checked={model.sessionAffinity}
              onChange={model.setSessionAffinity}
              label="Keep each conversation on one account"
            />
          </div>
        </Section>

        <Section title="Lock a Mac to one account">
          <p className={styles.advNote}>
            Locked Macs skip the order above. If their account runs out, they stop instead of
            switching.
          </p>
          {model.clients.map((client) => (
            <div key={client.ref} className={styles.lockRow}>
              <span className={styles.lockName}>
                <MacGlyph />
                {client.shortName}
              </span>
              <Segmented
                label={`${client.shortName} account`}
                value={client.choice}
                options={[
                  { key: 'auto', label: 'Follow order' },
                  ...model.order.map((account) => ({
                    key: account.id,
                    label: `Only ${account.label}`,
                  })),
                ]}
                onChange={(choice) => model.setChoice(client.ref, choice)}
              />
              {client.target && (
                <p className={styles.lockWarn} data-broken={client.broken}>
                  {client.broken
                    ? describeChoice(client, model)
                    : STRICT_WARNING(client.shortName, client.target.label)}
                </p>
              )}
            </div>
          ))}
        </Section>

        <Section title="Setup">
          <ul className={styles.advList}>
            {model.clients.map((client) => (
              <li key={client.ref}>
                {client.shortName}:{' '}
                {client.keyCount === 0
                  ? 'no client key linked yet.'
                  : `${client.keyCount} client key${client.keyCount === 1 ? '' : 's'} linked.`}
              </li>
            ))}
            {notReady.map((account) => (
              <li key={account.id}>
                {account.label} gets a one-time setup the first time a Mac is locked to it.
              </li>
            ))}
            {model.enforcement === false && (
              <li>
                This gateway doesn’t enforce locks yet; locked Macs are refused until it does.
              </li>
            )}
          </ul>
          <a className={styles.advLink} href="#/client-routes?variant=0">
            Open the full client routes editor
          </a>
        </Section>
      </div>
    </details>
  );
}

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={styles.switch}
      onClick={() => onChange(!checked)}
    />
  );
}

export function ProtoToast({ model }: { model: ProtoModel }) {
  const { toast, dismissToast } = model;
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(dismissToast, 4200);
    return () => window.clearTimeout(timer);
  }, [toast, dismissToast]);
  if (!toast) return null;
  return (
    <div className={styles.toast} role="status" key={toast.id}>
      <div>
        <strong>{toast.text}</strong>
        <span>{toast.detail}</span>
      </div>
      <button type="button" onClick={dismissToast} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}
