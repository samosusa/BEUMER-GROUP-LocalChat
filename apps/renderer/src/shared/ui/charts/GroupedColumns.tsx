import { useState } from 'react';
import {
  MAX_COLUMN_WIDTH,
  SURFACE_GAP,
  bandScale,
  columnPath,
  estimateTickWidth,
  linearScale,
  truncateLabel,
} from './scale';
import { useElementWidth } from './useElementWidth';
import styles from './Chart.module.css';

export interface ColumnSeries {
  key: string;
  label: string;
  /** A CSS custom property name, e.g. `--series-1`. Never applied to text. */
  color: string;
  /** One entry per category, aligned by index. `null` means "not measured". */
  values: Array<number | null>;
}

interface GroupedColumnsProps {
  categories: string[];
  series: ColumnSeries[];
  /** Renders a value for the axis and the tooltip. */
  format: (value: number) => string;
  /** Names the quantity, e.g. "tokens per second". Read out to assistive tech. */
  caption: string;
  height?: number;
}

const BASE_PAD = { top: 8, right: 8, bottom: 28, left: 46 };
/** Space kept between the widest tick label and the axis line. */
const TICK_GAP = 8;

/**
 * Grouped columns: one slot per category, one column per series inside it.
 *
 * The axis is always zero-based (see `linearScale`) because the reader's whole activity
 * here is comparing one column against another.
 */
export function GroupedColumns({
  categories,
  series,
  format,
  caption,
  height = 220,
}: GroupedColumnsProps) {
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const [hover, setHover] = useState<{ index: number; x: number; y: number } | null>(null);

  const plotHeight = height - BASE_PAD.top - BASE_PAD.bottom;

  const measured = series.flatMap((entry) =>
    entry.values.filter((value): value is number => value !== null),
  );
  const y = linearScale(measured, plotHeight);

  // The gutter has to fit the widest tick label, not the fixed guess `BASE_PAD.left` was
  // sized for - a metric like "texts/s" spells its unit out on every tick and easily needs
  // more room than "7.4" did.
  const left = Math.max(
    BASE_PAD.left,
    Math.max(...y.ticks.map((tick) => estimateTickWidth(format(tick)))) + TICK_GAP,
  );
  const PAD = { ...BASE_PAD, left };

  const plotWidth = Math.max(0, width - PAD.left - PAD.right);
  const band = bandScale(categories.length, plotWidth);

  const perColumn = series.length > 0 ? band.inner / series.length : 0;
  const columnWidth = Math.max(1, Math.min(MAX_COLUMN_WIDTH, perColumn - SURFACE_GAP));

  return (
    <div className={styles.frame} ref={ref}>
      {width > 0 && (
        <svg
          className={styles.svg}
          width={width}
          height={height}
          role="img"
          aria-label={`${caption} by ${categories.join(', ')}`}
        >
          {y.ticks.map((tick) => (
            <g key={tick}>
              <line
                className={styles.grid}
                x1={PAD.left}
                x2={PAD.left + plotWidth}
                y1={PAD.top + plotHeight - y(tick)}
                y2={PAD.top + plotHeight - y(tick)}
              />
              <text
                className={styles.tick}
                x={PAD.left - 8}
                y={PAD.top + plotHeight - y(tick)}
                textAnchor="end"
                dominantBaseline="middle"
              >
                {format(tick)}
              </text>
            </g>
          ))}

          <line
            className={styles.axis}
            x1={PAD.left}
            x2={PAD.left + plotWidth}
            y1={PAD.top + plotHeight}
            y2={PAD.top + plotHeight}
          />

          {categories.map((category, index) => (
            <g key={category}>
              {series.map((entry, seriesIndex) => {
                const value = entry.values[index];
                if (value === null || value === undefined) return null;
                const barHeight = y(value);
                const x =
                  PAD.left +
                  band.start(index) +
                  seriesIndex * perColumn +
                  (perColumn - columnWidth) / 2;
                return (
                  <path
                    key={entry.key}
                    d={columnPath(x, PAD.top + plotHeight - barHeight, columnWidth, barHeight)}
                    fill={`var(${entry.color})`}
                  />
                );
              })}

              <text
                className={styles.category}
                x={PAD.left + band.centre(index)}
                y={height - 8}
                textAnchor="middle"
              >
                {truncateLabel(category, band.slot - 8)}
                <title>{category}</title>
              </text>

              {/* Hit target spans the whole slot: columns are thin and hard to hover. */}
              <rect
                className={styles.hit}
                x={PAD.left + index * band.slot}
                y={PAD.top}
                width={band.slot}
                height={plotHeight}
                onMouseEnter={() =>
                  setHover({ index, x: PAD.left + band.centre(index), y: PAD.top })
                }
                onMouseLeave={() => setHover(null)}
              />
            </g>
          ))}
        </svg>
      )}

      {hover && (
        <div className={styles.tooltip} style={{ left: hover.x, top: hover.y }}>
          <p className={styles.tooltipTitle}>{categories[hover.index]}</p>
          {series.map((entry) => {
            const value = entry.values[hover.index];
            return (
              <p key={entry.key} className={styles.tooltipRow}>
                <span className={styles.tooltipKey}>
                  <span
                    className={styles.legendSwatch}
                    style={{ background: `var(${entry.color})` }}
                  />
                  {entry.label}
                </span>
                <span className={styles.tooltipValue}>
                  {value === null || value === undefined ? 'not run' : format(value)}
                </span>
              </p>
            );
          })}
        </div>
      )}

      {series.length > 1 && (
        <ul className={styles.legend}>
          {series.map((entry) => (
            <li key={entry.key} className={styles.legendItem}>
              <span className={styles.legendSwatch} style={{ background: `var(${entry.color})` }} />
              {entry.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
