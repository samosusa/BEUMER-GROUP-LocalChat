/**
 * The arithmetic behind the charts, kept out of the components so it can be tested
 * without a DOM. Nothing here knows about React or SVG.
 */

export interface LinearScale {
  /** Data value to pixel offset along the axis. */
  (value: number): number;
  readonly min: number;
  readonly max: number;
  readonly ticks: number[];
}

/**
 * Rounds a tick step up to one a person would have chosen: 1, 2, 2.5 or 5 times a power
 * of ten.
 *
 * The step is what gets rounded, not the axis maximum. Rounding the maximum and then
 * dividing it by the tick count is the obvious move and it is wrong: a nice ceiling of
 * 7 GB over four intervals steps by 1.75, and the axis renders "0 B, 2 GB, 3 GB, 5 GB,
 * 7 GB" - five labels whose gaps look unequal, on an axis that is perfectly linear. A
 * reader who trusts the labels misjudges every point on it. Nice steps give nice labels
 * and a nice maximum for free, because the maximum is just the last step.
 */
function niceStep(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalised = value / magnitude;
  const step =
    normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 2.5 ? 2.5 : normalised <= 5 ? 5 : 10;
  return step * magnitude;
}

/**
 * Tick counts to try, in order of preference.
 *
 * Fixing the count at four wastes axis width whenever the data sits just above a step
 * boundary - 147 txt/s over four intervals of 50 runs the axis to 200 and leaves the top
 * quarter empty. Trying three and five as well lets the scale pick the tightest fit that
 * still lands on round numbers: the same data over three intervals reaches exactly 150.
 * Four stays first so it wins ties and remains the shape most charts get.
 */
const TICK_COUNTS = [4, 3, 5];

/** Trims the float noise that i * 0.2 accumulates, to the precision the step implies. */
function atStepPrecision(value: number, step: number): number {
  const decimals = Math.min(10, Math.max(0, -Math.floor(Math.log10(step)) + 1));
  return Number(value.toFixed(decimals));
}

/**
 * The tightest axis that covers `highest`, lands every tick on a round number, and uses
 * a tick count close to the one asked for.
 */
function fitAxis(highest: number, preferred: number): { max: number; step: number; count: number } {
  // Nothing to cover: a 0..1 axis with one interval, rather than three ticks of nothing.
  if (!(highest > 0)) return { max: 1, step: 1, count: 1 };

  const counts = [preferred, ...TICK_COUNTS.filter((count) => count !== preferred)];
  let best: { max: number; step: number; count: number } | null = null;

  for (const count of counts) {
    const step = niceStep(highest / count);
    const max = atStepPrecision(step * count, step);
    if (best === null || max < best.max) best = { max, step, count };
  }

  return best as { max: number; step: number; count: number };
}

/**
 * A linear scale from zero to a rounded maximum, across `pixels`.
 *
 * Deliberately always zero-based. These charts compare magnitudes - tokens per second,
 * milliseconds, bytes - and a bar or column chart that starts anywhere but zero
 * misstates the ratio between two bars, which is the whole thing the reader is doing.
 */
export function linearScale(values: number[], pixels: number, tickCount = 4): LinearScale {
  const highest = values.length > 0 ? Math.max(...values) : 0;
  const { max, step, count } = fitAxis(highest, tickCount);

  const scale = ((value: number) => (max === 0 ? 0 : (value / max) * pixels)) as {
    (value: number): number;
    min: number;
    max: number;
    ticks: number[];
  };
  scale.min = 0;
  scale.max = max;
  scale.ticks = Array.from({ length: count + 1 }, (_, index) =>
    atStepPrecision(index * step, step),
  );
  return scale;
}

/**
 * Positions for a band axis - one slot per category, with the slot's leftover as air.
 *
 * `inner` is the width actually available to marks inside a slot, after the gutter. A
 * column never fills its slot: capping the mark and letting the remainder breathe is
 * what stops a bar chart reading as a solid block.
 */
export function bandScale(count: number, pixels: number, padding = 0.28) {
  const slot = count > 0 ? pixels / count : 0;
  const inner = slot * (1 - padding);
  return {
    slot,
    inner,
    /** Left edge of the marks inside slot `index`. */
    start: (index: number) => index * slot + (slot - inner) / 2,
    /** Centre of slot `index`, for the tick label. */
    centre: (index: number) => index * slot + slot / 2,
  };
}

/** Caps a column so a two-series chart with few categories does not draw slabs. */
export const MAX_COLUMN_WIDTH = 24;

/** A 2px gap in the surface colour is what separates touching columns - never a stroke. */
export const SURFACE_GAP = 2;

/**
 * Rounds the data-end of a column and leaves the baseline square.
 *
 * A fully rounded rect detaches the mark from its baseline and makes short columns look
 * like pills rather than measurements, so the radius is applied at the top only and is
 * never larger than half the column's height.
 */
export function columnPath(
  x: number,
  y: number,
  width: number,
  height: number,
  radius = 4,
): string {
  if (height <= 0) return '';
  const r = Math.min(radius, width / 2, height);
  return [
    `M${x},${y + height}`,
    `V${y + r}`,
    `Q${x},${y} ${x + r},${y}`,
    `H${x + width - r}`,
    `Q${x + width},${y} ${x + width},${y + r}`,
    `V${y + height}`,
    'Z',
  ].join('');
}

/** A polyline through points already in pixel space. */
export function linePath(points: Array<{ x: number; y: number }>): string {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x},${point.y}`).join(' ');
}

/**
 * Per-glyph width for the 10px mono-space axis ticks (`.tick` in Chart.module.css).
 * Monospace glyphs are uniform width, unlike the sans-serif category label further down, so
 * this is a plain multiplier rather than an average.
 */
const MONO_CHAR_WIDTH_PX = 6;

/** Rough pixel width of a formatted tick label. */
export function estimateTickWidth(label: string): number {
  return label.length * MONO_CHAR_WIDTH_PX;
}

/**
 * How wide the y-axis gutter has to be for its widest label.
 *
 * Both branches hit this independently, which is a fair sign the fixed 46px was too small:
 * it fitted "20 tok/s" and clipped "150 txt/s" the moment a three-digit measure appeared -
 * the label lost its leading digit and read as "50 txt/s", which is worse than no label -
 * and it also could not hold a metric whose unit is spelled out on every tick, like
 * "100 texts/s". The SVG sets `overflow: visible` so that edge markers are never clipped,
 * which means nothing clips an overrunning label either: it just bleeds out of the frame.
 *
 * One glyph-width constant, not two. The two branches guessed 6.1 and 6.0 for the same
 * typeface, and a measurement that disagrees with itself is the thing worth removing here.
 */
export function gutterFor(labels: string[], min = 46): number {
  const widest = labels.reduce((most, label) => Math.max(most, estimateTickWidth(label)), 0);
  return Math.max(min, Math.ceil(widest) + 14);
}

/**
 * Average glyph width for the 11px sans-serif category label (`.category` in
 * Chart.module.css). Real text metrics need a canvas; this is close enough to decide when a
 * label needs shortening.
 */
const AVG_CHAR_WIDTH_PX = 6.2;

/**
 * Shortens a label with an ellipsis so it fits within `maxWidth` px.
 *
 * A short GGUF filename never ran into this; a HuggingFace-style embedding model id like
 * "sentence-transformers/all-MiniLM-L6-v2" easily overruns a narrow column's slot.
 */
export function truncateLabel(label: string, maxWidth: number): string {
  if (label.length * AVG_CHAR_WIDTH_PX <= maxWidth) return label;
  const maxChars = Math.max(1, Math.floor(maxWidth / AVG_CHAR_WIDTH_PX) - 1);
  return maxChars >= label.length ? label : `${label.slice(0, maxChars)}…`;
}

/**
 * Which side of its anchor a tooltip can sit on.
 *
 * A tooltip above an anchor near the top of the chart lands outside the frame entirely and
 * over whatever is above it - a time-series tooltip drifting across the chart above it is
 * how this was found. Below the threshold there is no room, so it flips.
 */
export function tooltipFlipsBelow(anchorTop: number): boolean {
  return anchorTop < 70;
}
