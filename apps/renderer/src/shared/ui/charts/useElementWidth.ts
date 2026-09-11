import { useEffect, useRef, useState } from 'react';

/**
 * The rendered width of an element, so a chart can be laid out in real pixels.
 *
 * The alternative - a fixed viewBox scaled with CSS - stretches the type along with the
 * geometry, so axis labels end up a different size on every screen. Measuring instead
 * keeps text at its token size and lets only the plot area flex.
 *
 * Starts at 0, which every chart must treat as "not measured yet" and render nothing for;
 * the first ResizeObserver callback arrives before paint.
 */
export function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    // jsdom has no ResizeObserver. Charts are asserted through their table view in tests,
    // so degrading to the element's current width is enough to keep them mountable.
    if (typeof ResizeObserver === 'undefined') {
      setWidth(element.getBoundingClientRect().width);
      return;
    }

    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, width };
}
