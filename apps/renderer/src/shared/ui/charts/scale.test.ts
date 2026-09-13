import { describe, expect, it } from 'vitest';
import { bandScale, columnPath, gutterFor, linearScale, linePath } from './scale';

describe('linearScale', () => {
  it('rounds the axis maximum to a number a person would have picked', () => {
    expect(linearScale([37.1], 100).max).toBe(50);
    expect(linearScale([3.7], 100).max).toBe(5);
    expect(linearScale([1_240], 100).max).toBe(2000);
    expect(linearScale([21], 100).max).toBe(25);
  });

  /**
   * Always zero-based. These charts exist to compare magnitudes, and a column chart with
   * a truncated axis misstates the ratio between two columns - which is the only thing
   * the reader is doing with it.
   */
  it('starts at zero even when every value is large and close together', () => {
    const scale = linearScale([980, 1_000, 1_020], 200);
    expect(scale.min).toBe(0);
    expect(scale(0)).toBe(0);
  });

  it('maps the maximum to the full pixel extent', () => {
    const scale = linearScale([50], 200);
    expect(scale(50)).toBe(200);
    expect(scale(25)).toBe(100);
  });

  it('gives evenly spaced ticks including both ends', () => {
    expect(linearScale([100], 200, 4).ticks).toEqual([0, 25, 50, 75, 100]);
  });

  it('survives an empty series rather than producing NaN', () => {
    const scale = linearScale([], 200);
    expect(scale.max).toBe(1);
    expect(Number.isNaN(scale(0))).toBe(false);
  });

  it('survives an all-zero series', () => {
    const scale = linearScale([0, 0], 200);
    expect(scale(0)).toBe(0);
    expect(Number.isNaN(scale(0))).toBe(false);
  });
});

describe('bandScale', () => {
  it('leaves the slot padding as air rather than filling it', () => {
    const band = bandScale(4, 400);
    expect(band.slot).toBe(100);
    expect(band.inner).toBeLessThan(band.slot);
  });

  it('centres marks in their slot', () => {
    const band = bandScale(2, 200);
    expect(band.centre(0)).toBe(50);
    expect(band.centre(1)).toBe(150);
    expect(band.start(0)).toBeCloseTo((100 - band.inner) / 2);
  });

  it('does not divide by zero on an empty axis', () => {
    expect(bandScale(0, 400).slot).toBe(0);
  });
});

describe('columnPath', () => {
  it('rounds the data-end and leaves the baseline square', () => {
    const path = columnPath(0, 10, 20, 40, 4);
    // Starts at the baseline, curves only near the top.
    expect(path.startsWith('M0,50')).toBe(true);
    expect(path).toContain('Q');
    expect(path.endsWith('Z')).toBe(true);
  });

  /** A 2px column must not get a 4px radius; it would render as a blob, not a value. */
  it('never lets the radius exceed the mark', () => {
    expect(columnPath(0, 0, 2, 40, 4)).toContain('Q0,0 1,0');
    expect(columnPath(0, 0, 20, 1, 4)).toContain('Q0,0 1,0');
  });

  it('draws nothing for a zero-height column', () => {
    expect(columnPath(0, 0, 20, 0)).toBe('');
  });
});

describe('linePath', () => {
  it('moves once and then lines', () => {
    expect(
      linePath([
        { x: 0, y: 1 },
        { x: 2, y: 3 },
      ]),
    ).toBe('M0,1 L2,3');
  });

  it('is empty for no points', () => {
    expect(linePath([])).toBe('');
  });
});

describe('gutterFor', () => {
  /**
   * The bug this exists for: a hardcoded 46px gutter fitted "20 tok/s" and clipped
   * "150 txt/s" to "50 txt/s" - a label that has lost its leading digit is worse than no
   * label, because it is quietly wrong rather than obviously missing.
   */
  it('widens for a longer label', () => {
    expect(gutterFor(['150 txt/s'])).toBeGreaterThan(gutterFor(['20 tok/s']));
  });

  it('never goes below the floor', () => {
    expect(gutterFor(['1'])).toBe(46);
    expect(gutterFor([])).toBe(46);
  });

  it('sizes on the widest label, not the last one', () => {
    expect(gutterFor(['1 txt/s', '150 txt/s', '5 txt/s'])).toBe(gutterFor(['150 txt/s']));
  });
});
