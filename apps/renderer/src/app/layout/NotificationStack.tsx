import { IconButton } from '@/shared/ui/Button';
import { Callout } from '@/shared/ui/Indicators';
import { useNotificationStore } from '@/shared/store/notificationStore';
import styles from './NotificationStack.module.css';

/**
 * Mounted once, above the router, so a notification pushed while the engineer is on another
 * screen still reaches them — the thing this exists for is background work (an ingest that
 * finishes after they've navigated away) whose outcome would otherwise have nowhere to land.
 */
export function NotificationStack() {
  const notifications = useNotificationStore((state) => state.notifications);
  const dismiss = useNotificationStore((state) => state.dismiss);

  if (notifications.length === 0) return null;

  return (
    <div className={styles.stack}>
      {notifications.map((notification) => (
        <Callout
          key={notification.id}
          className={styles.notification}
          actionsClassName={styles.notificationActions}
          tone={notification.tone === 'warning' ? 'warning' : 'accent'}
          title={notification.title}
          actions={
            <IconButton
              icon="close"
              label="Dismiss"
              size={13}
              onClick={() => dismiss(notification.id)}
            />
          }
        >
          {notification.detail && notification.detail.length > 0 && (
            <ul className={styles.detailList}>
              {notification.detail.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
        </Callout>
      ))}
    </div>
  );
}
