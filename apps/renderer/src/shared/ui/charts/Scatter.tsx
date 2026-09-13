import { useState } from 'react';
import { linearScale } from './scale';
import { useElementWidth } from './useElementWidth';
import styles from './Chart.module.css';

export interface ScatterPoint {
  key: string;
  label: string;
  x: number;
  y: number;
  /** A CSS custom property name, e.g. `--series-1`. Never applied to text. */
  color: string;
}

export interface ScatterBand {
  /** Where the line sits on the x axis. */
  at: number;
  label: string;
}

interface ScatterProps {
  points: ScatterPoint[];
  xLabel: string;
  yLabel: string;
  formatX: (value: number) => string;
  formatY: (value: number) => string;
  /** Vertical reference lines - "fits in 4 GB", and so on. */
  bands?: ScatterBand[];
  /** Names the corner worth being in, e.g. "fast and small". */
  bestCornerNote?: string;
  height?: number;
}

const PAD = { top: 14, right: 16, bottom: 42, left: 54 };

/**
 * Two measures at once, because "best" here is not one number.
 *
 * A bar chart ranks on a single axis, so it can say which model is fastest and which is
 * smallest but never which is the better choice. On a laptop with shared memory those pull
 * against each other, and the useful answer lives in the trade-off: fast AND small. Plotted
 * together, that is a corner of the chart rather than a row of a table.
 *
 * Every point is directly labelled. With one dot per model there are only a handful, and a
 * scatter whose identities live in a legend makes the reader do lookup work for no reason.
 */
export function Scatter({
  points,
  xLabel,
  yLabel,
  formatX,
  formatY,
  bands = [],
  bestCornerNote,
  height = 260,
}: ScatterProps) {
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const [hover, setHover] = useState<string | null>(null);

  const plotWidth = Math.max(0, width - PAD.left - PAD.right);
  const plotHeight = height - PAD.top - PAD.bottom;

  // Bands must stay on-scale, or "fits in 8 GB" silently vanishes off the right edge.
  const x = linearScale(
    [...points.map((point) => point.x), ...bands.map((band) => band.at)],
    plotWidth,
    4,
  );
  const y = linearScale(
    points.map((point) => point.y),
    plotHeight,
    4,
  );

  const px = (value: number) => PAD.left + x(value);
  const py = (value: number) => PAD.top + plotHeight - y(value);

  return (
    <div className={styles.frame} ref={ref}>
      {width > 0 && points.length > 0 && (
        <svg
          className={styles.svg}
          width={width}
          height={height}
          role="img"
          aria-label={`${yLabel} against ${xLabel}, one point per model`}
        >
          {y.ticks.map((tick) => (
            <g key={`y${tick}`}>
              <line
                className={styles.grid}
                x1={PAD.left}
                x2={PAD.left + plotWidth}
                y1={py(tick)}
                y2={py(tick)}
              />
              <text
                className={styles.tick}
                x={PAD.left - 8}
                y={py(tick)}
                textAnchor="end"
                dominantBaseline="middle"
              >
                {formatY(tick)}
              </text>
            </g>
          ))}

          {x.ticks.map((tick) => (
            <text
              key={`x${tick}`}
              className={styles.tick}
              x={px(tick)}
              y={height - PAD.bottom + 16}
              textAnchor="middle"
            >
              {formatX(tick)}
            </text>
          ))}

          {bands.map((band) => (
            <g key={band.label}>
              <line
                className={styles.band}
                x1={px(band.at)}
                x2={px(band.at)}
                y1={PAD.top}
                y2={PAD.top + plotHeight}
              />
              <text
                className={styles.bandLabel}
                x={px(band.at) - 5}
                y={PAD.top + 10}
                textAnchor="end"
              >
                {band.label}
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

          <text
            className={styles.axisTitle}
            x={PAD.left + plotWidth}
            y={height - 4}
            textAnchor="end"
          >
            {xLabel} →
          </text>

          {points.map((point) => (
            <g key={point.key}>
              <circle
                className={styles.marker}
                cx={px(point.x)}
                cy={py(point.y)}
                r={hover === point.key ? 7 : 5}
                fill={`var(${point.color})`}
              />
              <text
                className={styles.pointLabel}
                x={px(point.x) + 10}
                y={py(point.y)}
                dominantBaseline="middle"
              >
                {point.label}
              </text>
              <circle
                className={styles.hit}
                cx={px(point.x)}
                cy={py(point.y)}
                r={14}
                onMouseEnter={() => setHover(point.key)}
                onMouseLeave={() => setHover(null)}
              />
            </g>
          ))}
        </svg>
      )}

      {bestCornerNote && <p className={styles.chartFootnote}>{bestCornerNote}</p>}

      {hover && (
        <div
          className={styles.tooltip}
          style={{
            left: px(points.find((point) => point.key === hover)?.x ?? 0),
            top: py(points.find((point) => point.key === hover)?.y ?? 0) - 6,
          }}
        >
          <p className={styles.tooltipTitle}>
            {points.find((point) => point.key === hover)?.label}
          </p>
          <p className={styles.tooltipRow}>
            <span className={styles.tooltipKey}>{yLabel}</span>
            <span className={styles.tooltipValue}>
              {formatY(points.find((point) => point.key === hover)?.y ?? 0)}
            </span>
          </p>
          <p className={styles.tooltipRow}>
            <span className={styles.tooltipKey}>{xLabel}</span>
            <span className={styles.tooltipValue}>
              {formatX(points.find((point) => point.key === hover)?.x ?? 0)}
            </span>
          </p>
        </div>
      )}
    </div>
  );
}
