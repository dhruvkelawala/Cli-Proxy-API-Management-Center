/**
 * 通知状态管理
 * 替代原项目中的 showNotification 方法
 */

import { create } from 'zustand';
import type { ReactNode } from 'react';
import type { Notification, NotificationAction, NotificationType } from '@/types';
import { generateId } from '@/utils/helpers';
import { ACTION_NOTIFICATION_DURATION_MS, NOTIFICATION_DURATION_MS } from '@/utils/constants';

interface ConfirmationOptions {
  title?: string;
  message: ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'primary' | 'secondary';
  onConfirm: () => void | Promise<void>;
  onCancel?: () => void;
}

interface NotificationState {
  notifications: Notification[];
  confirmation: {
    isOpen: boolean;
    isLoading: boolean;
    options: ConfirmationOptions | null;
  };
  showNotification: (
    message: string,
    type?: NotificationType,
    duration?: number,
    action?: NotificationAction
  ) => void;
  removeNotification: (id: string) => void;
  /** Drops toasts that offer an action (e.g. Undo); used when the connection changes. */
  removeActionNotifications: () => void;
  showConfirmation: (options: ConfirmationOptions) => void;
  hideConfirmation: () => void;
  setConfirmationLoading: (loading: boolean) => void;
}

export const useNotificationStore = create<NotificationState>((set) => ({
  notifications: [],
  confirmation: {
    isOpen: false,
    isLoading: false,
    options: null,
  },

  showNotification: (message, type = 'info', duration, action) => {
    const id = generateId();
    const notification: Notification = {
      id,
      message,
      type,
      // A toast with an action stays long enough to read it and reach the button.
      duration: duration ?? (action ? ACTION_NOTIFICATION_DURATION_MS : NOTIFICATION_DURATION_MS),
      ...(action ? { action } : {}),
    };

    set((state) => ({
      notifications: [...state.notifications, notification],
    }));

    // NotificationContainer owns readable-time expiry and cleans up timers on unmount.
    // Keeping timers out of the store allows hover/focus/hidden-tab pauses.
  },

  removeActionNotifications: () => {
    set((state) => ({
      notifications: state.notifications.filter((n) => !n.action),
    }));
  },

  removeNotification: (id) => {
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    }));
  },

  showConfirmation: (options) => {
    set({
      confirmation: {
        isOpen: true,
        isLoading: false,
        options,
      },
    });
  },

  hideConfirmation: () => {
    set((state) => ({
      confirmation: {
        ...state.confirmation,
        isOpen: false,
        options: null, // Cleanup
      },
    }));
  },

  setConfirmationLoading: (loading) => {
    set((state) => ({
      confirmation: {
        ...state.confirmation,
        isLoading: loading,
      },
    }));
  },
}));
