import { useState } from 'react';
import {
  MAX_COLUMN_WIDTH,
  SURFACE_GAP,
  bandScale,
  columnPath,
  gutterFor,
  linearScale,
  tooltipFlipsBelow,
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
                const barHeight = y(value);
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

                return (
                  <g key={entry.key}>
                    <path
                      d={columnPath(x, padTop + plotHeight - barHeight, columnWidth, barHeight)}
                      fill={`var(${entry.color})`}
                    />
                    {fits && (
                      <text
                        className={styles.capLabel}
                        x={x + columnWidth / 2}
                        y={padTop + plotHeight - barHeight - 6}
                        textAnchor="middle"
                      >
                        {capLabel}
                      </text>
                    )}
                  </g>
                );
              })}

              <text
                className={styles.category}
                x={left + band.centre(index)}
                y={height - 8}
                textAnchor="middle"
              >
                {category}
              </text>

              {/* Hit target spans the whole slot: columns are thin and hard to hover. */}
              <rect
                className={styles.hit}
                x={left + index * band.slot}
                y={padTop}
                width={band.slot}
                height={plotHeight}
                onMouseEnter={() => setHover({ index, x: left + band.centre(index), y: padTop })}
                onMouseLeave={() => setHover(null)}
              />
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
