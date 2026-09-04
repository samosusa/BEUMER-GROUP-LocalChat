import { NavLink } from 'react-router-dom';
import { Icon } from '@/shared/ui/Icon';
import { cn } from '@/shared/lib/cn';
import styles from './Projects.module.css';

/**
 * The left rail shared by the Projects and General documents screens. They're separate
 * pages, not two panels sharing one URL — switching between them is a real navigation, not
 * a scroll-to-anchor, so a project's own long document list doesn't leave "general
 * documents" scrolled halfway off screen.
 */
export function LibraryNav() {
  return (
    <nav className={styles.nav} aria-label="Documents & Projects sections">
      <h1 className={styles.navTitle}>Documents &amp; Projects</h1>
      <NavLink
        to="/projects"
        end
        className={({ isActive }) => cn(styles.navItem, isActive && styles.navItemActive)}
      >
        <Icon name="folder" size={16} />
        Projects
      </NavLink>
      <NavLink
        to="/documents"
        className={({ isActive }) => cn(styles.navItem, isActive && styles.navItemActive)}
      >
        <Icon name="document" size={16} />
        General documents
      </NavLink>
      <span className={styles.navSpacer} />
    </nav>
  );
}
