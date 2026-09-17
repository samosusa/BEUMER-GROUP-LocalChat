import { useState } from 'react';
import { MAX_COLUMN_WIDTH, bandScale, tooltipFlipsBelow } from './scale';
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
/** Room either side of the baseline keeps for its own "CPU (1×)" label, even when every bar
 *  leans the same way and that side would otherwise collapse to nothing. */
const MIN_SIDE = 48;
/** Candidate gridlines, as powers of two either side of the baseline. */
const TICK_CANDIDATES = [0.25, 0.5, 1, 2, 4, 8, 16];

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

  /*
   * How far right (faster) and how far left (slower) the data actually reaches, in log2
   * units - measured separately rather than as one symmetric "widest deviation", because a
   * fixed 50/50 split around the baseline wastes an entire half of the chart the moment
   * every row leans the same way. A GPU nearly always helps, so "every bar faster" is the
   * common case, not an edge case: splitting the width proportionally to each side's actual
   * span means a one-sided result gets to use nearly the full width instead of being
   * squeezed into half of it, while still keeping the SAME pixels-per-doubling on both sides
   * (leftWidth/leftSpan equals rightWidth/rightSpan below), so a 2x still looks like a 2x
   * whichever direction it falls.
   */
  const rightSpan = Math.max(0, ...rows.map((row) => (row.ratio >= 1 ? Math.log2(row.ratio) : 0)));
  const leftSpan = Math.max(
    0,
    ...rows.map((row) => (row.ratio > 0 && row.ratio < 1 ? -Math.log2(row.ratio) : 0)),
  );
  const totalSpan = Math.max(rightSpan + leftSpan, 0.001);
  const leftWidth = Math.min(
    Math.max(leftSpan > 0 ? (leftSpan / totalSpan) * plotWidth : 0, MIN_SIDE),
    Math.max(plotWidth - MIN_SIDE, 0),
  );
  const rightWidth = plotWidth - leftWidth;
  const centre = PAD.left + leftWidth;
  const offset = (ratio: number) => {
    const log = Math.log2(ratio > 0 ? ratio : 0.01);
    if (log >= 0) return rightSpan > 0 ? (log / rightSpan) * (rightWidth - 4) : 0;
    return leftSpan > 0 ? (log / leftSpan) * (leftWidth - 4) : 0;
  };

  const ticks = TICK_CANDIDATES.filter((tick) => {
    if (tick === 1) return true;
    const log = Math.log2(tick);
    return log > 0 ? log <= rightSpan : -log <= leftSpan;
  });

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
                  /*
                   * Blue for the baseline device, orange for the compared one - the same two
                   * hues the scatter and grouped-column charts use for CPU and GPU. A bar
                   * leaning right says "the compared device won", so it takes the compared
                   * device's colour; leaning left says the baseline won, so it takes the
                   * baseline's. One colour language across every chart on this screen, instead
                   * of this chart alone reaching for a separate good/bad red-and-blue pair.
                   */
                  fill={faster ? 'var(--series-2)' : 'var(--series-1)'}
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
        <div
          className={[
            styles.tooltip,
            tooltipFlipsBelow(PAD.top + band.start(hover)) ? styles.tooltipBelow : '',
          ]
            .filter(Boolean)
            .join(' ')}
          style={{ left: centre, top: PAD.top + band.start(hover) }}
        >
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
