import type { InputHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';
import { Icon, type IconName } from './Icon';
import styles from './Controls.module.css';

/**
 * A removable chip, used for documents pinned to a chat's context.
 * `onRemove` renders the × as its own button so the chip body stays clickable.
 */
export function Chip({
  icon,
  children,
  onRemove,
  onClick,
  removeLabel,
  tone = 'neutral',
  maxWidth,
}: {
  icon?: IconName;
  children: ReactNode;
  onRemove?: () => void;
  onClick?: () => void;
  removeLabel?: string;
  tone?: 'neutral' | 'accent' | 'warning';
  maxWidth?: number;
}) {
  const Wrapper = onClick ? 'button' : 'span';
  return (
    <span className={cn(styles.chip, styles[tone])}>
      <Wrapper
        type={onClick ? 'button' : undefined}
        className={styles.chipBody}
        onClick={onClick}
        style={maxWidth ? { maxWidth } : undefined}
      >
        {icon && <Icon name={icon} size={12} className={styles.chipIcon} />}
        <span className={styles.chipLabel}>{children}</span>
      </Wrapper>
      {onRemove && (
        <button
          type="button"
          className={styles.chipRemove}
          onClick={onRemove}
          aria-label={removeLabel ?? 'Remove'}
          title={removeLabel ?? 'Remove'}
        >
          <Icon name="close" size={12} strokeWidth={2.2} />
        </button>
      )}
    </span>
  );
}

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
}

/**
 * The scope switch. Implemented as a radiogroup rather than a row of buttons so arrow keys
 * move between options — an engineer changing scope mid-question should not have to reach
 * for the mouse.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  size = 'md',
}: {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  label: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div
      className={cn(styles.segmented, styles[`segmented_${size}`])}
      role="radiogroup"
      aria-label={label}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            className={cn(styles.segment, selected && styles.segmentSelected)}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
              event.preventDefault();
              const index = options.findIndex((entry) => entry.value === value);
              const delta = event.key === 'ArrowRight' ? 1 : -1;
              const next = options[(index + delta + options.length) % options.length];
              if (next) onChange(next.value);
            }}
          >
            {option.icon && <Icon name={option.icon} size={13} />}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function SearchField({
  value,
  onChange,
  placeholder,
  label,
  ...rest
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return (
    <div className={styles.search}>
      <Icon name="search" size={14} strokeWidth={2} className={styles.searchIcon} />
      <input
        type="search"
        className={styles.searchInput}
        value={value}
        placeholder={placeholder}
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
        {...rest}
      />
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <label className={styles.toggle}>
      <input
        type="checkbox"
        className={styles.toggleInput}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className={styles.toggleTrack} aria-hidden="true">
        <span className={styles.toggleThumb} />
      </span>
      <span className={styles.toggleText}>
        <span className={styles.toggleLabel}>{label}</span>
        {description && <span className={styles.toggleDescription}>{description}</span>}
      </span>
    </label>
  );
}
