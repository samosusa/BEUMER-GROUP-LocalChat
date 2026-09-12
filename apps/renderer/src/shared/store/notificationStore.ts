import { create } from 'zustand';

/**
 * Notifications for outcomes that happen off-screen: a mutation whose result matters can
 * resolve after the page that started it has already unmounted (the engineer switched to
 * chat while a folder was still ingesting). Query-cache invalidation still keeps the data
 * correct, but nothing was watching to show the human-facing part of that result — so
 * background work reports itself here instead, in a store mounted above the router, and a
 * stack rendered once in the app shell surfaces it no matter what screen is active.
 *
 * Deliberately not persisted: a notification describes something that just happened in this
 * running session, not a durable record.
 */
export interface Notification {
  id: string;
  tone: 'warning' | 'info';
  title: string;
  detail?: string[];
}

interface NotificationState {
  notifications: Notification[];
  push(notification: Omit<Notification, 'id'>): void;
  dismiss(id: string): void;
}

export const useNotificationStore = create<NotificationState>()((set) => ({
  notifications: [],
  push: (notification) =>
    set((state) => ({
      notifications: [...state.notifications, { ...notification, id: crypto.randomUUID() }],
    })),
  dismiss: (id) =>
    set((state) => ({
      notifications: state.notifications.filter((notification) => notification.id !== id),
    })),
}));
