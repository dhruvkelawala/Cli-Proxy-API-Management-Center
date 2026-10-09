import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { useNotificationStore } from '@/stores';
import { ACTION_NOTIFICATION_DURATION_MS, NOTIFICATION_DURATION_MS } from '@/utils/constants';

const noop = () => {};

describe('notification actions', () => {
  test('a notification can carry one action, such as Undo', () => {
    const store = useNotificationStore.getState();
    useNotificationStore.setState({ notifications: [] });
    store.showNotification('Saved', 'success', 1000, { label: 'Undo', onAction: noop });
    const [notification] = useNotificationStore.getState().notifications;
    expect(notification.action?.label).toBe('Undo');
    useNotificationStore.setState({ notifications: [] });
    const source = readFileSync(
      new URL('../src/components/common/NotificationContainer.tsx', import.meta.url),
      'utf8'
    );
    expect(source).toContain('action.onAction();');
    expect(source).toContain('{action.label}');
  });

  test('a toast with an action stays up longer; a plain one keeps the default', () => {
    useNotificationStore.setState({ notifications: [] });
    const { showNotification } = useNotificationStore.getState();
    showNotification('Saved', 'success', undefined, { label: 'Undo', onAction: noop });
    showNotification('Plain', 'success');
    showNotification('Explicit', 'success', 1234, { label: 'Undo', onAction: noop });
    const [withAction, plain, explicit] = useNotificationStore.getState().notifications;
    expect(withAction.duration).toBe(ACTION_NOTIFICATION_DURATION_MS);
    expect(ACTION_NOTIFICATION_DURATION_MS).toBeGreaterThanOrEqual(8000);
    expect(plain.duration).toBe(NOTIFICATION_DURATION_MS);
    expect(explicit.duration).toBe(1234);
    useNotificationStore.setState({ notifications: [] });
  });

  test('toasts with an action are dropped on a connection change; others stay', () => {
    useNotificationStore.setState({ notifications: [] });
    const { showNotification, removeActionNotifications } = useNotificationStore.getState();
    showNotification('Saved', 'success', undefined, { label: 'Undo', onAction: noop });
    showNotification('Plain', 'info');
    removeActionNotifications();
    expect(useNotificationStore.getState().notifications.map((n) => n.message)).toEqual(['Plain']);
    useNotificationStore.setState({ notifications: [] });
    const layout = readFileSync(
      new URL('../src/components/layout/MainLayout.tsx', import.meta.url),
      'utf8'
    );
    expect(layout).toContain('removeActionNotifications();');
  });

  test('the live region says the action is available; the action is a real button', () => {
    const source = readFileSync(
      new URL('../src/components/common/NotificationContainer.tsx', import.meta.url),
      'utf8'
    );
    expect(source).toContain("t('notification.action_available', { action: action.label })");
    expect(source).toMatch(/<button\s+type="button"\s+className=\{styles\.actionButton\}/);
    for (const lng of ['en', 'zh-CN', 'zh-TW', 'ru', 'vi']) {
      const data = JSON.parse(
        readFileSync(new URL(`../src/i18n/locales/${lng}.json`, import.meta.url), 'utf8')
      );
      expect(data.notification.action_available).toContain('{{action}}');
    }
  });
});
