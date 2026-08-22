/**
 * Unit tests for the shared row-virtualized grid helpers (PERF-01).
 *
 * Verifies the pure functions used by `VirtualizedGrid`:
 *   - `chunk` splits an array into rows of a fixed size.
 *   - `getColumnCount` maps a container width to a column count matching the
 *     Tailwind responsive grid classes (`grid-cols-2 sm:grid-cols-3
 *     md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6`).
 */

import { describe, it, expect } from 'vitest';
import { chunk, getColumnCount } from '@/dashboard/components/VirtualizedGrid';

describe('chunk', () => {
  it('returns an empty array for an empty input', () => {
    expect(chunk([], 3)).toEqual([]);
  });

  it('splits an exact multiple into full rows', () => {
    expect(chunk([1, 2, 3, 4, 5, 6], 3)).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
  });

  it('keeps a partial remainder row', () => {
    expect(chunk([1, 2, 3, 4, 5], 3)).toEqual([
      [1, 2, 3],
      [4, 5],
    ]);
  });

  it('returns a single row when the array fits in one chunk', () => {
    expect(chunk([1, 2], 3)).toEqual([[1, 2]]);
  });
});

describe('getColumnCount', () => {
  it('maps widths to the Tailwind breakpoint column counts', () => {
    // sm = 640, md = 768, lg = 1024, xl = 1280 (min-width breakpoints)
    expect(getColumnCount(639)).toBe(2);
    expect(getColumnCount(640)).toBe(3);
    expect(getColumnCount(767)).toBe(3);
    expect(getColumnCount(768)).toBe(4);
    expect(getColumnCount(1023)).toBe(4);
    expect(getColumnCount(1024)).toBe(5);
    expect(getColumnCount(1279)).toBe(5);
    expect(getColumnCount(1280)).toBe(6);
  });

  it('returns 6 columns for large widths', () => {
    expect(getColumnCount(1920)).toBe(6);
    expect(getColumnCount(2560)).toBe(6);
  });
});
