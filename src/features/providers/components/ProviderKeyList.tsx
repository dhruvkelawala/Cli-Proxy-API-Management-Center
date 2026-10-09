import { useTranslation } from 'react-i18next';
import { ActionMenu, StatusDot } from '@/components/flow';
import flow from '@/components/flow/flowPage.module.scss';
import { IconSidebarMore } from '@/components/ui/icons';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import type { ProviderGroup, ProviderResource } from '../types';
import { ProviderLogo } from './ProviderLogo';
import styles from './ProviderKeyList.module.scss';

interface ProviderKeyListProps {
  groups: ProviderGroup[];
  selectedId: string | null;
  disableMutations?: boolean;
  onView: (resource: ProviderResource) => void;
  onEdit: (resource: ProviderResource) => void;
  onDelete: (resource: ProviderResource) => void;
  onToggleDisabled: (resource: ProviderResource, disabled: boolean) => void;
  onAdd: (brand: ProviderGroup['id']) => void;
}

const keyLabel = (resource: ProviderResource) =>
  resource.brand === 'openaiCompatibility'
    ? (resource.name ?? resource.identifier)
    : (resource.apiKeyPreview ?? resource.identifier);

/**
 * Configured provider keys, grouped by provider: one hairline row per key with its state, an
 * on/off switch and a short menu. The full table (search, sort, model filter) lives under More.
 */
export function ProviderKeyList({
  groups,
  selectedId,
  disableMutations = false,
  onView,
  onEdit,
  onDelete,
  onToggleDisabled,
  onAdd,
}: ProviderKeyListProps) {
  const { t } = useTranslation();

  const describe = (resource: ProviderResource) => {
    const parts: string[] = [];
    if (resource.brand === 'openaiCompatibility') {
      if (resource.apiKeyPreview) parts.push(resource.apiKeyPreview);
    }
    if (resource.baseUrl) parts.push(resource.baseUrl.replace(/^https?:\/\//, ''));
    if (resource.modelCount > 0)
      parts.push(t('providersPage.flow.models', { count: resource.modelCount }));
    if (resource.prefix) parts.push(t('providersPage.flow.prefix', { prefix: resource.prefix }));
    return parts.join(' · ');
  };

  return (
    <div className={styles.groups}>
      {groups.map((group) => {
        const name = t(`providersPage.providerNames.${group.id}`);
        return (
          <section key={group.id} className={styles.group} aria-label={name}>
            <div className={flow.sectionHead}>
              <h2 className={styles.groupTitle}>
                <ProviderLogo brand={group.id} size={18} />
                {name}
              </h2>
              <button
                type="button"
                className={flow.textButton}
                disabled={disableMutations}
                onClick={() => onAdd(group.id)}
                aria-label={t('providersPage.flow.add_to', { name })}
              >
                {t('providersPage.flow.add_another')}
              </button>
            </div>
            <ul className={flow.list}>
              {group.resources.map((resource) => {
                const label = keyLabel(resource);
                const meta = describe(resource);
                return (
                  <li
                    key={resource.id}
                    className={`${flow.row} ${styles.keyRow}`}
                    data-selected={resource.id === selectedId || undefined}
                  >
                    <button
                      type="button"
                      className={styles.open}
                      onClick={() => onView(resource)}
                      aria-label={t('providersPage.flow.open_key', { name: label })}
                    >
                      <span className={flow.rowMain}>
                        <span className={`${flow.rowTitle} ${styles.mono}`}>{label}</span>
                        {meta ? <span className={flow.rowMeta}>{meta}</span> : null}
                      </span>
                    </button>
                    <StatusDot
                      tone={resource.disabled ? 'off' : 'ok'}
                      label={t(
                        resource.disabled
                          ? 'providersPage.status.disabled'
                          : 'providersPage.status.active'
                      )}
                    />
                    <ToggleSwitch
                      checked={!resource.disabled}
                      disabled={disableMutations}
                      onChange={(value) => onToggleDisabled(resource, !value)}
                      ariaLabel={t('providersPage.flow.toggle_key', { name: label })}
                    />
                    <ActionMenu
                      ariaLabel={t('providersPage.flow.key_actions', { name: label })}
                      items={[
                        {
                          id: 'view',
                          label: t('providersPage.actions.view'),
                          onSelect: () => onView(resource),
                        },
                        {
                          id: 'edit',
                          label: t('providersPage.actions.edit'),
                          disabled: disableMutations,
                          onSelect: () => onEdit(resource),
                        },
                        {
                          id: 'delete',
                          label: t('providersPage.actions.delete'),
                          disabled: disableMutations,
                          onSelect: () => onDelete(resource),
                        },
                      ]}
                    >
                      <IconSidebarMore size={16} />
                    </ActionMenu>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
