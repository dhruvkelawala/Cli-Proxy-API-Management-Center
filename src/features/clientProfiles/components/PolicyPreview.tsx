import { useTranslation } from 'react-i18next';
import type { ClientProfileTargetState } from '@/types/clientProfiles';
import { isFailingTargetState, type PoolPreview } from '../model';
import { CR, targetStateKey } from '../copy';
import { ShareBar } from './PolicyPill';
import styles from './PolicyPreview.module.scss';

type PolicyPreviewProps =
  | { kind: 'automatic'; providerName: string; pool: PoolPreview }
  | {
      kind: 'only';
      providerName: string;
      accountLabel: string | null;
      state: ClientProfileTargetState;
    };

/**
 * Read-only preview. Only: the configured target and strict failure behaviour.
 * Automatic: the eligible shared pool with illustrative shares. Never "served by".
 */
export function PolicyPreview(props: PolicyPreviewProps) {
  const { t } = useTranslation();

  if (props.kind === 'only') {
    const account = props.accountLabel ?? t(`${CR}.pill.removed_account`);
    const fails = isFailingTargetState(props.state);
    return (
      <section className={styles.preview} aria-labelledby="client-routes-preview-title">
        <h3 id="client-routes-preview-title" className={styles.heading}>
          {t(`${CR}.preview.title`)}
        </h3>
        <div className={styles.target}>
          <span className={styles.targetLabel}>{t(`${CR}.preview.configured_target`)}</span>
          <span className={styles.targetName}>{account}</span>
          <span className={fails ? styles.stateFail : styles.state}>
            {t(targetStateKey(props.state))}
          </span>
        </div>
        <p className={fails ? styles.fail : styles.lead}>
          {fails
            ? t(`${CR}.preview.only_fail`, {
                provider: props.providerName,
                reason: t(targetStateKey(props.state)),
              })
            : props.state === 'available'
              ? t(`${CR}.preview.only_ok`, { provider: props.providerName, account })
              : t(`${CR}.preview.only_unknown`, { provider: props.providerName, account })}
        </p>
        <p className={styles.note}>{t(`${CR}.preview.only_note`)}</p>
      </section>
    );
  }

  const { pool, providerName } = props;
  return (
    <section className={styles.preview} aria-labelledby="client-routes-preview-title">
      <h3 id="client-routes-preview-title" className={styles.heading}>
        {t(`${CR}.preview.pool_title`, { provider: providerName })}
      </h3>
      {!pool.known ? (
        <p className={styles.lead}>{t(`${CR}.preview.pool_unknown`)}</p>
      ) : !pool.hasParticipants ? (
        <p className={styles.fail}>{t(`${CR}.preview.pool_empty`, { provider: providerName })}</p>
      ) : (
        <>
          <p className={styles.lead}>{t(`${CR}.preview.pool_body`, { provider: providerName })}</p>
          <ShareBar pool={pool} />
          <ul className={styles.members}>
            {pool.members.map((member) => {
              const share =
                member.sharePercent === null
                  ? t(`${CR}.preview.member_excluded`)
                  : member.reason === 'standby'
                    ? t(`${CR}.preview.member_standby`)
                    : t(`${CR}.preview.member_share`, {
                        percent: Math.round(member.sharePercent),
                      });
              return (
                <li key={member.id} className={styles.member}>
                  <span className={styles.memberHead}>
                    <span className={styles.memberName}>{member.label}</span>
                    <span className={styles.memberShare}>{share}</span>
                  </span>
                  <span className={styles.memberReason}>{t(member.reasonKey)}</span>
                </li>
              );
            })}
          </ul>
          <p className={styles.note}>{t(`${CR}.preview.shares_note`)}</p>
        </>
      )}
    </section>
  );
}
