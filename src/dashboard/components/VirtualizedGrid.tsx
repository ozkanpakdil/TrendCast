/**
 * VirtualizedGrid — shared row-based virtualization helper for the dashboard feeds.
 *
 * Renders only the visible rows of a grid into the DOM, so large datasets
 * (hundreds of cards) don't cause jank when scrolling, switching tabs, or
 * hovering. The grid appearance is identical to the non-virtualized version:
 * the same responsive `grid-cols-*` classes and `gap-2` are applied per row.
 *
 * The empty state is NOT handled here — the parent early-returns before
 * rendering `VirtualizedGrid`.
 */

import { memo, useMemo, useRef, useState, useEffect, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

/**
 * Map a container width to a column count, matching the Tailwind responsive
 * grid classes used by the feeds:
 *   `grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6`
 *
 * Tailwind breakpoints (min-width): sm=640, md=768, lg=1024, xl=1280.
 */
export function getColumnCount(width: number): number {
  if (width <= 639) return 2;
  if (width <= 767) return 3;
  if (width <= 1023) return 4;
  if (width <= 1279) return 5;
  return 6;
}

/** Split an array into rows of `size` (the last row may be partial). */
export function chunk<T>(arr: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    rows.push(arr.slice(i, i + size));
  }
  return rows;
}

interface VirtualizedGridProps {
  /** Pre-rendered card elements, one per item, in display order. */
  items: ReactNode[];
}

/**
 * Row-virtualized grid. `items` are chunked into rows of `getColumnCount(width)`
 * columns; only the visible rows are mounted. Variable-height cards are handled
 * via `measureElement` + `data-index` (estimate 120px, corrected on measure).
 */
export const VirtualizedGrid = memo(function VirtualizedGrid({ items }: VirtualizedGridProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  // Track the scroll container width so we can compute the column count.
  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cols = getColumnCount(width);

  const rows = useMemo(() => chunk(items, cols), [items, cols]);

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 120,
    overscan: 3,
  });

  return (
    <div ref={parentRef} className="max-h-[70vh] overflow-y-auto">
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          position: 'relative',
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => (
          <div
            key={virtualRow.key}
            data-index={virtualRow.index}
            ref={rowVirtualizer.measureElement}
            className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${virtualRow.start}px)`,
            }}
          >
            {rows[virtualRow.index]}
          </div>
        ))}
      </div>
    </div>
  );
});
