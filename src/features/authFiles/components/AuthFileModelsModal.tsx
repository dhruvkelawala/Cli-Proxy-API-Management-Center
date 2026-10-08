import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import type { AuthFileModelItem } from '@/features/authFiles/constants';
import { isModelExcluded } from '@/features/authFiles/constants';
import styles from './AuthFileModelsModal.module.scss';

export type AuthFileModelsModalProps = {
  open: boolean;
  fileName: string;
  fileType: string;
  loading: boolean;
  error: 'unsupported' | null;
  models: AuthFileModelItem[];
  excluded: Record<string, string[]>;
  onClose: () => void;
  onCopyText: (text: string) => void;
};

export type AuthFileModelListProps = Pick<
  AuthFileModelsModalProps,
  'models' | 'fileType' | 'excluded' | 'onCopyText'
>;

/** Model rows with a real Copy button each; the model text itself stays selectable. */
export function AuthFileModelList({
  models,
  fileType,
  excluded,
  onCopyText,
}: AuthFileModelListProps) {
  const { t } = useTranslation();
  const baseId = useId();
  const excludedHint = t('auth_files.models_excluded_hint', {
    defaultValue: '此 OAuth 模型已被禁用',
  });
  return (
    <ul className={styles.list}>
      {models.map((model, index) => {
        const excludedModel = isModelExcluded(model.id, fileType, excluded);
        const hintId = `${baseId}-excluded-${index}`;
        return (
          <li
            key={model.id}
            className={`${styles.item} ${excludedModel ? styles.itemExcluded : ''}`}
          >
            <div className={styles.itemText}>
              <span className={styles.modelId}>{model.id}</span>
              {model.display_name && model.display_name !== model.id && (
                <span className={styles.modelDisplayName}>{model.display_name}</span>
              )}
              {model.type && <span className={styles.modelType}>{model.type}</span>}
              {excludedModel && (
                <span className={styles.excludedBadge} title={excludedHint}>
                  {t('auth_files.models_excluded_badge', { defaultValue: '已禁用' })}
                </span>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className={styles.copyButton}
              aria-describedby={excludedModel ? hintId : undefined}
              aria-label={t('auth_files.models_copy_aria', {
                id: model.id,
                defaultValue: 'Copy model ID {{id}}',
              })}
              onClick={() => {
                onCopyText(model.id);
              }}
            >
              {t('common.copy')}
            </Button>
            {excludedModel && (
              <span id={hintId} className={styles.visuallyHidden}>
                {excludedHint}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function AuthFileModelsModal(props: AuthFileModelsModalProps) {
  const { t } = useTranslation();
  const { open, fileName, fileType, loading, error, models, excluded, onClose, onCopyText } = props;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('auth_files.models_title', { defaultValue: '支持的模型' }) + ` - ${fileName}`}
      footer={
        <Button variant="secondary" onClick={onClose}>
          {t('common.close')}
        </Button>
      }
    >
      {loading ? (
        <div className="hint">
          {t('auth_files.models_loading', { defaultValue: '正在加载模型列表...' })}
        </div>
      ) : error === 'unsupported' ? (
        <EmptyState
          title={t('auth_files.models_unsupported', { defaultValue: '当前版本不支持此功能' })}
          description={t('auth_files.models_unsupported_desc', {
            defaultValue: '请更新 CLI Proxy API 到最新版本后重试',
          })}
        />
      ) : models.length === 0 ? (
        <EmptyState
          title={t('auth_files.models_empty', { defaultValue: '该凭证暂无可用模型' })}
          description={t('auth_files.models_empty_desc', {
            defaultValue: '该认证凭证可能尚未被服务器加载或没有绑定任何模型',
          })}
        />
      ) : (
        <AuthFileModelList
          models={models}
          fileType={fileType}
          excluded={excluded}
          onCopyText={onCopyText}
        />
      )}
    </Modal>
  );
}
