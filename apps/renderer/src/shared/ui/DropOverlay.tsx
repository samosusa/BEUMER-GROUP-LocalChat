import { Icon } from './Icon';
import { Mono } from './Indicators';
import styles from './DropOverlay.module.css';

/**
 * The full-bleed "drop here" affordance shown while a drag carrying files is over a drop
 * zone. The zone itself needs `position: relative` for this to anchor correctly.
 */
export function DropOverlay({ title, hint }: { title: string; hint: string }) {
  return (
    <div className={styles.overlay} aria-hidden="true">
      <div className={styles.card}>
        <Icon name="upload" size={26} strokeWidth={1.6} />
        <p className={styles.title}>{title}</p>
        <Mono className={styles.hint}>{hint}</Mono>
      </div>
    </div>
  );
}
