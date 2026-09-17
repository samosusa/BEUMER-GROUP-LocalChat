import { useState } from 'react';
import {
  MAX_COLUMN_WIDTH,
  SURFACE_GAP,
  bandScale,
  columnPath,
  gutterFor,
  linearScale,
  tooltipFlipsBelow,
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

/** `left` is a floor; the real gutter is measured from the widest tick label. */
const PAD = { top: 8, right: 8, bottom: 28, left: 46 };

/** A bar's hit target reaches a little past its painted pixels, never the whole slot. */
const HIT_PAD = 4;

/**
 * The shortest a non-zero column is ever drawn.
 *
 * A run spanning a 0.5B model against a 32B one can put every slow model's bar under a
 * pixel tall against the fastest one's scale - a real value rendered as nothing, and
 * nothing to hover either. Flooring the height keeps every measured bar visible and
 * hoverable without changing what the axis or the tooltip report.
 */
const MIN_BAR_PX = 2;

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
  height = 280,
}: GroupedColumnsProps) {
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const [hover, setHover] = useState<{ index: number; x: number; y: number } | null>(null);

  /*
   * Value labels ride the caps only when there is ONE series. With three columns to a slot
   * each column gets a third of the width, no number fits, and a chart with a label on
   * every mark stops being readable anyway - the axis and the tooltip carry those. Direct
   * labels work because they are sparing.
   */
  const labelled = series.length === 1;
  const padTop = labelled ? 20 : PAD.top;
  const plotHeight = height - padTop - PAD.bottom;

  const measured = series.flatMap((entry) =>
    entry.values.filter((value): value is number => value !== null),
  );
  const y = linearScale(measured, plotHeight);
  // gutterFor does what main's BASE_PAD/TICK_GAP pair did, through the one glyph-width
  // constant in scale.ts rather than a second copy of it.
  const left = gutterFor(y.ticks.map(format), PAD.left);
  const plotWidth = Math.max(0, width - left - PAD.right);
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
                x1={left}
                x2={left + plotWidth}
                y1={padTop + plotHeight - y(tick)}
                y2={padTop + plotHeight - y(tick)}
              />
              <text
                className={styles.tick}
                x={left - 8}
                y={padTop + plotHeight - y(tick)}
                textAnchor="end"
                dominantBaseline="middle"
              >
                {format(tick)}
              </text>
            </g>
          ))}

          <line
            className={styles.axis}
            x1={left}
            x2={left + plotWidth}
            y1={padTop + plotHeight}
            y2={padTop + plotHeight}
          />

          {categories.map((category, index) => (
            <g key={category}>
              {series.map((entry, seriesIndex) => {
                const value = entry.values[index];
                if (value === null || value === undefined) return null;
                const barHeight = value > 0 ? Math.max(y(value), MIN_BAR_PX) : y(value);
                const barTop = padTop + plotHeight - barHeight;
                const x =
                  left +
                  band.start(index) +
                  seriesIndex * perColumn +
                  (perColumn - columnWidth) / 2;
                /*
                 * Measured, not hoped for: a label wider than its slot would either overlap
                 * its neighbour or be clipped by the frame, and a cropped number is worse
                 * than no number. 6.1px per character matches the constant `gutterFor` uses
                 * to size the tick gutter, so both estimates agree about this typeface.
                 */
                const capLabel = labelled ? format(value) : null;
                const fits = capLabel !== null && capLabel.length * 6.1 <= band.inner;

                // Padded a little past the painted pixels, then clamped to the plot: the
                // hit target tracks the bar itself, never the empty space above a short one.
                const hitTop = Math.max(padTop, barTop - HIT_PAD);
                const hitBottom = Math.min(padTop + plotHeight, barTop + barHeight + HIT_PAD);

                return (
                  <g key={entry.key}>
                    <path
                      d={columnPath(x, barTop, columnWidth, barHeight)}
                      fill={`var(${entry.color})`}
                    />
                    {fits && (
                      <text
                        className={styles.capLabel}
                        x={x + columnWidth / 2}
                        y={barTop - 6}
                        textAnchor="middle"
                      >
                        {capLabel}
                      </text>
                    )}
                    <rect
                      className={styles.hit}
                      x={x - HIT_PAD}
                      y={hitTop}
                      width={columnWidth + HIT_PAD * 2}
                      height={hitBottom - hitTop}
                      onMouseEnter={() =>
                        setHover({ index, x: left + band.centre(index), y: padTop })
                      }
                      onMouseLeave={() => setHover(null)}
                    />
                  </g>
                );
              })}

              <text
                className={styles.category}
                x={left + band.centre(index)}
                y={height - 8}
                textAnchor="middle"
              >
                {truncateLabel(category, band.slot - 8)}
                <title>{category}</title>
              </text>
            </g>
          ))}
        </svg>
      )}

      {hover && (
        <div
          className={[styles.tooltip, tooltipFlipsBelow(hover.y) ? styles.tooltipBelow : '']
            .filter(Boolean)
            .join(' ')}
          style={{ left: hover.x, top: hover.y }}
        >
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
