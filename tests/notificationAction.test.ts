import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { useNotificationStore } from '@/stores';

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
});
