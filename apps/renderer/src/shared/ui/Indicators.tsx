import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';
import { formatPercent } from '@/shared/lib/format';
import { Icon, type IconName } from './Icon';
import styles from './Indicators.module.css';

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'muted';

/**
 * A coloured dot beside a word. Colour alone never carries the meaning — the label always
 * does — because status here is read at a glance in a plant, sometimes on a dim screen.
 */
export function StatusDot({ tone = 'neutral', label }: { tone?: Tone; label: string }) {
  return (
    <span className={cn(styles.status, styles[tone])}>
      <span className={styles.dot} aria-hidden="true" />
      {label}
    </span>
  );
}

export function ProgressBar({
  value,
  tone = 'accent',
  thickness = 4,
  label,
}: {
  /** 0..1 */
  value: number;
  tone?: Tone;
  thickness?: number;
  label?: string;
}) {
  const clamped = Math.max(0, Math.min(1, value));
  return (
    <div
      className={cn(styles.track, styles[tone])}
      style={{ height: thickness }}
      role="progressbar"
      aria-valuenow={Math.round(clamped * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label ?? 'Progress'}
    >
      <div className={styles.fill} style={{ width: formatPercent(clamped) }} />
    </div>
  );
}

/** Section heading used above every list and card group. */
export function SectionLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className={styles.sectionLabel}>
      <span>{children}</span>
      {action}
    </div>
  );
}

/** Machine-truthful values — counts, paths, page refs — are always set in mono. */
export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn(styles.mono, className)}>{children}</span>;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: IconName;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className={styles.empty}>
      <Icon name={icon} size={24} className={styles.emptyIcon} />
      <p className={styles.emptyTitle}>{title}</p>
      {description && <p className={styles.emptyDescription}>{description}</p>}
      {action}
    </div>
  );
}

export function Callout({
  tone = 'warning',
  icon = 'warning',
  title,
  children,
  actions,
  className,
  actionsClassName,
}: {
  tone?: 'warning' | 'accent';
  icon?: IconName;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
  actionsClassName?: string;
}) {
  return (
    <div className={cn(styles.callout, styles[`callout_${tone}`], className)} role="status">
      <Icon name={icon} size={19} className={styles.calloutIcon} />
      <div className={styles.calloutBody}>
        <p className={styles.calloutTitle}>{title}</p>
        {children && <div className={styles.calloutText}>{children}</div>}
        {actions && (
          <div className={cn(styles.calloutActions, actionsClassName)}>{actions}</div>
        )}
      </div>
    </div>
  );
}
