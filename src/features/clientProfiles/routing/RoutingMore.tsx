import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { IconPlus } from '@/components/ui/icons';
import { DeviceGlyph } from '@/components/flow';
import type { AuthFileItem } from '@/types';
import type {
  ClientProfile,
  ClientProfileProvider,
  ClientProfilesSnapshot,
} from '@/types/clientProfiles';
import { accountDisplayLabel, matrixCellId } from '../model';
import type { ClientRoute } from './routingOrder';
import styles from './RoutingPage.module.scss';

export interface RoutingMoreProps {
  /** Shared strategy, session affinity and Priorities & weights (the existing band). */
  band: ReactNode;
  /** Claude rule per client; null when the gateway has no client profiles API. */
  routes: ClientRoute[] | null;
  snapshot: ClientProfilesSnapshot | null;
  files: AuthFileItem[] | null;
  /** Shown above the clients (enforcement / unsupported notices). */
  notices?: ReactNode;
  onEditRule: (profileRef: string, provider: ClientProfileProvider) => void;
  onOpenProfile: (profileRef: string | null) => void;
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className={styles.moreSection}>
      <h2 className={styles.moreTitle}>{title}</h2>
      {note ? <p className={styles.moreNote}>{note}</p> : null}
      {children}
    </section>
  );
}

/** Rare options for the Routing page, shown inside its single More disclosure. */
export function RoutingMore({
  band,
  routes,
  snapshot,
  files,
  notices,
  onEditRule,
  onOpenProfile,
}: RoutingMoreProps) {
  const { t } = useTranslation();

  const codexRule = (profile: ClientProfile): string => {
    const policy = profile.policies.codex;
    if (policy.mode === 'automatic') return t('routing.rule.automatic');
    if (policy.mode !== 'only') return t('routing.rule.unknown');
    const matches = (snapshot?.accounts ?? []).filter((a) => a.accountRef === policy.accountRef);
    return matches.length === 1
      ? t('routing.rule.only', { account: accountDisplayLabel(matches[0], files) })
      : t('routing.rule.only_missing');
  };
  const claudeRule = (route: ClientRoute): string => {
    if (!route.locked) return t('routing.rule.follows');
    if (route.profile.policies.claude.mode !== 'only') return t('routing.rule.unknown');
    return route.target
      ? t('routing.rule.only', { account: route.target.label })
      : t('routing.rule.only_missing');
  };
  const keyCount = (profileRef: string) =>
    (snapshot?.keys ?? []).filter((key) => key.profileRef === profileRef).length;

  return (
    <div className={styles.more}>
      {/* The shared band carries its own heading ("Shared pool"). */}
      <div className={styles.moreSection}>{band}</div>

      {!(routes && routes.length > 0) && notices}

      {routes && routes.length > 0 && (
        <Section
          title={t('routing.more_sections.locks')}
          note={t('routing.more_sections.locks_note')}
        >
          {notices}
          <ul className={styles.rows}>
            {routes.map((route) => (
              <li key={route.profile.profileRef} className={styles.row}>
                <span className={styles.rowName}>
                  <DeviceGlyph />
                  <span>{route.shortName}</span>
                </span>
                <span className={styles.rowRules}>
                  <span className={styles.rowRule} data-locked={route.locked}>
                    {t('routing.rule.claude', { rule: claudeRule(route) })}
                  </span>
                  <span className={styles.rowRuleQuiet}>
                    {t('routing.rule.codex', { rule: codexRule(route.profile) })}
                  </span>
                  {route.locked && (
                    <span className={styles.rowWarn} data-broken={route.broken}>
                      {route.broken
                        ? t('routing.rule.broken', { client: route.shortName })
                        : t('routing.rule.strict_warning', {
                            client: route.shortName,
                            account: route.target?.label ?? '',
                          })}
                    </span>
                  )}
                </span>
                <span className={styles.rowActions}>
                  <button
                    type="button"
                    className={styles.textButton}
                    data-cell={matrixCellId(route.profile.profileRef, 'claude')}
                    aria-label={t('routing.rule.change_aria', { client: route.shortName })}
                    onClick={() => onEditRule(route.profile.profileRef, 'claude')}
                  >
                    {t('routing.rule.change')}
                  </button>
                  <button
                    type="button"
                    className={styles.textButton}
                    data-cell={matrixCellId(route.profile.profileRef, 'codex')}
                    aria-label={t('routing.rule.change_codex_aria', { client: route.shortName })}
                    onClick={() => onEditRule(route.profile.profileRef, 'codex')}
                  >
                    {t('routing.rule.change_codex')}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {routes && (
        <Section
          title={t('routing.more_sections.clients')}
          note={t('routing.more_sections.clients_note')}
        >
          {routes.length > 0 && (
            <ul className={styles.rows}>
              {routes.map((route) => {
                const count = keyCount(route.profile.profileRef);
                return (
                  <li key={route.profile.profileRef} className={styles.row}>
                    <span className={styles.rowName}>
                      <DeviceGlyph />
                      <span>{route.profile.label}</span>
                    </span>
                    <span className={styles.rowRules}>
                      <span className={styles.rowRuleQuiet}>
                        {count === 0 ? t('routing.keys.none') : t('routing.keys.count', { count })}
                      </span>
                    </span>
                    <span className={styles.rowActions}>
                      <button
                        type="button"
                        className={styles.textButton}
                        aria-label={t('routing.keys.manage_aria', { client: route.profile.label })}
                        onClick={() => onOpenProfile(route.profile.profileRef)}
                      >
                        {t('routing.keys.manage')}
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <div>
            <Button variant="secondary" size="sm" onClick={() => onOpenProfile(null)}>
              <IconPlus size={14} aria-hidden="true" />
              {t('routing.keys.new_client')}
            </Button>
          </div>
        </Section>
      )}
    </div>
  );
}
