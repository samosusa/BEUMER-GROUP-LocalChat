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
 * Rounds an axis maximum up to a value a person would have chosen: 1, 2, 2.5 or 5 times
 * a power of ten. Ticks then land on numbers worth reading rather than on 3.7143.
 */
function niceCeil(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalised = value / magnitude;
  const step =
    normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 2.5 ? 2.5 : normalised <= 5 ? 5 : 10;
  return step * magnitude;
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
  const max = niceCeil(highest);
  const step = max / tickCount;

  const scale = ((value: number) => (max === 0 ? 0 : (value / max) * pixels)) as {
    (value: number): number;
    min: number;
    max: number;
    ticks: number[];
  };
  scale.min = 0;
  scale.max = max;
  scale.ticks = Array.from({ length: tickCount + 1 }, (_, index) => index * step);
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
 * Average glyph width for the 11px sans-serif category label (`.category` in
 * Chart.module.css), as a fraction of the font size. Real text metrics need a canvas; this
 * is close enough to decide when a label needs shortening.
 */
const AVG_CHAR_WIDTH_PX = 6.2;

/**
 * Shortens a label with an ellipsis so it fits within `maxWidth` px.
 *
 * The chart SVG sets `overflow: visible` on purpose, so a line's edge markers are never
 * clipped — which also means nothing clips an axis label for free. A short GGUF filename
 * never ran into this; a HuggingFace-style embedding model id like
 * "sentence-transformers/all-MiniLM-L6-v2" easily overruns a narrow column's slot.
 */
export function truncateLabel(label: string, maxWidth: number): string {
  if (label.length * AVG_CHAR_WIDTH_PX <= maxWidth) return label;
  const maxChars = Math.max(1, Math.floor(maxWidth / AVG_CHAR_WIDTH_PX) - 1);
  return maxChars >= label.length ? label : `${label.slice(0, maxChars)}…`;
}

/**
 * Per-glyph width for the 10px mono-space axis ticks (`.tick` in Chart.module.css).
 * Monospace glyphs are uniform width, unlike the sans-serif category label above, so this is
 * a plain multiplier rather than an average.
 */
const MONO_CHAR_WIDTH_PX = 6;

/**
 * Rough pixel width of a formatted tick label, for sizing the left gutter to fit it.
 *
 * The gutter used to be a fixed 46px, sized for values like "7.4" or "4.2 s". A metric whose
 * unit is spelled out on every tick - "100 texts/s" rather than "100" - is wide enough to run
 * past that gutter and, because the chart SVG sets `overflow: visible`, bleed out its left
 * edge instead of being clipped.
 */
export function estimateTickWidth(label: string): number {
  return label.length * MONO_CHAR_WIDTH_PX;
}
