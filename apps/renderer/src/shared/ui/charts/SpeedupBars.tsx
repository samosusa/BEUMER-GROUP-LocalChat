import { useState } from 'react';
import { MAX_COLUMN_WIDTH, bandScale } from './scale';
import { useElementWidth } from './useElementWidth';
import styles from './Chart.module.css';

export interface SpeedupRow {
  key: string;
  label: string;
  /** 1 means no different from the baseline; 2 means twice as good; 0.5 half as good. */
  ratio: number;
  /** Shown in the tooltip so the reader can see what the ratio was computed from. */
  baselineText: string;
  comparedText: string;
}

interface SpeedupBarsProps {
  rows: SpeedupRow[];
  /** Names what 1x means, e.g. "CPU". */
  baselineLabel: string;
  caption: string;
}

const PAD = { top: 8, right: 56, bottom: 26, left: 140 };
const ROW_HEIGHT = 34;

/**
 * How much better or worse something is than a baseline, as a ratio.
 *
 * A grouped column chart of CPU beside GPU answers "how fast is each" and buries the thing
 * the reader actually asked: whether the GPU is worth using at all. Two columns of nearly
 * equal height read as "broken" rather than as the real finding, which on integrated
 * graphics is that generation does not speed up because the GPU shares the same memory.
 *
 * So the baseline is the axis. Bars grow right when the compared device is faster and left
 * when it is slower, and 1x is a line rather than a number to be found by eye.
 *
 * Ratios are unbounded upwards and floored at zero, which makes a symmetric linear scale
 * dishonest: 2x and 0.5x are the same size of change in opposite directions but would draw
 * as +1 and -0.5. The bar length is therefore log-scaled, so a doubling and a halving are
 * mirror images.
 */
export function SpeedupBars({ rows, baselineLabel, caption }: SpeedupBarsProps) {
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const plotWidth = Math.max(0, width - PAD.left - PAD.right);
  const height = PAD.top + rows.length * ROW_HEIGHT + PAD.bottom;
  const band = bandScale(rows.length, rows.length * ROW_HEIGHT, 0.34);
  const barHeight = Math.min(MAX_COLUMN_WIDTH, band.inner);

  // The widest deviation in either direction sets the half-width, so the chart is symmetric
  // about the baseline and never crops a bar.
  const widest = Math.max(
    0.3,
    ...rows.map((row) => Math.abs(Math.log2(row.ratio > 0 ? row.ratio : 0.01))),
  );
  const half = plotWidth / 2;
  const centre = PAD.left + half;
  const offset = (ratio: number) => (Math.log2(ratio > 0 ? ratio : 0.01) / widest) * (half - 4);

  const ticks = [0.5, 1, 2].filter((tick) => Math.abs(Math.log2(tick)) <= widest);

  return (
    <div className={styles.frame} ref={ref}>
      {width > 0 && rows.length > 0 && (
        <svg
          className={styles.svg}
          width={width}
          height={height}
          role="img"
          aria-label={`${caption}, compared with ${baselineLabel}`}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                className={tick === 1 ? styles.axis : styles.grid}
                x1={centre + offset(tick)}
                x2={centre + offset(tick)}
                y1={PAD.top}
                y2={PAD.top + rows.length * ROW_HEIGHT}
              />
              <text
                className={styles.tick}
                x={centre + offset(tick)}
                y={height - 8}
                textAnchor="middle"
              >
                {tick === 1 ? `${baselineLabel} (1×)` : `${tick}×`}
              </text>
            </g>
          ))}

          {rows.map((row, index) => {
            const end = centre + offset(row.ratio);
            const x = Math.min(centre, end);
            const barWidth = Math.max(1, Math.abs(end - centre));
            const y = PAD.top + band.start(index);
            const faster = row.ratio >= 1;
            return (
              <g key={row.key}>
                <text
                  className={styles.category}
                  x={PAD.left - 10}
                  y={y + barHeight / 2}
                  textAnchor="end"
                  dominantBaseline="middle"
                >
                  {row.label}
                </text>
                <rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={barHeight}
                  rx={2}
                  fill={faster ? 'var(--chart-above)' : 'var(--chart-below)'}
                />
                {/* The number rides the bar: with one bar per row there is no clutter risk,
                    and a ratio is meaningless without its value. */}
                <text
                  className={styles.valueLabel}
                  x={faster ? end + 6 : end - 6}
                  y={y + barHeight / 2}
                  textAnchor={faster ? 'start' : 'end'}
                  dominantBaseline="middle"
                >
                  {row.ratio.toFixed(2)}×
                </text>
                <rect
                  className={styles.hit}
                  x={PAD.left}
                  y={y - 4}
                  width={plotWidth}
                  height={barHeight + 8}
                  onMouseEnter={() => setHover(index)}
                  onMouseLeave={() => setHover(null)}
                />
              </g>
            );
          })}
        </svg>
      )}

      {hover !== null && rows[hover] && (
        <div className={styles.tooltip} style={{ left: centre, top: PAD.top + band.start(hover) }}>
          <p className={styles.tooltipTitle}>{rows[hover]?.label}</p>
          <p className={styles.tooltipRow}>
            <span className={styles.tooltipKey}>{baselineLabel}</span>
            <span className={styles.tooltipValue}>{rows[hover]?.baselineText}</span>
          </p>
          <p className={styles.tooltipRow}>
            <span className={styles.tooltipKey}>compared</span>
            <span className={styles.tooltipValue}>{rows[hover]?.comparedText}</span>
          </p>
        </div>
      )}
    </div>
  );
}
