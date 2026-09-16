import { useState } from 'react';
import { gutterFor, linePath, linearScale, tooltipFlipsBelow } from './scale';
import { useElementWidth } from './useElementWidth';
import styles from './Chart.module.css';

export interface TimePoint {
  /** Milliseconds since the epoch. */
  at: number;
  value: number;
}

export interface TimeSeriesLine {
  key: string;
  label: string;
  /** A CSS custom property name, e.g. `--series-1`. Never applied to text. */
  color: string;
  points: TimePoint[];
}

interface TimeSeriesProps {
  lines: TimeSeriesLine[];
  format: (value: number) => string;
  formatTime: (at: number) => string;
  caption: string;
  height?: number;
}

/** `left` is a floor; the real gutter is measured from the widest tick label. */
const PAD = { top: 10, right: 12, bottom: 28, left: 46 };

/**
 * One line per series against run time.
 *
 * The x axis is ordinal - run 1, run 2, run 3 - not a true time scale. Benchmarks are run
 * when someone runs them, so a real time axis spends most of its width on the days nobody
 * benchmarked and crushes three runs from one afternoon into a single pixel. Evenly spaced
 * runs, with the date on the tick, is what a reader of this chart actually wants: did it
 * get faster between one run and the next.
 */
export function TimeSeries({ lines, format, formatTime, caption, height = 220 }: TimeSeriesProps) {
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [hover, setHover] = useState<number | null>(null);

  const visible = lines.filter((line) => !hidden.has(line.key));

  // Every distinct run timestamp across all series, oldest first, is the x axis.
  const stamps = [...new Set(lines.flatMap((line) => line.points.map((point) => point.at)))].sort(
    (a, b) => a - b,
  );

  const plotHeight = height - PAD.top - PAD.bottom;
  const y = linearScale(
    visible.flatMap((line) => line.points.map((point) => point.value)),
    plotHeight,
  );
  const left = gutterFor(y.ticks.map(format), PAD.left);

  /*
   * End labels, and the room they need.
   *
   * Only lines that reach the LAST run are labelled. A line that stops early - a device the
   * machine did not have until three runs ago - would put its label in the middle of the
   * plot, on top of whatever else is passing through there, and a label sitting on the wrong
   * line is worse than a legend lookup.
   */
  const lastStamp = stamps[stamps.length - 1];
  const ends = visible
    .map((line) => {
      const last = line.points[line.points.length - 1];
      return last && last.at === lastStamp ? { key: line.key, value: last.value } : null;
    })
    .filter((end): end is { key: string; value: number } => end !== null);

  const widest = ends.reduce((most, end) => Math.max(most, format(end.value).length), 0);
  const right = ends.length > 0 ? Math.min(96, Math.max(PAD.right, widest * 6.1 + 10)) : PAD.right;

  const plotWidth = Math.max(0, width - left - right);
  const step = stamps.length > 1 ? plotWidth / (stamps.length - 1) : 0;
  const xFor = (at: number) =>
    left + (stamps.length > 1 ? stamps.indexOf(at) * step : plotWidth / 2);
  const yFor = (value: number) => PAD.top + plotHeight - y(value);

  /*
   * Where two lines finish close together, one label is dropped rather than nudged. Moving a
   * label off its line to make room detaches it from the thing it names, and the reader ends
   * up reading a number against the wrong series - the legend and the tooltip still have it,
   * so nothing is lost by staying quiet. Deterministic: top-down, keep what clears 12px.
   */
  const labelled = new Set<string>();
  let lastLabelY = Number.NEGATIVE_INFINITY;
  for (const end of [...ends].sort((a, b) => yFor(a.value) - yFor(b.value))) {
    const at = yFor(end.value);
    if (at - lastLabelY >= 12) {
      labelled.add(end.key);
      lastLabelY = at;
    }
  }

  const toggle = (key: string) =>
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else if (next.size < lines.length - 1) next.add(key);
      return next;
    });

  // Ticks thin out rather than overlap; roughly one per 90px.
  const tickEvery = Math.max(1, Math.ceil(stamps.length / Math.max(1, Math.floor(plotWidth / 90))));

  return (
    <div className={styles.frame} ref={ref}>
      {width > 0 && stamps.length > 0 && (
        <svg
          className={styles.svg}
          width={width}
          height={height}
          role="img"
          aria-label={`${caption} across ${stamps.length} runs`}
        >
          {y.ticks.map((tick) => (
            <g key={tick}>
              <line
                className={styles.grid}
                x1={left}
                x2={left + plotWidth}
                y1={yFor(tick)}
                y2={yFor(tick)}
              />
              <text
                className={styles.tick}
                x={left - 8}
                y={yFor(tick)}
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
            y1={PAD.top + plotHeight}
            y2={PAD.top + plotHeight}
          />

          {stamps.map((at, index) =>
            index % tickEvery === 0 ? (
              <text
                key={at}
                className={styles.category}
                x={xFor(at)}
                y={height - 8}
                textAnchor={index === 0 ? 'start' : index === stamps.length - 1 ? 'end' : 'middle'}
              >
                {formatTime(at)}
              </text>
            ) : null,
          )}

          {hover !== null && (
            <line
              className={styles.axis}
              x1={xFor(stamps[hover] as number)}
              x2={xFor(stamps[hover] as number)}
              y1={PAD.top}
              y2={PAD.top + plotHeight}
            />
          )}

          {visible.map((line) => (
            <path
              key={line.key}
              className={styles.line}
              d={linePath(
                line.points.map((point) => ({ x: xFor(point.at), y: yFor(point.value) })),
              )}
              stroke={`var(${line.color})`}
            />
          ))}

          {visible.map((line) =>
            line.points.map((point) => (
              <circle
                key={`${line.key}-${point.at}`}
                className={styles.marker}
                cx={xFor(point.at)}
                cy={yFor(point.value)}
                r={4}
                fill={`var(${line.color})`}
              />
            )),
          )}

          {ends.map((end) =>
            labelled.has(end.key) ? (
              <text
                key={`label-${end.key}`}
                className={styles.endLabel}
                x={xFor(lastStamp as number) + 8}
                y={yFor(end.value)}
                dominantBaseline="middle"
              >
                {format(end.value)}
              </text>
            ) : null,
          )}

          {stamps.map((at, index) => (
            <rect
              key={at}
              className={styles.hit}
              x={xFor(at) - step / 2}
              y={PAD.top}
              width={Math.max(step, 24)}
              height={plotHeight}
              onMouseEnter={() => setHover(index)}
              onMouseLeave={() => setHover(null)}
            />
          ))}
        </svg>
      )}

      {hover !== null && stamps[hover] !== undefined && (
        <div
          className={cn(styles.tooltip, tooltipFlipsBelow(PAD.top) && styles.tooltipBelow)}
          style={{ left: xFor(stamps[hover] as number), top: PAD.top }}
        >
          <p className={styles.tooltipTitle}>{formatTime(stamps[hover] as number)}</p>
          {visible.map((line) => {
            const point = line.points.find((candidate) => candidate.at === stamps[hover]);
            if (!point) return null;
            return (
              <p key={line.key} className={styles.tooltipRow}>
                <span className={styles.tooltipKey}>
                  <span
                    className={styles.legendSwatch}
                    style={{ background: `var(${line.color})` }}
                  />
                  {line.label}
                </span>
                <span className={styles.tooltipValue}>{format(point.value)}</span>
              </p>
            );
          })}
        </div>
      )}

      {lines.length > 1 && (
        <ul className={styles.legend}>
          {lines.map((line) => (
            <li key={line.key}>
              <button
                type="button"
                className={cn(styles.legendButton, hidden.has(line.key) && styles.legendButtonOff)}
                aria-pressed={!hidden.has(line.key)}
                onClick={() => toggle(line.key)}
              >
                <span
                  className={styles.legendSwatch}
                  style={{ background: `var(${line.color})` }}
                />
                {line.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function cn(...values: Array<string | false | undefined>): string {
  return values.filter(Boolean).join(' ');
}
