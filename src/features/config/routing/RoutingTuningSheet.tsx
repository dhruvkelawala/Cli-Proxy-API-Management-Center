import { useTranslation } from 'react-i18next';
import { Sheet } from '@/components/ui/Sheet';
import type { RoutingStrategy } from '@/types/visualConfig';
import { RoutingSaveRow } from './RoutingSaveRow';
import { describeAccountSaveStatus } from './routingStatus';
import { RoutingTuningPanel } from './RoutingTuningPanel';
import { accountsScopeText } from './routingScope';
import type { useRoutingSettings } from './useRoutingSettings';
import styles from './RoutingTuningSheet.module.scss';

type RoutingAccounts = ReturnType<typeof useRoutingSettings>['accounts'];

export interface RoutingTuningSheetProps {
  open: boolean;
  onClose: () => void;
  strategy: RoutingStrategy;
  sessionAffinity: { enabled: boolean; ttl?: string };
  accounts: RoutingAccounts;
  automaticClientCount?: number;
}

export function RoutingTuningSheet({
  open,
  onClose,
  strategy,
  sessionAffinity,
  accounts,
  automaticClientCount,
}: RoutingTuningSheetProps) {
  const { t } = useTranslation();
  const status = describeAccountSaveStatus(t, accounts);
  const saving = accounts.save.phase === 'saving';
  const dirty = accounts.dirtyNames.length > 0;
  // Failed accounts keep their drafts, so Discard stays available even when nothing is "dirty".
  const hasDrafts = Object.keys(accounts.edits).length > 0;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="lg"
      eyebrow={t('config_management.routing_settings.sheet.eyebrow')}
      title={t('config_management.routing_settings.sheet.title')}
      description={t('config_management.routing_settings.sheet.description')}
      footer={
        <RoutingSaveRow
          scope={accountsScopeText(t, automaticClientCount)}
          status={status.text}
          tone={status.tone}
          saveLabel={t('config_management.routing_settings.sheet.save')}
          saveDisabled={!dirty || accounts.hasErrors || saving}
          discardDisabled={!hasDrafts}
          saving={saving}
          onSave={() => void accounts.saveAll()}
          onDiscard={accounts.discard}
        />
      }
    >
      <p className={styles.separate}>
        {t('config_management.routing_settings.sheet.separate_saves')}
      </p>
      <RoutingTuningPanel
        strategy={strategy}
        sessionAffinity={sessionAffinity}
        files={accounts.files}
        loading={accounts.loading}
        error={accounts.error}
        edits={accounts.edits}
        errors={accounts.errors}
        save={accounts.save}
        onChange={accounts.setTuning}
        onRetry={() => void accounts.load()}
      />
    </Sheet>
  );
}
