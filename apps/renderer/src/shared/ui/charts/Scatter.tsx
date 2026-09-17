import { useState } from 'react';
import { gutterFor, linearScale, tooltipFlipsBelow } from './scale';
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
 * The undominated points: for none of them does another point sit both cheaper in memory
 * and at least as fast. Sorting by memory and tracking the best speed seen so far finds
 * them in one pass - a point clears the bar only by beating every cheaper point's speed.
 *
 * This is the only set of points that get a permanent label. A run with a handful of models
 * can label every dot and stay readable; a run with dozens cannot; a chart whose labelling
 * rule changes with the data is one more thing to get wrong. Labelling the frontier instead
 * scales to either case and, unlike "every dot", always draws the reader's eye to the thing
 * the footnote below is actually about - the corner worth being in.
 */
function paretoFrontier(points: ScatterPoint[]): ReadonlySet<string> {
  const frontier = new Set<string>();
  let bestY = Number.NEGATIVE_INFINITY;
  for (const point of [...points].sort((a, b) => a.x - b.x)) {
    if (point.y > bestY) {
      frontier.add(point.key);
      bestY = point.y;
    }
  }
  return frontier;
}

/**
 * Two measures at once, because "best" here is not one number.
 *
 * A bar chart ranks on a single axis, so it can say which model is fastest and which is
 * smallest but never which is the better choice. On a laptop with shared memory those pull
 * against each other, and the useful answer lives in the trade-off: fast AND small. Plotted
 * together, that is a corner of the chart rather than a row of a table.
 *
 * Only the frontier is directly labelled (see `paretoFrontier`) - everything else is a dot,
 * identified on hover or in the table below. Labelling every point was fine for a handful of
 * models; past a dozen or two the labels stack into an unreadable block, which is exactly
 * what a direct label exists to avoid.
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

  const plotHeight = height - PAD.top - PAD.bottom;

  /*
   * Only bands the data comes near are drawn.
   *
   * Feeding every band into the scale let a 16 GB reference line stretch the axis to 19 GB
   * for a set of models that topped out at 5.4 GB, squashing every point into the left
   * quarter — the exact opposite of what a trade-off chart is for. A ceiling nothing is
   * close to is not informative; it is just a wider axis.
   */
  const dataMax = Math.max(...points.map((point) => point.x), 0);
  const shown = bands.filter((band) => band.at <= dataMax * 1.15);
  const frontier = paretoFrontier(points);

  const y = linearScale(
    points.map((point) => point.y),
    plotHeight,
    4,
  );

  const left = gutterFor(y.ticks.map(formatY), PAD.left);
  const plotWidth = Math.max(0, width - left - PAD.right);
  const xPixels = linearScale(
    [...points.map((point) => point.x), ...shown.map((band) => band.at)],
    plotWidth,
    4,
  );

  const px = (value: number) => left + xPixels(value);
  const py = (value: number) => PAD.top + plotHeight - y(value);

  /** True when an x tick sits close enough to this band that both would read as one label. */
  const labelledByAxis = (at: number) =>
    xPixels.ticks.some((tick) => Math.abs(px(tick) - px(at)) < 24);

  /*
   * Two points close together would otherwise print their names on top of each other. The
   * second one flips to the left of its dot, which keeps the label attached to its own mark
   * rather than nudging it away vertically — a detached label reads as noise.
   */
  const placed: Array<{ x: number; y: number }> = [];
  const labelSide = (cx: number, cy: number) => {
    const clash = placed.some(
      (other) => Math.abs(other.x - cx) < 120 && Math.abs(other.y - cy) < 14,
    );
    placed.push({ x: cx, y: cy });
    return clash ? 'end' : 'start';
  };

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
                x1={left}
                x2={left + plotWidth}
                y1={py(tick)}
                y2={py(tick)}
              />
              <text
                className={styles.tick}
                x={left - 8}
                y={py(tick)}
                textAnchor="end"
                dominantBaseline="middle"
              >
                {formatY(tick)}
              </text>
            </g>
          ))}

          {xPixels.ticks.map((tick) => (
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

          {shown.map((band) => (
            <g key={band.label}>
              <line
                className={styles.band}
                x1={px(band.at)}
                x2={px(band.at)}
                y1={PAD.top}
                y2={PAD.top + plotHeight}
              />
              {/*
                At the top of the plot these sat exactly where a fast, small model's label
                goes - "phi-3.5-mini · CPU" printed straight through "4 GB". Down by the
                baseline they are clear of every point label, and a memory ceiling is a
                property of the x axis anyway, so that is where it belongs.

                Silent where the axis already says it. Once the ticks landed on round
                numbers a 4 GB band came to rest on the 4 GB tick, and the chart printed
                "4 GB" twice, a few pixels apart, as though they were two different facts.
                The line still marks the ceiling; the tick underneath names it.
              */}
              {!labelledByAxis(band.at) && (
                <text
                  className={styles.bandLabel}
                  x={px(band.at) - 5}
                  y={PAD.top + plotHeight - 5}
                  textAnchor="end"
                >
                  {band.label}
                </text>
              )}
            </g>
          ))}

          <line
            className={styles.axis}
            x1={left}
            x2={left + plotWidth}
            y1={PAD.top + plotHeight}
            y2={PAD.top + plotHeight}
          />

          <text className={styles.axisTitle} x={left + plotWidth} y={height - 4} textAnchor="end">
            {xLabel} →
          </text>

          {points.map((point) => {
            const onFrontier = frontier.has(point.key);
            return (
              <g key={point.key}>
                <circle
                  className={styles.marker}
                  cx={px(point.x)}
                  cy={py(point.y)}
                  r={hover === point.key ? 7 : onFrontier ? 6 : 4}
                  fill={`var(${point.color})`}
                />
                {onFrontier && (
                  <PointLabel
                    anchor={labelSide(px(point.x), py(point.y))}
                    x={px(point.x)}
                    y={py(point.y)}
                    label={point.label}
                  />
                )}
                <circle
                  className={styles.hit}
                  cx={px(point.x)}
                  cy={py(point.y)}
                  r={14}
                  onMouseEnter={() => setHover(point.key)}
                  onMouseLeave={() => setHover(null)}
                />
              </g>
            );
          })}
        </svg>
      )}

      {bestCornerNote && <p className={styles.chartFootnote}>{bestCornerNote}</p>}

      {hover && (
        <div
          className={[
            styles.tooltip,
            tooltipFlipsBelow(py(points.find((point) => point.key === hover)?.y ?? 0))
              ? styles.tooltipBelow
              : '',
          ]
            .filter(Boolean)
            .join(' ')}
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

function PointLabel({
  anchor,
  x,
  y,
  label,
}: {
  anchor: 'start' | 'end';
  x: number;
  y: number;
  label: string;
}) {
  return (
    <text
      className={styles.pointLabel}
      x={anchor === 'start' ? x + 10 : x - 10}
      y={y}
      textAnchor={anchor}
      dominantBaseline="middle"
    >
      {label}
    </text>
  );
}
