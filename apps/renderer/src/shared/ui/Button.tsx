import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';
import { Icon, type IconName } from './Icon';
import styles from './Button.module.css';

/**
 * `cta` is BEUMER's CTA-Orange and is rationed: at most one per screen. Everything else
 * that acts is `accent` or `outline`, so the eye can find the primary action instantly.
 */
export type ButtonVariant = 'cta' | 'accent' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  iconPosition?: 'start' | 'end';
  fullWidth?: boolean;
  loading?: boolean;
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'outline',
    size = 'md',
    icon,
    iconPosition = 'start',
    fullWidth = false,
    loading = false,
    disabled,
    className,
    children,
    ...rest
  },
  ref,
) {
  const iconNode = icon ? (
    <Icon name={loading ? 'refresh' : icon} size={size === 'sm' ? 13 : 15} />
  ) : null;

  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        styles.button,
        styles[variant],
        styles[size],
        fullWidth && styles.fullWidth,
        loading && styles.loading,
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {iconPosition === 'start' && iconNode}
      {children != null && <span className={styles.label}>{children}</span>}
      {iconPosition === 'end' && iconNode}
    </button>
  );
});

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  /** Required: an icon-only control with no accessible name is invisible to a screen reader. */
  label: string;
  variant?: 'ghost' | 'accent' | 'outline';
  size?: number;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, variant = 'ghost', size = 16, className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={cn(styles.iconButton, styles[variant], className)}
      aria-label={label}
      title={label}
      {...rest}
    >
      <Icon name={icon} size={size} />
    </button>
  );
});
