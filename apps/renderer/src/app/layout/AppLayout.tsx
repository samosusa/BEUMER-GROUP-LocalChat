import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import styles from './AppLayout.module.css';

/**
 * The two-pane frame every screen lives in. The sidebar is persistent; the outlet owns its
 * own top bar, because the context widget that sits there is chat-specific and must not be
 * hoisted into a shell that other screens share.
 */
export function AppLayout() {
  return (
    <div className={styles.shell}>
      <Sidebar />
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
