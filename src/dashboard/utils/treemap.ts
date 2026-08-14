/**
 * Squarified treemap layout algorithm.
 *
 * Given a list of items with numeric "value" (e.g. volume), and a container
 * width/height, produces rectangles whose area is proportional to value.
 *
 * Based on the squarify algorithm by Bruls, Huijsen & van Wijk (2000).
 * Produces good aspect ratios so tiles are close to square.
 */

export interface TreemapInput {
  id: string;
  value: number;
}

export interface TreemapRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface LayoutItem {
  id: string;
  value: number;
  area: number;
}

/**
 * Compute a squarified treemap layout.
 *
 * @param items  Array of { id, value } sorted descending by value.
 * @param x      Container x offset.
 * @param y      Container y offset.
 * @param width  Container width.
 * @param height Container height.
 * @returns      Array of rectangles.
 */
export function squarify(
  items: TreemapInput[],
  x: number,
  y: number,
  width: number,
  height: number,
): TreemapRect[] {
  if (items.length === 0 || width <= 0 || height <= 0) return [];

  const totalValue = items.reduce((s, it) => s + it.value, 0);
  if (totalValue <= 0) return [];

  const totalArea = width * height;
  const layoutItems: LayoutItem[] = items.map((it) => ({
    id: it.id,
    value: it.value,
    area: (it.value / totalValue) * totalArea,
  }));

  const rects: TreemapRect[] = [];
  let remaining = layoutItems;
  let rx = x;
  let ry = y;
  let rw = width;
  let rh = height;

  while (remaining.length > 0) {
    const shortSide = Math.min(rw, rh);
    const isHorizontal = rw >= rh;

    // Greedily add items to the current row/column until aspect ratio worsens.
    let row: LayoutItem[] = [];
    let rowSum = 0;
    let bestRatio = Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const candidate = [...row, remaining[i]];
      const candidateSum = rowSum + remaining[i].area;
      const ratio = worstRatio(candidate, candidateSum, shortSide);

      if (ratio <= bestRatio || row.length === 0) {
        row = candidate;
        rowSum = candidateSum;
        bestRatio = ratio;
      } else {
        break;
      }
    }

    // Layout the row.
    const rowArea = rowSum;
    const rowThickness = rowArea / shortSide;

    if (isHorizontal) {
      // Row is laid out vertically (stacked along the short side = height).
      // Each item gets a horizontal slice.
      let cy = ry;
      for (const item of row) {
        const itemHeight = (item.area / rowArea) * rh;
        rects.push({
          id: item.id,
          x: rx,
          y: cy,
          width: rowThickness,
          height: itemHeight,
        });
        cy += itemHeight;
      }
      rx += rowThickness;
      rw -= rowThickness;
    } else {
      // Row is laid out horizontally (stacked along the short side = width).
      let cx = rx;
      for (const item of row) {
        const itemWidth = (item.area / rowArea) * rw;
        rects.push({
          id: item.id,
          x: cx,
          y: ry,
          width: itemWidth,
          height: rowThickness,
        });
        cx += itemWidth;
      }
      ry += rowThickness;
      rh -= rowThickness;
    }

    remaining = remaining.slice(row.length);
  }

  return rects;
}

/**
 * Compute the worst (maximum) aspect ratio for a set of items in a row.
 */
function worstRatio(row: LayoutItem[], sum: number, shortSide: number): number {
  if (row.length === 0 || sum <= 0 || shortSide <= 0) return Infinity;

  const rowThickness = sum / shortSide;
  if (rowThickness <= 0) return Infinity;

  let worst = 0;
  for (const item of row) {
    const itemLength = item.area / rowThickness;
    if (itemLength <= 0) continue;
    const ratio = Math.max(rowThickness / itemLength, itemLength / rowThickness);
    if (ratio > worst) worst = ratio;
  }
  return worst;
}